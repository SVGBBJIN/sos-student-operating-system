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
import { aggregateRpmStatus, overLimit } from "./rpm-tracker.js";
import { route, type Intent } from "./router.js";
import { enrichDynamicContext } from "./context/enrich.js";
import { transcribeAudio } from "./voice.js";
import type { StreamChunk } from "./providers/types.js";
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
    if ((body.mode === "studio" || body.mode === "planning" || body.mode === "intent_plan") && userId) {
      const rl = await checkContentRateLimit(userId);
      if (!rl.allowed) {
        return { kind: "json", status: 429, json: { error: "Rate limited", rateLimited: true, used: rl.used } };
      }
    }

    // ── Planning pipeline (non-streaming) ──
    if (body.mode === "planning") {
      try {
        const result = await runPlanningPipeline({
          systemPrompt: body.systemPrompt ?? "",
          staticSystemPrompt: body.staticSystemPrompt ?? null,
          dynamicContext: (body.dynamicContext ?? "") + `\n\nWORKSPACE_CONTEXT: ${workspaceContext}`,
          messages,
        });
        return {
          kind: "json",
          status: 200,
          json: {
            content: "",
            actions: [result.proposal],
            clarifications: [],
            executed_actions: [],
            orchestration: { mode: "planning", iterations: result.iterations, ...CLIENT_ORCH },
            planning_critique: result.critiqueText,
          },
        };
      } catch (err) {
        const e = err as PlanningPipelineError;
        return { kind: "json", status: 500, json: { error: e.message, stage: e.stage, cause_code: e.cause_code } };
      }
    }

    // ── Intent-plan pipeline (non-streaming) ──
    if (body.mode === "intent_plan") {
      try {
        const dynamicContext = await enrichDynamicContext({
          userId,
          workspaceContext,
          intentQuery,
          baseContext: (body.dynamicContext ?? "") + `\n\nWORKSPACE_CONTEXT: ${workspaceContext}`,
          clientTasks: body.clientTasks,
          clientCalendarDensity: body.clientCalendarDensity,
        });
        const result = await runIntentPlanPipeline({
          systemPrompt: body.systemPrompt ?? "",
          staticSystemPrompt: body.staticSystemPrompt ?? null,
          dynamicContext,
          messages,
        });
        return {
          kind: "json",
          status: 200,
          json: {
            content: "",
            actions: [result.proposal],
            clarifications: [],
            executed_actions: [],
            orchestration: { mode: "intent_plan", iterations: result.iterations, ...CLIENT_ORCH },
            intent_plan_critique: result.critiqueText,
          },
        };
      } catch (err) {
        const e = err as IntentPlanPipelineError;
        return { kind: "json", status: 500, json: { error: e.message, stage: e.stage, cause_code: e.cause_code } };
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
