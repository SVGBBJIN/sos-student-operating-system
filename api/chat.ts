// Vercel serverless handler — Gemini-native chat surface.
//
// Three response modes:
//   - SSE (default; Accept: text/event-stream) — streams delta/tool_call/done frames.
//   - JSON (Accept: application/json or no Accept) — returns the final aggregated
//     payload identical in shape to the previous Groq build, for legacy clients.
//
// Routes:
//   - mode === "voice"     → Gemini Flash audio transcription (returns JSON)
//   - mode === "studio"    → STUDIO_TOOLS forced-call
//   - mode === "planning"  → 3-pass planning pipeline (non-streaming)
//   - default              → chat with ACTION_TOOLS

import { callModel, runPlanningPipeline, PlanningPipelineError, RpmExhaustedError, aggregateRpmStatus, overLimit, route } from "../shared/ai/index.js";
import type { Intent } from "../shared/ai/index.js";

function overLimitForIntent(intent: Intent): boolean {
  return overLimit(route(intent).tier);
}
import type { StreamChunk } from "../shared/ai/index.js";
import { getEnv, requireEnv } from "../shared/env.js";
import { extractUserId } from "../shared/auth.js";
import { checkContentRateLimit } from "../shared/rate-limit.js";
import { createSSEWriterForNode, type NodeResponseLike } from "../shared/sse.js";
import { getProvider } from "../shared/ai/providers/index.js";

// Minimal request/response shapes — avoids the @vercel/node type dependency.
interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}
interface VercelResponse {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string): void;
  json(payload: unknown): void;
  end(payload?: string): void;
  headersSent?: boolean;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
} as const;

function applyCors(res: VercelResponse): void {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
}

function wantsSSE(req: VercelRequest): boolean {
  const accept = String(req.headers.accept ?? req.headers.Accept ?? "");
  return /text\/event-stream/i.test(accept);
}

