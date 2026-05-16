// sos-chat Edge Function — chat surface. Mirrors api/chat.ts.
//
// Routing is driven by router.ts: chat/action_routing → Groq gpt-oss-20b, with
// gemini-3-flash as cross-provider fallback. Voice transcription bypasses
// callModel and goes directly to Groq Whisper via shared/ai/voice.ts.

import { callModel, runPlanningPipeline, SCHEMA_VERSIONS, RpmExhaustedError, aggregateRpmStatus, overLimit, route } from "../../../shared/ai/index.js";
import type { StreamChunk, Intent } from "../../../shared/ai/index.js";
import { transcribeAudio } from "../../../shared/ai/voice.js";

function overLimitForIntent(intent: Intent): boolean {
  return overLimit(route(intent).tier);
}

function rpmExhaustedResponse(tier: string, resetAtMs: number, corsHeaders: Record<string, string>): Response {
  const retryAfterSec = Math.max(1, Math.ceil((resetAtMs - Date.now()) / 1000));
  return new Response(JSON.stringify({
    error: "AI rate limit reached — try again shortly.",
    rateLimited: true,
    rpmExhausted: true,
    tier,
    resetAtMs,
    rpm: aggregateRpmStatus(),
  }), {
    status: 429,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Retry-After": String(retryAfterSec) },
  });
}
import { getEnv } from "../../../shared/env.js";
import { extractUserId } from "../../../shared/auth.js";
import { checkContentRateLimit } from "../../../shared/rate-limit.js";
import { createSSEStream } from "../../../shared/sse.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

console.log(`[sos-chat] adapter=supabase providers=groq+gemini-embed schema_version=${SCHEMA_VERSIONS.action_tools}`);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
};

interface ChatBody {
  mode?: string;
  systemPrompt?: string;
  staticSystemPrompt?: string;
  dynamicContext?: string;
  messages?: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  maxTokens?: number;
  imageBase64?: string;
  imageMimeType?: string;
  audioBase64?: string;
  audioMimeType?: string;
  workspaceContext?: string;
}

function wantsSSE(req: Request): boolean {
  return /text\/event-stream/i.test(req.headers.get("accept") ?? "");
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Cold-start env sanity check.
  if (!getEnv("GROQ_API_KEY")) {
    return new Response(JSON.stringify({ error: "GROQ_API_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!getEnv("GEMINI_API_KEY")) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as ChatBody;
    const userId = extractUserId(req.headers.get("Authorization"));
    const workspaceContext = (body.workspaceContext ?? "chat").toLowerCase();

    if (body.mode === "voice") {
      if (!body.audioBase64) {
        return new Response(JSON.stringify({ error: "No audio data provided" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const transcript = await transcribeAudio({
        audioBase64: body.audioBase64,
        audioMimeType: body.audioMimeType ?? "audio/webm",
      });
      return new Response(JSON.stringify({ text: transcript.text }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((body.mode === "studio" || body.mode === "planning") && userId) {
      const rl = await checkContentRateLimit(userId);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ error: "Rate limited", rateLimited: true, used: rl.used }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    if (body.mode === "planning") {
      const result = await runPlanningPipeline({
        systemPrompt: body.systemPrompt ?? "",
        staticSystemPrompt: body.staticSystemPrompt ?? null,
        dynamicContext: (body.dynamicContext ?? "") + `\n\nWORKSPACE_CONTEXT: ${workspaceContext}`,
        messages: body.messages ?? [],
      });
      return new Response(JSON.stringify({
        content: "",
        actions: [result.proposal],
        clarifications: [],
        executed_actions: [],
        orchestration: { mode: "planning", iterations: result.iterations, executed_on: "client" },
        planning_critique: result.critiqueText,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const contextSuffix = `\n\nWORKSPACE_CONTEXT: ${workspaceContext}. Prioritize this context when relevant. When any required field for an action is missing or ambiguous, call ask_clarification — never call action tools with placeholder/guessed values.`;
    const dynamicContext = (body.dynamicContext ?? "") + contextSuffix;

    if (body.mode === "studio") {
      const result = await callModel({
        intent: "studio",
        systemPrompt: body.systemPrompt ?? "",
        staticSystemPrompt: body.staticSystemPrompt ?? undefined,
        dynamicContext,
        messages: body.messages ?? [],
        toolSet: "studio",
        toolChoice: "required",
        maxOutputTokens: Math.min(Number(body.maxTokens) || 4096, 4096),
      });
      return new Response(JSON.stringify({
        ...result,
        executed_actions: [],
        orchestration: { mode: "studio", executed_on: "client" },
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const attachments = body.imageBase64
      ? [{ kind: "image" as const, mimeType: body.imageMimeType ?? "image/jpeg", base64: body.imageBase64 }]
      : undefined;

    if (wantsSSE(req)) {
      // Precheck RPM before flushing SSE headers — see api/chat.ts for rationale.
      if (overLimitForIntent("action_routing")) {
        const snap = aggregateRpmStatus();
        return rpmExhaustedResponse(snap.tier, snap.resetAtMs, corsHeaders);
      }
      const { response, writer } = createSSEStream();
      // Pump the model call into the SSE writer in the background so we can return
      // the streaming Response immediately.
      (async () => {
        try {
          const result = await callModel({
            intent: "action_routing",
            systemPrompt: body.systemPrompt ?? "",
            staticSystemPrompt: body.staticSystemPrompt ?? undefined,
            dynamicContext,
            messages: body.messages ?? [],
            attachments,
            toolSet: "action",
            maxOutputTokens: body.maxTokens ?? 1024,
            onChunk: (chunk: StreamChunk) => {
              if (chunk.type === "delta") writer.send({ event: "delta", data: { text: chunk.text } });
              else if (chunk.type === "tool_call") writer.send({ event: "tool_call", data: chunk.toolCall });
              else if (chunk.type === "usage") writer.send({ event: "usage", data: chunk.usage });
              else if (chunk.type === "grounding") writer.send({ event: "grounding", data: chunk.metadata });
            },
          });
          writer.send({ event: "done", data: { ...result, executed_actions: [], orchestration: { mode: "client_execution", executed_on: "client" } } });
        } catch (err) {
          writer.send({ event: "error", data: { message: err instanceof Error ? err.message : String(err) } });
        } finally {
          writer.close();
        }
      })();
      return new Response(response.body, { headers: { ...corsHeaders, ...Object.fromEntries(response.headers) } });
    }

    const result = await callModel({
      intent: "action_routing",
      systemPrompt: body.systemPrompt ?? "",
      staticSystemPrompt: body.staticSystemPrompt ?? undefined,
      dynamicContext,
      messages: body.messages ?? [],
      attachments,
      toolSet: "action",
      maxOutputTokens: body.maxTokens ?? 1024,
    });
    return new Response(JSON.stringify({
      ...result,
      executed_actions: [],
      orchestration: { mode: "client_execution", executed_on: "client" },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    if (err instanceof RpmExhaustedError) {
      return rpmExhaustedResponse(err.tier, err.resetAtMs, corsHeaders);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("sos-chat error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
