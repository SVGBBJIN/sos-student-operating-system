import {
  ACTION_TOOLS,
  BACKUP_MODEL,
  callGroq,
  callGroqStream,
  CONTENT_ACTION_TOOLS,
  CONVERSATIONAL_MODEL,
  CORE_CHECKSUM,
  CORE_VERSION,
  FAST_MODEL,
  getGroqRpmStatus,
  PRIMARY_MODEL,
  PROPOSE_ACTION_TOOL,
  selectModel,
} from "../../../shared/ai/chat-core.js";

/* ── Known Groq model IDs — only these may be passed as preferredModel ── */
const KNOWN_GROQ_MODELS = new Set([PRIMARY_MODEL, CONVERSATIONAL_MODEL, BACKUP_MODEL, FAST_MODEL]);

function resolveModel(preferredModel: string | undefined): string {
  if (typeof preferredModel === "string" && KNOWN_GROQ_MODELS.has(preferredModel)) {
    return preferredModel;
  }
  return PRIMARY_MODEL;
}

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Returns the minimal tool subset for a given route, reducing prompt token cost.
 * Conversational requests get only ask_clarification (~1 tool vs 25).
 */
function selectToolsForRoute(
  routeType: "conversational" | "tool_heavy" | "content_gen",
  workspaceContext: string,
  isContentGen: boolean
): typeof ACTION_TOOLS {
  if (isContentGen) return CONTENT_ACTION_TOOLS;
  if (routeType === "conversational") {
    const clarificationTool = ACTION_TOOLS.find(t => t.function.name === "ask_clarification");
    return [PROPOSE_ACTION_TOOL, clarificationTool].filter(Boolean) as typeof ACTION_TOOLS;
  }
  if (workspaceContext === "schedule") {
    return ACTION_TOOLS.filter(t =>
      ["add_event","delete_event","update_event","add_task","delete_task",
       "complete_task","break_task","add_recurring_event","add_block",
       "delete_block","convert_event_to_block","convert_block_to_event",
       "ask_clarification","clear_all"].includes(t.function.name)
    );
  }
  if (workspaceContext === "notes") {
    return ACTION_TOOLS.filter(t =>
      ["add_note","edit_note","delete_note","ask_clarification"].includes(t.function.name)
    );
  }
  return ACTION_TOOLS;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

console.log(`[chat-core] adapter=supabase version=${CORE_VERSION} checksum=${CORE_CHECKSUM}`);

async function callGroqWhisper(
  apiKey: string,
  audioBase64: string,
  audioMimeType: string
): Promise<string> {
  const binaryStr = atob(audioBase64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
  const effectiveMime = audioMimeType || "audio/webm";
  const audioExt = effectiveMime.includes("mp4") || effectiveMime.includes("aac")
    ? "m4a"
    : effectiveMime.includes("ogg")
    ? "ogg"
    : effectiveMime.includes("mp3")
    ? "mp3"
    : "webm";
  const audioBlob = new Blob([bytes], { type: effectiveMime });
  const audioFile = new File([audioBlob], `voice.${audioExt}`, { type: effectiveMime });

  const groqForm = new FormData();
  groqForm.append("file", audioFile, `voice.${audioExt}`);
  groqForm.append("model", "whisper-large-v3-turbo");
  groqForm.append("response_format", "json");
  groqForm.append("language", "en");

  const groqRes = await fetch(
    "https://api.groq.com/openai/v1/audio/transcriptions",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: groqForm,
    }
  );

  if (!groqRes.ok) {
    const errText = await groqRes.text();
    throw new Error(`Groq Whisper error ${groqRes.status}: ${errText}`);
  }

  const result = await groqRes.json();
  return result.text || "";
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
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || null;

    const body = await req.json();

    // ── Voice transcription path (Groq Whisper) ──
    if (body.mode === "voice") {
      if (!GROQ_API_KEY) {
        return new Response(
          JSON.stringify({ error: "GROQ_API_KEY not configured" }),
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
        const text = await callGroqWhisper(GROQ_API_KEY, audioBase64, audioMimeType || "audio/webm");
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

    // ── Chat completion path (Groq) ──
    if (!GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GROQ_API_KEY not configured" }),
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
      preferredModel,
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
    const likelyToolHeavy = /(schedule|calendar|homework|assignment|deadline|task|plan|quiz|exam|note|midterm|final|cram|study|test|overwhelm|behind|paper|project|presentation|due\s|event|remind|meeting|appointment|recurring)/i.test(latestUserText)
      || normalizedWorkspaceContext === "schedule"
      || normalizedWorkspaceContext === "notes";
    const routeType: "conversational" | "tool_heavy" | "content_gen" =
      isContentGen ? "content_gen" : (likelyToolHeavy ? "tool_heavy" : "conversational");
    const toolsForRequest = selectToolsForRoute(routeType, normalizedWorkspaceContext, isContentGen);
    const toolChoice: "auto" | "required" = isContentGen ? "required" : "auto";
    const clarificationRule = `\n\nCLARIFICATION RULE: Never write a question to the student as plain text. If you need to ask something — missing required field, ambiguous request, vague content topic — call ask_clarification. If you have all required information, act immediately without asking.`;
    const contextPromptSuffix = `\n\nWORKSPACE_CONTEXT: ${normalizedWorkspaceContext}. Prioritize this context when relevant (schedule => planning/time/tasks, notes => note/doc references, chat/none => general).${clarificationRule}`;
    const effectiveSystemPrompt = `${systemPrompt || ""}${contextPromptSuffix}`;
    const effectiveDynamic = dynamicContext ? `${dynamicContext}${contextPromptSuffix}` : null;

    const callOptions = {
      isContentGen: Boolean(isContentGen),
      routeType,
      staticSystemPrompt: staticSystemPrompt || null,
      dynamicContext: effectiveDynamic,
      geminiApiKey: GEMINI_API_KEY,
    };

    // Streaming path: conversational non-content-gen non-image requests only.
    const useStreaming = Boolean(streaming) && !isContentGen && !imageBase64;
    if (useStreaming) {
      const encoder = new TextEncoder();
      let streamResult: Awaited<ReturnType<typeof callGroqStream>>;
      const stream = new ReadableStream({
        async start(controller) {
          // callGroqStream auto-retries with backupModel if CONVERSATIONAL_MODEL fails
          streamResult = await callGroqStream(
            GROQ_API_KEY,
            CONVERSATIONAL_MODEL,
            effectiveSystemPrompt,
            messages,
            maxTokens,
            toolsForRequest, // route-filtered tool subset
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

    // Route-aware tool selection: send only the tools needed for this request type.
    const result = await callGroq(
      GROQ_API_KEY,
      resolveModel(preferredModel),
      effectiveSystemPrompt,
      messages,
      maxTokens,
      imageBase64,
      imageMimeType,
      Boolean(toolsForRequest && toolsForRequest.length > 0), // includeTools
      toolsForRequest, // toolsOverride — route-filtered subset
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
    return new Response(JSON.stringify({ ...result, rpm: getGroqRpmStatus() }), {
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
