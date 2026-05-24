// Transport-agnostic orchestrator for the chat surface.
//
// api/chat.ts (Vercel/Node) and supabase/functions/sos-chat (Deno) are thin
// adapters over handleChatRequest: each normalizes its runtime's request,
// calls this, and serializes the outcome. All env checks, mode dispatch,
// context enrichment, budgeting and error shaping live here so the two
// runtimes can never drift.

import { callModel, RpmExhaustedError } from "./chat-core.js";
import { runPlanningPipeline, PlanningPipelineError } from "./pipelines/planning.js";
import { runIntentPlanPipeline, IntentPlanPipelineError } from "./pipelines/intent_plan.js";
import { runBrainDumpPipeline, BrainDumpPipelineError } from "./pipelines/brain_dump.js";
import { aggregateRpmStatus, overLimit } from "./rpm-tracker.js";
import { route, type Intent } from "./router.js";
import { enrichDynamicContext } from "./context/enrich.js";
import { transcribeAudio } from "./voice.js";
import type { StreamChunk, ProgressEvent } from "./providers/types.js";
import { getEnv } from "../env.js";
import { checkContentRateLimit } from "../rate-limit.js";
import type { TaskForScoring, CalendarDensity } from "../scheduling/priority.js";

export interface ChatBody {
  mode?: string;
  systemPrompt?: string;
  staticSystemPrompt?: string;
  dynamicContext?: string;
  messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  maxTokens?: number;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  audioBase64?: string;
  audioMimeType?: string;
  workspaceContext?: string;
  prompt_version?: string;
  clientTasks?: TaskForScoring[];
  clientCalendarDensity?: CalendarDensity;
}

// Discriminated outcome. "json" → the adapter serializes it directly. "stream"
// → the adapter owns SSE transport: it wires its writer to run(onChunk), emits
// a final "done" frame with the resolved value, and closes.
export type ChatOutcome =
  | { kind: "json"; status: number; headers?: Record<string, string>; json: unknown }
  | { kind: "stream"; run: (onChunk: (c: StreamChunk) => void) => Promise<unknown> };

export interface HandleChatInput {
  body: ChatBody;
  userId: string | null;
  wantsSSE: boolean;
}

const CLIENT_ORCH = { executed_on: "client" as const };

function overLimitForIntent(intent: Intent): boolean {
  return overLimit(route(intent).tier);
}

function rpmExhaustedJson(tier: string, resetAtMs: number): ChatOutcome {
  const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
  return {
    kind: "json",
    status: 429,
    headers: { "Retry-After": String(retryAfterSec) },
    json: {
      error: "AI rate limit reached — try again shortly.",
      rateLimited: true,
      rpmExhausted: true,
      tier,
      resetAtMs,
      rpm: aggregateRpmStatus(),
    },
  };
}

