import {
  ACTION_TOOLS,
  BACKUP_MODEL,
  callGemini,
  callGeminiStream,
  CONTENT_ACTION_TOOLS,
  CONVERSATIONAL_MODEL,
  CORE_CHECKSUM,
  CORE_VERSION,
  FAST_MODEL,
  PRIMARY_MODEL,
} from "../../../shared/ai/chat-core.js";

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

console.log(`[chat-core] adapter=supabase version=${CORE_VERSION} checksum=${CORE_CHECKSUM}`);

async function callGeminiTranscribe(
  apiKey: string,
  audioBase64: string,
  audioMimeType: string
): Promise<string> {
  const effectiveMime = audioMimeType || "audio/webm";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { inlineData: { mimeType: effectiveMime, data: audioBase64 } },
            { text: "Transcribe this audio recording. Return only the spoken words, nothing else." },
          ],
        }],
        generationConfig: { maxOutputTokens: 1024 },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini transcription error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const parts: Array<{ text?: string }> = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("").trim();
}

/* ── Rate limiting for content generation ── */
async function checkContentRateLimit(
  userId: string
): Promise<{ allowed: boolean; used: number }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  // Midnight EST = 05:00 UTC
  const now = new Date();
  const estOffset = -5;
  const estNow = new Date(now.getTime() + estOffset * 60 * 60 * 1000);
  const todayEST =
    estNow.getFullYear() +
    "-" +
    String(estNow.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(estNow.getDate()).padStart(2, "0");

  const { data } = await sb
    .from("content_generations")
    .select("count")
    .eq("user_id", userId)
    .eq("date", todayEST)
    .maybeSingle();

  const used = data?.count ?? 0;
  const DAILY_LIMIT = 5;

  if (used >= DAILY_LIMIT) {
    return { allowed: false, used };
  }

  await sb.from("content_generations").upsert(
    { user_id: userId, date: todayEST, count: used + 1 },
    { onConflict: "user_id,date" }
  );

  return { allowed: true, used: used + 1 };
}

/* ── Extract user ID from JWT ── */
function extractUserId(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.sub || null;
  } catch {
    return null;
  }
}

