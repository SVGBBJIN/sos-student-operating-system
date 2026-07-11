// Transport-agnostic orchestrator for the chat surface.
//
// api/chat.ts (Vercel/Node) and supabase/functions/sos-chat (Deno) are thin
// adapters over handleChatRequest: each normalizes its runtime's request,
// calls this, and serializes the outcome. All env checks, mode dispatch,
// context enrichment, budgeting and error shaping live here so the two
// runtimes can never drift.

import { callModel, RpmExhaustedError, type CallModelResponse, type ChatAction } from "./chat-core.js";
import { retrieve, type RetrievedChunk } from "./rag/retrieve.js";
import { runPlanPipeline, PlanPipelineError } from "./pipelines/plan.js";
import { aggregateRpmStatus, overLimit } from "./rpm-tracker.js";
import { route, type Intent } from "./router.js";
import { enrichDynamicContext } from "./context/enrich.js";
import { transcribeAudio } from "./voice.js";
import {
  CLUE_SYSTEM,
  WORK_CHECK_SYSTEM,
  buildClueContext,
  buildWorkCheckContext,
  normalizeWorkCheckAction,
  resolveProofread,
} from "./coaching.js";
import type { ContentType } from "../coaching/workcheck.js";
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
  intentType?: string;
  // mode:"plan" sub-hint. Set by the voice-transcript quick-capture path to
  // "brain_dump" so it keeps the old dedicated brain_dump mode's exemption
  // from the content-generation rate limit — voice dumps are meant to be a
  // frequent, lightweight capture flow, not a 5/day-limited content-gen
  // surface like planning/studio. Same trust boundary as before the pipeline
  // merge: the client already fully controlled which mode string it sent.
  planKind?: "explicit_request" | "goal" | "brain_dump";
  // Search saved work (mode: "search") — pure retrieve() passthrough, no LLM call.
  searchQuery?: string;
  searchSources?: string[];
  searchLimit?: number;
  // Hint & Work-Check surfaces.
  contentType?: string;          // procedure | fact | argument (LMS task type hint)
  proofreadRoundsUsed?: number;  // rounds already used in the current 2h window
  hasRubric?: boolean;           // whether the student pasted a rubric/prompt
}

function coerceContentType(v?: string): ContentType | null {
  return v === "procedure" || v === "fact" || v === "argument" ? v : null;
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

// ── search_memory tool hop ──────────────────────────────────────────────────
// Semantic retrieval is no longer run on every turn. The model calls the
// `search_memory` tool when it decides it needs stored background; the handler
// executes the retrieval server-side, feeds the results back, and re-runs the
// model once. `search_memory` is stripped from the actions returned to the
// client — it is server-internal and never client-executed.

function extractMemoryQuery(actions: ChatAction[]): { query: string; sources?: string[] } | null {
  const a = actions.find((x) => x.type === "search_memory");
  if (!a || typeof a.query !== "string" || a.query.trim().length === 0) return null;
  const sources = Array.isArray(a.sources)
    ? (a.sources.filter((s): s is string => typeof s === "string"))
    : undefined;
  return { query: a.query.trim(), sources };
}

function formatMemories(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) {
    return "[Retrieved memories]\n(no matching memories found — answer from what you know)";
  }
  const lines = chunks.map((r) => `- (${r.source} · sim=${r.similarity.toFixed(2)}) ${r.text}`);
  return `[Retrieved memories]\n${lines.join("\n")}`;
}

function stripMemoryActions(result: CallModelResponse): CallModelResponse {
  if (!result.actions.some((a) => a.type === "search_memory")) return result;
  return { ...result, actions: result.actions.filter((a) => a.type !== "search_memory") };
}

// Drop search_memory tool-call frames from the live stream so the internal tool
// never surfaces as a client-side action preview; everything else passes through.
function filterMemoryFrames(onChunk: (c: StreamChunk) => void): (c: StreamChunk) => void {
  return (c) => {
    if (c.type === "tool_call" && c.toolCall?.name === "search_memory") return;
    onChunk(c);
  };
}

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

// ── Inflight request dedup ────────────────────────────────────────────────────
// Prevents rapid duplicate submissions (double-click, network retry) from
// spinning up multiple AI calls. Only applies to non-SSE (JSON) requests —
// each SSE client needs its own ordered byte stream so they are never deduped.
// The entry is removed when the promise settles, so a second identical request
// after the first completes always triggers a fresh call.
const inflightRequests = new Map<string, Promise<ChatOutcome>>();