export async function handleChatRequest(input: HandleChatInput): Promise<ChatOutcome> {
  const { body, userId, wantsSSE } = input;

  // Cold-start env sanity check. GROQ_API_KEY drives chat + voice; GEMINI_API_KEY
  // drives embeddings and the cross-provider fallback.
  if (!getEnv("GROQ_API_KEY")) {
    return { kind: "json", status: 500, json: { error: "GROQ_API_KEY is not configured" } };
  }
  if (!getEnv("GEMINI_API_KEY")) {
    return { kind: "json", status: 500, json: { error: "GEMINI_API_KEY is not configured" } };
  }

  const workspaceContext = (body.workspaceContext ?? "chat").toLowerCase();
  const messages = body.messages ?? [];
  const intentQuery = messages.slice(-1)[0]?.content ?? "";

  try {
    // ── Voice transcription (Groq Whisper) ──
    if (body.mode === "voice") {
      if (!body.audioBase64) {
        return { kind: "json", status: 400, json: { error: "No audio data provided" } };
      }
      const transcript = await transcribeAudio({
        audioBase64: body.audioBase64,
        audioMimeType: body.audioMimeType ?? "audio/webm",
      });
      return { kind: "json", status: 200, json: { text: transcript.text } };
    }

    // Rate-limit content-generation modes before doing any real work.
    if ((body.mode === "studio" || body.mode === "planning" || body.mode === "intent_plan" || body.mode === "study_pack") && userId) {
      const rl = await checkContentRateLimit(userId);
      if (!rl.allowed) {
        return { kind: "json", status: 429, json: { error: "Rate limited", rateLimited: true, used: rl.used } };
      }
    }

    // ── Planning pipeline ──
    if (body.mode === "planning") {
      const planningCtx = (body.dynamicContext ?? "") + `\n\nWORKSPACE_CONTEXT: ${workspaceContext}`;
      const buildPlanningJson = (result: { proposal: unknown; iterations: number; critiqueText: string }) => ({
        content: "",
        actions: [result.proposal],
        clarifications: [],
        executed_actions: [],
        orchestration: { mode: "planning", iterations: result.iterations, ...CLIENT_ORCH },
        planning_critique: result.critiqueText,
      });
      if (wantsSSE) {
        return {
          kind: "stream",
          run: async (onChunk) => {
            const result = await runPlanningPipeline({
              systemPrompt: body.systemPrompt ?? "",
              staticSystemPrompt: body.staticSystemPrompt ?? null,
              dynamicContext: planningCtx,
              messages,
              onProgress: (ev: ProgressEvent) => onChunk({ type: "progress", event: ev }),
            });
            return buildPlanningJson(result);
          },
        };
      }
      try {
        const result = await runPlanningPipeline({
          systemPrompt: body.systemPrompt ?? "",
          staticSystemPrompt: body.staticSystemPrompt ?? null,
          dynamicContext: planningCtx,
          messages,
        });
        return { kind: "json", status: 200, json: buildPlanningJson(result) };
      } catch (err) {
        const e = err as PlanningPipelineError;
        return { kind: "json", status: 500, json: { error: e.message, stage: e.stage, cause_code: e.cause_code } };
      }
    }

    // ── Intent-plan pipeline ──
    if (body.mode === "intent_plan") {
      const intentCtx = await enrichDynamicContext({
        userId,
        workspaceContext,
        intentQuery,
        baseContext: (body.dynamicContext ?? "") + `\n\nWORKSPACE_CONTEXT: ${workspaceContext}`,
        clientTasks: body.clientTasks,
        clientCalendarDensity: body.clientCalendarDensity,
      });
      const buildIntentJson = (result: { proposal: unknown; iterations: number; critiqueText: string }) => ({
        content: "",
        actions: [result.proposal],
        clarifications: [],
        executed_actions: [],
        orchestration: { mode: "intent_plan", iterations: result.iterations, ...CLIENT_ORCH },
        intent_plan_critique: result.critiqueText,
      });
      if (wantsSSE) {
        return {
          kind: "stream",
          run: async (onChunk) => {
            const result = await runIntentPlanPipeline({
              systemPrompt: body.systemPrompt ?? "",
              staticSystemPrompt: body.staticSystemPrompt ?? null,
              dynamicContext: intentCtx,
              messages,
              onProgress: (ev: ProgressEvent) => onChunk({ type: "progress", event: ev }),
            });
            return buildIntentJson(result);
          },
        };
      }
      try {
        const result = await runIntentPlanPipeline({
          systemPrompt: body.systemPrompt ?? "",
          staticSystemPrompt: body.staticSystemPrompt ?? null,
          dynamicContext: intentCtx,
          messages,
        });
        return { kind: "json", status: 200, json: buildIntentJson(result) };
      } catch (err) {
        const e = err as IntentPlanPipelineError;
        return { kind: "json", status: 500, json: { error: e.message, stage: e.stage, cause_code: e.cause_code } };
      }
    }

    // ── Brain-dump pipeline (voice / messy text → batch of tentative actions) ──
    if (body.mode === "brain_dump") {
      const dumpCtx = await enrichDynamicContext({
        userId,
        workspaceContext,
        intentQuery,
        baseContext: (body.dynamicContext ?? "") + `\n\nWORKSPACE_CONTEXT: ${workspaceContext}`,
        clientTasks: body.clientTasks,
        clientCalendarDensity: body.clientCalendarDensity,
      });
      const buildDumpJson = (result: { actions: unknown[]; summary: string; iterations: number; critiqueText: string }) => ({
        content: result.summary,
        actions: result.actions,
        clarifications: [],
        executed_actions: [],
        orchestration: { mode: "brain_dump", iterations: result.iterations, ...CLIENT_ORCH },
        brain_dump_critique: result.critiqueText,
      });
      if (wantsSSE) {
        return {
          kind: "stream",
          run: async (onChunk) => {
            const result = await runBrainDumpPipeline({
              systemPrompt: body.systemPrompt ?? "",
              staticSystemPrompt: body.staticSystemPrompt ?? null,
              dynamicContext: dumpCtx,
              messages,
              onProgress: (ev: ProgressEvent) => onChunk({ type: "progress", event: ev }),
            });
            return buildDumpJson(result);
          },
        };
      }
      try {
        const result = await runBrainDumpPipeline({
          systemPrompt: body.systemPrompt ?? "",
          staticSystemPrompt: body.staticSystemPrompt ?? null,
          dynamicContext: dumpCtx,
          messages,
        });
        return { kind: "json", status: 200, json: buildDumpJson(result) };
      } catch (err) {
        const e = err as BrainDumpPipelineError;
        return { kind: "json", status: 500, json: { error: e.message, stage: e.stage, cause_code: e.cause_code } };
      }
    }

    // ── Daily briefing: structured rollup for today (or tomorrow when date='tomorrow') ──
    if (body.mode === "briefing") {
      const briefingCtx = await enrichDynamicContext({
        userId,
        workspaceContext,
        intentQuery: "briefing",
        baseContext: (body.dynamicContext ?? "") + `\n\nWORKSPACE_CONTEXT: ${workspaceContext}`,
        clientTasks: body.clientTasks,
        clientCalendarDensity: body.clientCalendarDensity,
      });
      const briefingPrompt = (body.systemPrompt ?? "") +
        "\n\nProduce a concise daily briefing as STRICT JSON only — no prose outside the JSON. " +
        "Schema: { \"summary\": string (1 sentence), \"events_today\": string[], " +
        "\"unfinished_tasks\": string[], \"prep_gaps\": string[], \"missing\": string[] }. " +
        "Use the assembled context to fill events_today and unfinished_tasks; leave prep_gaps " +
        "and missing as empty arrays for now.";
      try {
        const result = await callModel({
          intent: "chat",
          systemPrompt: briefingPrompt,
          staticSystemPrompt: body.staticSystemPrompt ?? undefined,
          dynamicContext: briefingCtx,
          messages,
          toolSet: "none",
          responseMimeType: "application/json",
          maxOutputTokens: 600,
          temperature: 0.3,
        });
        let briefing: Record<string, unknown> = {
          summary: "", events_today: [], unfinished_tasks: [], prep_gaps: [], missing: [],
        };
        try {
          const parsed = JSON.parse(result.content || "{}");
          if (parsed && typeof parsed === "object") briefing = { ...briefing, ...parsed };
        } catch {
          // Model returned non-JSON — keep the empty briefing skeleton and pass the text along.
          briefing.summary = (result.content || "").trim().slice(0, 280);
        }
        return {
          kind: "json",
          status: 200,
          json: {
            content: "",
            actions: [],
            clarifications: [],
            executed_actions: [],
            orchestration: { mode: "briefing", ...CLIENT_ORCH },
            briefing,
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { kind: "json", status: 500, json: { error: message } };
      }
    }

    // ── Chat + studio share one enriched dynamic context ──
    const baseChatContext = (body.dynamicContext ?? "") +
      `\n\nWORKSPACE_CONTEXT: ${workspaceContext}. Prioritize this context when relevant. ` +
      "When any required field for an action is missing or ambiguous, call ask_clarification — " +
      "never call action tools with placeholder/guessed values.";
    const dynamicContext = await enrichDynamicContext({
      userId,
      workspaceContext,
      intentQuery,
      baseContext: baseChatContext,
      clientTasks: body.clientTasks,
      clientCalendarDensity: body.clientCalendarDensity,
    });

    // ── Studio (forced tool call, content generation) ──
    if (body.mode === "studio") {
      const result = await callModel({
        intent: "studio",
        systemPrompt: body.systemPrompt ?? "",
        staticSystemPrompt: body.staticSystemPrompt ?? undefined,
        dynamicContext,
        messages,
        toolSet: "studio",
        toolChoice: "required",
        maxOutputTokens: Math.min(Number(body.maxTokens) || 4096, 4096),
      });
      return {
        kind: "json",
        status: 200,
        json: { ...result, executed_actions: [], orchestration: { mode: "studio", ...CLIENT_ORCH } },
      };
    }

    // ── Study pack (forced tool call, bundled content generation) ──
    if (body.mode === "study_pack") {
      const result = await callModel({
        intent: "study_pack",
        systemPrompt: body.systemPrompt ?? "",
        staticSystemPrompt: body.staticSystemPrompt ?? undefined,
        dynamicContext,
        messages,
        toolSet: "study_pack",
        toolChoice: "required",
        maxOutputTokens: Math.min(Number(body.maxTokens) || 8192, 8192),
      });
      return {
        kind: "json",
        status: 200,
        json: { ...result, executed_actions: [], orchestration: { mode: "study_pack", ...CLIENT_ORCH } },
      };
    }

    // ── Default chat path ──
    const attachments = body.imageBase64
      ? [{ kind: "image" as const, mimeType: body.imageMimeType ?? "image/jpeg", base64: body.imageBase64 }]
      : undefined;
    const maxOutputTokens = body.maxTokens ?? 1024;

    if (wantsSSE) {
      // Precheck RPM before the adapter flushes SSE headers — once streaming
      // starts we can only surface errors as SSE frames, not a 429 body.
      if (overLimitForIntent("action_routing")) {
        const snap = aggregateRpmStatus();
        return rpmExhaustedJson(snap.tier, snap.resetAtMs);
      }
      return {
        kind: "stream",
        run: async (onChunk) => {
          const result = await callModel({
            intent: "action_routing",
            systemPrompt: body.systemPrompt ?? "",
            staticSystemPrompt: body.staticSystemPrompt ?? undefined,
            dynamicContext,
            messages,
            attachments,
            toolSet: "action",
            maxOutputTokens,
            onChunk,
          });
          return { ...result, executed_actions: [], orchestration: { mode: "client_execution", ...CLIENT_ORCH } };
        },
      };
    }

    const result = await callModel({
      intent: "action_routing",
      systemPrompt: body.systemPrompt ?? "",
      staticSystemPrompt: body.staticSystemPrompt ?? undefined,
      dynamicContext,
      messages,
      attachments,
      toolSet: "action",
      maxOutputTokens,
    });
    return {
      kind: "json",
      status: 200,
      json: { ...result, executed_actions: [], orchestration: { mode: "client_execution", ...CLIENT_ORCH } },
    };
  } catch (err) {
    if (err instanceof RpmExhaustedError) {
      return rpmExhaustedJson(err.tier, err.resetAtMs);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("chat-handler error:", message);
    return { kind: "json", status: 500, json: { error: message } };
  }
}