/* ── Main handler ── */
serve(async (req: Request) => {
  const startedAt = Date.now();
  const requestId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let telemetry: {
    userId: string | null;
    promptVersion: string | null;
    contextChars: number | null;
    inputTokensEst: number | null;
    workspaceContext: string;
    isContentGen: boolean;
    promptFlags?: Record<string, unknown> | null;
  } | null = null;
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

    const body = await req.json();

    // ── Voice transcription path (Gemini audio) ──
    if (body.mode === "voice") {
      if (!GEMINI_API_KEY) {
        return new Response(
          JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { audioBase64, audioMimeType } = body;
      if (!audioBase64) {
        return new Response(
          JSON.stringify({ error: "No audio data provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      try {
        const text = await callGeminiTranscribe(GEMINI_API_KEY, audioBase64, audioMimeType || "audio/webm");
        return new Response(
          JSON.stringify({ text }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err) {
        const errMsg = (err as Error).message || "Transcription failed";
        console.error("Voice transcription error:", errMsg);
        return new Response(
          JSON.stringify({ error: errMsg }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── Chat completion path (Gemini) ──
    if (!GEMINI_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const {
      systemPrompt,
      staticSystemPrompt,
      dynamicContext,
      messages,
      maxTokens = 1024,
      isContentGen,
      imageBase64,
      imageMimeType,
      workspaceContext,
      prompt_version,
      context_chars,
      input_tokens_est,
      prompt_flags,
      streaming,
    } = body;
    const userId = extractUserId(req.headers.get("Authorization"));
    telemetry = {
      userId,
      promptVersion: typeof prompt_version === "string" ? prompt_version : null,
      contextChars: Number.isFinite(Number(context_chars)) ? Number(context_chars) : null,
      inputTokensEst: Number.isFinite(Number(input_tokens_est)) ? Number(input_tokens_est) : null,
      workspaceContext: typeof workspaceContext === "string" ? workspaceContext.trim().toLowerCase() : "chat",
      isContentGen: Boolean(isContentGen),
      promptFlags: (prompt_flags && typeof prompt_flags === "object") ? prompt_flags : null,
    };

    // Rate limiting for content generation
    if (isContentGen) {
      if (userId) {
        const { allowed, used } = await checkContentRateLimit(userId);
        if (!allowed) {
          return new Response(
            JSON.stringify({ error: "Rate limited", rateLimited: true, used }),
            {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
      }
    }

    const normalizedWorkspaceContext = typeof workspaceContext === "string"
      ? workspaceContext.trim().toLowerCase()
      : "chat";
    const latestUserMessage = [...(Array.isArray(messages) ? messages : [])]
      .reverse()
      .find((m) => m?.role === "user" && typeof m?.content === "string");
    const latestUserText = ((latestUserMessage?.content as string) || "").toLowerCase();
    const likelyToolHeavy = /(schedule|calendar|homework|assignment|deadline|task|plan|quiz|exam|note)/i.test(latestUserText)
      || normalizedWorkspaceContext === "schedule"
      || normalizedWorkspaceContext === "notes";
    const routeType: "conversational" | "tool_heavy" | "content_gen" =
      isContentGen ? "content_gen" : (likelyToolHeavy ? "tool_heavy" : "conversational");
    const toolsForRequest = isContentGen ? CONTENT_ACTION_TOOLS : null;
    const toolChoice: "auto" | "required" = isContentGen ? "required" : "auto";
    const contextPromptSuffix = `\n\nWORKSPACE_CONTEXT: ${normalizedWorkspaceContext}. Prioritize this context when relevant (schedule => planning/time/tasks, notes => note/doc references, chat/none => general).`;
    const effectiveSystemPrompt = `${systemPrompt || ""}${contextPromptSuffix}`;
    const effectiveDynamic = dynamicContext ? `${dynamicContext}${contextPromptSuffix}` : null;

    const callOptions = {
      isContentGen: Boolean(isContentGen),
      routeType,
      staticSystemPrompt: staticSystemPrompt || null,
      dynamicContext: effectiveDynamic,
    };

    // Streaming path: conversational non-content-gen non-image requests only.
    const useStreaming = Boolean(streaming) && !isContentGen && !imageBase64;
    if (useStreaming) {
      const encoder = new TextEncoder();
      let streamResult: Awaited<ReturnType<typeof callGeminiStream>>;
      const stream = new ReadableStream({
        async start(controller) {
          // callGeminiStream auto-retries with backupModel if CONVERSATIONAL_MODEL fails
          streamResult = await callGeminiStream(
            GEMINI_API_KEY,
            CONVERSATIONAL_MODEL,
            effectiveSystemPrompt,
            messages,
            maxTokens,
            ACTION_TOOLS, // pass full tools so model can handle borderline messages
            "auto",
            (delta: string) => {
              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ type: "text_delta", delta })}\n\n`
              ));
            },
            { ...callOptions, backupModel: FAST_MODEL }
          );
          const donePayload = {
            ...streamResult,
            executed_actions: [],
            orchestration: { mode: "client_execution", executed_on: "client" },
          };
          console.log("chat_request_prompt_snapshot", JSON.stringify({
            request_id: requestId,
            prompt: {
              version: telemetry?.promptVersion || null,
              flags: telemetry?.promptFlags || null,
              workspace_context: telemetry?.workspaceContext || "chat",
            },
            clarification: {
              asked: Boolean(
                (Array.isArray(streamResult?.clarifications) && streamResult.clarifications.length > 0)
                || (streamResult?.clarification && typeof streamResult.clarification === "object")
              ),
              count: Array.isArray(streamResult?.clarifications) ? streamResult.clarifications.length : 0,
            },
          }));
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ type: "done", ...donePayload })}\n\n`
          ));
          controller.close();
          persistPromptTelemetry({
            userId: telemetry?.userId || null, requestId,
            promptVersion: telemetry?.promptVersion || null,
            contextChars: telemetry?.contextChars || null,
            inputTokensEst: telemetry?.inputTokensEst || null,
            workspaceContext: telemetry?.workspaceContext || "chat",
            isContentGen: telemetry?.isContentGen || false,
            latencyMs: Date.now() - startedAt, ok: true,
          }).catch(() => {});
        },
      });
      return new Response(stream, {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
      });
    }

    // Always use full ACTION_TOOLS so the AI can call any tool based on actual message intent,
    // not regex-gated detection. Gemini handles chat + tool calling in one pass.
    const result = await callGemini(
      GEMINI_API_KEY,
      PRIMARY_MODEL,
      effectiveSystemPrompt,
      messages,
      maxTokens,
      imageBase64,
      imageMimeType,
      true,         // includeTools — always on; model decides when to call tools
      toolsForRequest, // toolsOverride — content-gen is constrained to typed content tools
      toolChoice,
      BACKUP_MODEL,
      callOptions
    );
    if (isContentGen && (!Array.isArray(result.actions) || result.actions.length === 0)) {
      throw new Error("Content generation must return typed actions[] payloads.");
    }
    console.log("chat_request_prompt_snapshot", JSON.stringify({
      request_id: requestId,
      prompt: {
        version: telemetry?.promptVersion || null,
        flags: telemetry?.promptFlags || null,
        workspace_context: telemetry?.workspaceContext || "chat",
      },
      clarification: {
        asked: Boolean(
          (Array.isArray(result?.clarifications) && result.clarifications.length > 0)
          || (result?.clarification && typeof result.clarification === "object")
        ),
        count: Array.isArray(result?.clarifications) ? result.clarifications.length : 0,
      },
    }));

    await persistPromptTelemetry({
      userId: telemetry?.userId || null,
      requestId,
      promptVersion: telemetry?.promptVersion || null,
      contextChars: telemetry?.contextChars || null,
      inputTokensEst: telemetry?.inputTokensEst || null,
      workspaceContext: telemetry?.workspaceContext || "chat",
      isContentGen: telemetry?.isContentGen || false,
      latencyMs: Date.now() - startedAt,
      ok: true,
    });
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const errMsg = (err as Error).message || "Internal server error";
    const errStack = (err as Error).stack || "";
    await persistPromptTelemetry({
      userId: telemetry?.userId || null,
      requestId,
      promptVersion: telemetry?.promptVersion || null,
      contextChars: telemetry?.contextChars || null,
      inputTokensEst: telemetry?.inputTokensEst || null,
      workspaceContext: telemetry?.workspaceContext || "chat",
      isContentGen: telemetry?.isContentGen || false,
      latencyMs: Date.now() - startedAt,
      ok: false,
      errorMessage: errMsg,
    });
    console.error("sos-chat error:", errMsg, errStack);
    return new Response(
      JSON.stringify({ error: errMsg }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