interface ChatBody {
  mode?: string;
  systemPrompt?: string;
  staticSystemPrompt?: string;
  dynamicContext?: string;
  messages?: Array<{ role: string; content: string }>;
  maxTokens?: number;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  audioBase64?: string;
  audioMimeType?: string;
  workspaceContext?: string;
  prompt_version?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  applyCors(res);
  if (req.method === "OPTIONS") {
    res.status(200).end("ok");
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = getEnv("GEMINI_API_KEY");
  if (!apiKey) {
    res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    return;
  }

  const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as ChatBody;
  const authHeader = req.headers.authorization;
  const userId = extractUserId(typeof authHeader === "string" ? authHeader : null);
  const workspaceContext = (body.workspaceContext ?? "chat").toLowerCase();

  try {
    // ── Voice transcription path (Gemini Flash multimodal) ──
    if (body.mode === "voice") {
      if (!body.audioBase64) {
        res.status(400).json({ error: "No audio data provided" });
        return;
      }
      const provider = getProvider("gemini", apiKey);
      const transcript = await provider.chat({
        model: "gemini-3-flash",
        systemPrompt:
          "Transcribe the attached audio to plain text. Return ONLY the transcript — no commentary, no markdown.",
        messages: [
          {
            role: "user",
            content: "Transcribe this clip.",
            attachments: [{
              kind: "audio",
              mimeType: body.audioMimeType ?? "audio/webm",
              base64: body.audioBase64,
            }],
          },
        ],
        temperature: 0.1,
        maxOutputTokens: 1024,
        thinkingBudget: 0,
      });
      res.status(200).json({ text: transcript.content.trim() });
      return;
    }

    // Rate-limit content-generation modes before doing any real work.
    if ((body.mode === "studio" || body.mode === "planning") && userId) {
      const rl = await checkContentRateLimit(userId);
      if (!rl.allowed) {
        res.status(429).json({ error: "Rate limited", rateLimited: true, used: rl.used });
        return;
      }
    }

    // ── Planning pipeline (non-streaming) ──
    if (body.mode === "planning") {
      try {
        const result = await runPlanningPipeline({
          systemPrompt: body.systemPrompt ?? "",
          staticSystemPrompt: body.staticSystemPrompt ?? null,
          dynamicContext: (body.dynamicContext ?? "") + `\n\nWORKSPACE_CONTEXT: ${workspaceContext}`,
          messages: (body.messages ?? []) as Array<{ role: "user" | "assistant" | "system"; content: string }>,
        });
        res.status(200).json({
          content: "",
          actions: [result.proposal],
          clarifications: [],
          executed_actions: [],
          orchestration: { mode: "planning", iterations: result.iterations, executed_on: "client" },
          planning_critique: result.critiqueText,
        });
      } catch (err) {
        const e = err as PlanningPipelineError;
        res.status(500).json({ error: e.message, stage: e.stage, cause_code: e.cause_code });
      }
      return;
    }

    const contextSuffix = `\n\nWORKSPACE_CONTEXT: ${workspaceContext}. Prioritize this context when relevant. When any required field for an action is missing or ambiguous, call ask_clarification — never call action tools with placeholder/guessed values.`;
    const dynamicContext = (body.dynamicContext ?? "") + contextSuffix;

    // ── Studio (forced tool call, content generation) ──
    if (body.mode === "studio") {
      const result = await callModel({
        intent: "studio",
        systemPrompt: body.systemPrompt ?? "",
        staticSystemPrompt: body.staticSystemPrompt ?? undefined,
        dynamicContext,
        messages: (body.messages ?? []) as Array<{ role: "user" | "assistant" | "system"; content: string }>,
        toolSet: "studio",
        toolChoice: "required",
        maxOutputTokens: Math.min(Number(body.maxTokens) || 4096, 4096),
      });
      res.status(200).json({
        ...result,
        executed_actions: [],
        orchestration: { mode: "studio", executed_on: "client" },
      });
      return;
    }

    // ── Default chat path ──
    const attachments = body.imageBase64
      ? [{ kind: "image" as const, mimeType: body.imageMimeType ?? "image/jpeg", base64: body.imageBase64 }]
      : undefined;

    if (wantsSSE(req)) {
      // Precheck RPM *before* flushing SSE headers — once we start streaming
      // we can't return a 429 JSON body, so the client would have to scrape
      // an `error` event. Catching here lets the existing 429 path handle it.
      // The RPM tracker is process-local; if we pass this gate, callModel
      // will atomically re-check and record the request.
      if (overLimitForIntent("action_routing")) {
        const snap = aggregateRpmStatus();
        const retryAfterSec = Math.max(1, Math.ceil((snap.resetAtMs - Date.now()) / 1000));
        res.setHeader("Retry-After", String(retryAfterSec));
        res.status(429).json({
          error: "Gemini RPM budget exhausted — try again shortly.",
          rateLimited: true,
          rpmExhausted: true,
          tier: snap.tier,
          resetAtMs: snap.resetAtMs,
          rpm: snap,
        });
        return;
      }
      const writer = createSSEWriterForNode(res as unknown as NodeResponseLike);
      const onChunk = (chunk: StreamChunk): void => {
        if (chunk.type === "delta") writer.send({ event: "delta", data: { text: chunk.text } });
        else if (chunk.type === "tool_call") writer.send({ event: "tool_call", data: chunk.toolCall });
        else if (chunk.type === "usage") writer.send({ event: "usage", data: chunk.usage });
        else if (chunk.type === "grounding") writer.send({ event: "grounding", data: chunk.metadata });
      };
      try {
        const result = await callModel({
          intent: "action_routing",
          systemPrompt: body.systemPrompt ?? "",
          staticSystemPrompt: body.staticSystemPrompt ?? undefined,
          dynamicContext,
          messages: (body.messages ?? []) as Array<{ role: "user" | "assistant" | "system"; content: string }>,
          attachments,
          toolSet: "action",
          maxOutputTokens: body.maxTokens ?? 1024,
          onChunk,
        });
        writer.send({ event: "done", data: { ...result, executed_actions: [], orchestration: { mode: "client_execution", executed_on: "client" } } });
      } catch (err) {
        writer.send({ event: "error", data: { message: err instanceof Error ? err.message : String(err) } });
      } finally {
        writer.close();
      }
      return;
    }

    const result = await callModel({
      intent: "action_routing",
      systemPrompt: body.systemPrompt ?? "",
      staticSystemPrompt: body.staticSystemPrompt ?? undefined,
      dynamicContext,
      messages: (body.messages ?? []) as Array<{ role: "user" | "assistant" | "system"; content: string }>,
      attachments,
      toolSet: "action",
      maxOutputTokens: body.maxTokens ?? 1024,
    });
    res.status(200).json({
      ...result,
      executed_actions: [],
      orchestration: { mode: "client_execution", executed_on: "client" },
    });
  } catch (err) {
    if (err instanceof RpmExhaustedError) {
      const snap = aggregateRpmStatus();
      const retryAfterSec = Math.max(1, Math.ceil((snap.resetAtMs - Date.now()) / 1000));
      if (!res.headersSent) {
        res.setHeader("Retry-After", String(retryAfterSec));
        res.status(429).json({
          error: "Gemini RPM budget exhausted — try again shortly.",
          rateLimited: true,
          rpmExhausted: true,
          tier: err.tier,
          resetAtMs: err.resetAtMs,
          rpm: snap,
        });
      }
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/chat error:", message);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  }
}

// Silence the unused-import warning in environments that strip types — the
// requireEnv import is reserved for future strict-startup validation.
void requireEnv;