function dedupKey(userId: string | null, body: ChatBody, wantsSSE: boolean): string | null {
  if (wantsSSE) return null;
  const lastMsg = body.messages?.at(-1);
  if (!lastMsg || lastMsg.role !== "user" || !lastMsg.content) return null;
  // djb2-style hash — good enough for dedup, not a security primitive.
  let h = 5381;
  for (let i = 0; i < lastMsg.content.length; i++) {
    h = (h * 33 ^ lastMsg.content.charCodeAt(i)) >>> 0;
  }
  return `${userId ?? "anon"}:${body.mode ?? "chat"}:${h}`;
}

export function handleChatRequest(input: HandleChatInput): Promise<ChatOutcome> {
  const key = dedupKey(input.userId, input.body, input.wantsSSE);
  if (key) {
    const existing = inflightRequests.get(key);
    if (existing) return existing;
  }
  const p = _handleChatRequest(input);
  if (key) {
    inflightRequests.set(key, p);
    void p.finally(() => inflightRequests.delete(key));
  }
  return p;
}

async function _handleChatRequest(input: HandleChatInput): Promise<ChatOutcome> {
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
    // ── Search saved work (My Work / global search) ──
    // Pure RPC passthrough — no LLM call. Reuses the same retrieve() helper
    // that powers the model's search_memory tool hop, so a manual search box
    // and the model's own recall share one index and one ranking.
    if (body.mode === "search") {
      if (!userId) {
        return { kind: "json", status: 401, json: { error: "Authentication required" } };
      }
      const q = (body.searchQuery ?? "").trim();
      if (!q) {
        return { kind: "json", status: 400, json: { error: "searchQuery is required" } };
      }
      const results = await retrieve({
        userId,
        query: q,
        sources: body.searchSources,
        k: Math.min(body.searchLimit ?? 10, 25),
      });
      return { kind: "json", status: 200, json: { results } };
    }

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
    // planKind:"brain_dump" is exempt — quick voice-capture is meant to be
    // frequent/lightweight, not gated behind the same daily cap as planning/
    // studio generation (matches the pre-merge dedicated brain_dump mode).
    const isExemptBrainDump = body.mode === "plan" && body.planKind === "brain_dump";
    if ((body.mode === "studio" || (body.mode === "plan" && !isExemptBrainDump) || body.mode === "study_pack" || body.mode === "clue" || body.mode === "work_check") && userId) {
      const rl = await checkContentRateLimit(userId);
      if (!rl.allowed) {
        return { kind: "json", status: 429, json: { error: "Rate limited", rateLimited: true, used: rl.used } };
      }
    }

    // ── Unified plan pipeline (explicit request / goal / brain-dump) ──
    // Replaces the former planning / intent_plan / brain_dump modes — all
    // three were the same draft→critique→refine shape over one make_plan
    // tool call; classification now happens via prompting in the draft pass.
    if (body.mode === "plan") {
      const planCtx = await enrichDynamicContext({
        userId,
        workspaceContext,
        intentQuery,
        baseContext: (body.dynamicContext ?? "") + `\n\nWORKSPACE_CONTEXT: ${workspaceContext}`,
        clientTasks: body.clientTasks,
        clientCalendarDensity: body.clientCalendarDensity,
      });
      const buildPlanJson = (result: { proposal: unknown; summary: string; iterations: number; critiqueText: string }) => ({
        content: result.summary,
        actions: result.proposal ? [result.proposal] : [],
        clarifications: [],
        executed_actions: [],
        orchestration: { mode: "plan", iterations: result.iterations, ...CLIENT_ORCH },
        plan_critique: result.critiqueText,
      });
      if (wantsSSE) {
        return {
          kind: "stream",
          run: async (onChunk) => {
            const result = await runPlanPipeline({
              systemPrompt: body.systemPrompt ?? "",
              staticSystemPrompt: body.staticSystemPrompt ?? null,
              dynamicContext: planCtx,
              messages,
              onProgress: (ev: ProgressEvent) => onChunk({ type: "progress", event: ev }),
            });
            return buildPlanJson(result);
          },
        };
      }
      try {
        const result = await runPlanPipeline({
          systemPrompt: body.systemPrompt ?? "",
          staticSystemPrompt: body.staticSystemPrompt ?? null,
          dynamicContext: planCtx,
          messages,
        });
        return { kind: "json", status: 200, json: buildPlanJson(result) };
      } catch (err) {
        const e = err as PlanPipelineError;
        return { kind: "json", status: 500, json: { error: e.message, stage: e.stage, cause_code: e.cause_code } };
      }
    }

    // ── Clue (forward hint): one nudge to get the student to a checkable attempt ──
    if (body.mode === "clue") {
      const contentType = coerceContentType(body.contentType);
      const result = await callModel({
        intent: "clue",
        systemPrompt: (body.systemPrompt ? body.systemPrompt + "\n\n" : "") + CLUE_SYSTEM,
        staticSystemPrompt: body.staticSystemPrompt ?? undefined,
        dynamicContext: (body.dynamicContext ?? "") + buildClueContext(contentType),
        messages,
        toolSet: "coaching",
        toolChoice: "required",
        maxOutputTokens: Math.min(Number(body.maxTokens) || 800, 1200),
        temperature: 0.4,
      });
      const action = result.actions.find((a) => a.type === "make_clue") ?? result.actions[0] ?? null;
      return {
        kind: "json",
        status: 200,
        json: {
          ...result,
          actions: action ? [action] : [],
          executed_actions: [],
          orchestration: { mode: "clue", ...CLIENT_ORCH },
        },
      };
    }

    // ── Work-check (backward): evaluate the student's own work, surface gaps ──
    if (body.mode === "work_check") {
      const contentType = coerceContentType(body.contentType);
      const proofread = resolveProofread(body.proofreadRoundsUsed);
      const hasRubric = Boolean(body.hasRubric);
      const result = await callModel({
        intent: "work_check",
        systemPrompt: (body.systemPrompt ? body.systemPrompt + "\n\n" : "") + WORK_CHECK_SYSTEM,
        staticSystemPrompt: body.staticSystemPrompt ?? undefined,
        dynamicContext:
          (body.dynamicContext ?? "") + buildWorkCheckContext({ contentType, proofread, hasRubric }),
        messages,
        toolSet: "coaching",
        toolChoice: "required",
        maxOutputTokens: Math.min(Number(body.maxTokens) || 2000, 3000),
        temperature: 0.3,
        thinkingBudget: 2048,
      });
      const raw = result.actions.find((a) => a.type === "make_work_check") ?? result.actions[0] ?? null;
      const action = raw ? normalizeWorkCheckAction(raw, proofread) : null;
      return {
        kind: "json",
        status: 200,
        json: {
          ...result,
          actions: action ? [action] : [],
          executed_actions: [],
          orchestration: { mode: "work_check", terminal: proofread.terminal, ...CLIENT_ORCH },
        },
      };
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
      `\n\nWORKSPACE_CONTEXT: ${workspaceContext}. Prioritize this context when relevant.`;
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

    const runChat = (ctx: string, onChunk?: (c: StreamChunk) => void) =>
      callModel({
        intent: "action_routing",
        systemPrompt: body.systemPrompt ?? "",
        staticSystemPrompt: body.staticSystemPrompt ?? undefined,
        dynamicContext: ctx,
        messages,
        attachments,
        toolSet: "chat",
        maxOutputTokens,
        groundTitles: true,
        onChunk,
      });

    // One bounded retrieval hop: if the first pass asks to search memory, run the
    // retrieval and re-run the model once with the results in context.
    const runWithMemory = async (onChunk?: (c: StreamChunk) => void): Promise<CallModelResponse> => {
      const first = await runChat(dynamicContext, onChunk ? filterMemoryFrames(onChunk) : undefined);
      const mem = userId ? extractMemoryQuery(first.actions) : null;
      if (!mem) return stripMemoryActions(first);
      let chunks: RetrievedChunk[] = [];
      try {
        chunks = await retrieve({ userId: userId!, query: mem.query, sources: mem.sources, k: 8 });
      } catch {
        chunks = [];
      }
      const second = await runChat(`${dynamicContext}\n\n${formatMemories(chunks)}`, onChunk);
      return stripMemoryActions(second);
    };

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
          const result = await runWithMemory(onChunk);
          return { ...result, executed_actions: [], orchestration: { mode: "client_execution", ...CLIENT_ORCH } };
        },
      };
    }

    const result = await runWithMemory();
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
