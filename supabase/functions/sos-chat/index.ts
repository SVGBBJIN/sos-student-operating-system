import {
  ACTION_TOOLS,
  callGroq,
  CORE_CHECKSUM,
  CORE_VERSION,
  getGroqRpmStatus,
  resolveModel,
  STUDIO_TOOLS,
} from "../../../shared/ai/chat-core.js";
import { runPlanningPipeline } from "../../../shared/ai/planning-pipeline.js";

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

console.log(`[chat-core] adapter=supabase version=${CORE_VERSION} checksum=${CORE_CHECKSUM}`);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

/* ── Rate limiting for Studio content generation ── */
async function checkContentRateLimit(
  userId: string
): Promise<{ allowed: boolean; used: number }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  const now = new Date();
  const estNow = new Date(now.getTime() + -5 * 60 * 60 * 1000);
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

async function persistPromptTelemetry(payload: Record<string, unknown>) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return;
  try {
    await fetch(`${supabaseUrl}/rest/v1/prompt_telemetry_logs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ ...payload, created_at: new Date().toISOString() }),
    });
  } catch (_) { /* fire-and-forget */ }
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
  let telemetry: Record<string, unknown> | null = null;

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

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

    if (!GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GROQ_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const {
      mode,
      systemPrompt,
      staticSystemPrompt,
      dynamicContext,
      messages,
      maxTokens = 1024,
      imageBase64,
      imageMimeType,
      workspaceContext,
      prompt_version,
      context_chars,
      input_tokens_est,
    } = body;
    const preferredModel = resolveModel(body.preferredModel);
    const userId = extractUserId(req.headers.get("Authorization"));
    telemetry = {
      userId,
      promptVersion: typeof prompt_version === "string" ? prompt_version : null,
      contextChars: Number.isFinite(Number(context_chars)) ? Number(context_chars) : null,
      inputTokensEst: Number.isFinite(Number(input_tokens_est)) ? Number(input_tokens_est) : null,
      workspaceContext: typeof workspaceContext === "string" ? workspaceContext.trim().toLowerCase() : "chat",
      isContentGen: mode === "studio",
    };

    // ── Studio (content generation) path ──
    if (mode === "studio") {
      if (userId) {
        const { allowed, used } = await checkContentRateLimit(userId);
        if (!allowed) {
          return new Response(
            JSON.stringify({ error: "Rate limited", rateLimited: true, used }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      const normalizedWorkspace = typeof workspaceContext === "string" ? workspaceContext.trim().toLowerCase() : "chat";
      const contextSuffix = `\n\nWORKSPACE_CONTEXT: ${normalizedWorkspace}`;
      const effectiveDynamic = dynamicContext ? `${dynamicContext}${contextSuffix}` : null;

      const studioResult = await callGroq(
        GROQ_API_KEY,
        preferredModel,
        systemPrompt || "",
        messages,
        Math.min(Number(maxTokens) || 4096, 4096),
        null,
        null,
        true,
        STUDIO_TOOLS,
        "required",
        null,
        { isContentGen: true, staticSystemPrompt: staticSystemPrompt || null, dynamicContext: effectiveDynamic }
      );

      if (!Array.isArray(studioResult.actions) || studioResult.actions.length === 0) {
        throw new Error("Studio mode must return typed actions[] payloads.");
      }

      persistPromptTelemetry({
        request_id: requestId, user_id: userId,
        prompt_version: telemetry?.promptVersion || null,
        workspace_context: "studio", is_content_gen: true,
        latency_ms: Date.now() - startedAt, ok: true,
      }).catch(() => {});

      return new Response(
        JSON.stringify({ ...studioResult, rpm: getGroqRpmStatus() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Planning pipeline (agentic 3-pass: draft → critique → refine) ──
    if (mode === "planning") {
      if (userId) {
        const { allowed, used } = await checkContentRateLimit(userId);
        if (!allowed) {
          return new Response(
            JSON.stringify({ error: "Rate limited", rateLimited: true, used }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }
      const normalizedWs = typeof workspaceContext === "string" ? workspaceContext.trim().toLowerCase() : "studio";
      const planDynamic = dynamicContext ? `${dynamicContext}\n\nWORKSPACE_CONTEXT: ${normalizedWs}` : null;
      const { proposal, critiqueText, iterations } = await runPlanningPipeline({
        apiKey: GROQ_API_KEY!,
        systemPrompt: systemPrompt || "",
        staticSystemPrompt: staticSystemPrompt || null,
        dynamicContext: planDynamic,
        messages,
      });
      persistPromptTelemetry({
        request_id: requestId, user_id: userId,
        prompt_version: telemetry?.promptVersion || null,
        workspace_context: "planning", is_content_gen: true,
        latency_ms: Date.now() - startedAt, ok: true,
      }).catch(() => {});
      return new Response(
        JSON.stringify({
          content: "",
          actions: [proposal],
          clarifications: [],
          executed_actions: [],
          orchestration: { mode: "planning", iterations, executed_on: "client" },
          planning_critique: critiqueText,
          rpm: getGroqRpmStatus(),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── Normal chat path ──
    const normalizedWorkspaceContext = typeof workspaceContext === "string"
      ? workspaceContext.trim().toLowerCase()
      : "chat";
    const contextPromptSuffix = `\n\nWORKSPACE_CONTEXT: ${normalizedWorkspaceContext}. Prioritize this context when relevant (schedule => planning/time/tasks, notes => note/doc references, chat/none => general).\n\nCLARIFICATION RULE: The ask_clarification tool is the ONLY way to ask the student for missing or ambiguous details before running an action tool. NEVER call add_event, add_task, add_block, or any other action tool with placeholder, guessed, or fabricated values. NEVER respond with plain text to ask for missing action fields — use ask_clarification. Plain-text responses are for conversational messages only (greetings, explanations, answers to questions). If a required field for an action is not stated in the student's message, call ask_clarification with the specific missing field — do not attempt the action.`;
    const effectiveDynamic = dynamicContext ? `${dynamicContext}${contextPromptSuffix}` : null;
    const effectiveSystemPrompt = `${systemPrompt || ""}${contextPromptSuffix}`;

    const callOptions = {
      isContentGen: false,
      staticSystemPrompt: staticSystemPrompt || null,
      dynamicContext: effectiveDynamic,
    };

    const result: any = await callGroq(
      GROQ_API_KEY!,
      preferredModel,
      effectiveSystemPrompt,
      messages,
      maxTokens,
      imageBase64,
      imageMimeType,
      true,
      ACTION_TOOLS,
      "auto",
      null,
      callOptions
    );

    if (!Array.isArray(result.actions)) {
      (result as any).actions = [];
    }

    console.log("chat_request_prompt_snapshot", JSON.stringify({
      request_id: requestId,
      prompt: {
        version: telemetry?.promptVersion || null,
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

    persistPromptTelemetry({
      request_id: requestId, user_id: userId,
      prompt_version: telemetry?.promptVersion || null,
      context_chars: telemetry?.contextChars || null,
      input_tokens_est: telemetry?.inputTokensEst || null,
      workspace_context: telemetry?.workspaceContext || "chat",
      is_content_gen: false,
      latency_ms: Date.now() - startedAt, ok: true,
    }).catch(() => {});

    return new Response(
      JSON.stringify({ ...result, rpm: getGroqRpmStatus() }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errMsg = (err as Error).message || "Internal server error";
    const errStack = (err as Error).stack || "";
    persistPromptTelemetry({
      request_id: requestId, user_id: telemetry?.userId || null,
      workspace_context: telemetry?.workspaceContext || "chat",
      is_content_gen: telemetry?.isContentGen || false,
      latency_ms: Date.now() - startedAt, ok: false, error: errMsg,
    }).catch(() => {});
    console.error("sos-chat error:", errMsg, errStack);
    return new Response(
      JSON.stringify({ error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
