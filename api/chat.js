import {
  ACTION_TOOLS,
  callGroq,
  CORE_CHECKSUM,
  CORE_VERSION,
  getGroqRpmStatus,
  PRIMARY_MODEL,
  resolveModel,
  STUDIO_TOOLS,
} from "../shared/ai/chat-core.js";
import { runPlanningPipeline } from "../shared/ai/planning-pipeline.js";

console.log(`[chat-core] adapter=vercel version=${CORE_VERSION} checksum=${CORE_CHECKSUM}`);

// Vercel serverless function — mirrors supabase/functions/sos-chat/index.ts

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function estimateTokensFromText(text) {
  const normalized = typeof text === "string" ? text : "";
  return Math.max(0, Math.ceil(normalized.length / 4));
}

function estimateInputTokens({ systemPrompt, messages, inputTokensEst }) {
  if (Number.isFinite(inputTokensEst) && inputTokensEst > 0) {
    return Math.round(inputTokensEst);
  }
  const msgText = Array.isArray(messages)
    ? messages.map((m) => (typeof m?.content === "string" ? m.content : "")).join("\n")
    : "";
  return estimateTokensFromText(`${systemPrompt || ""}\n${msgText}`);
}

function toExecutionOutcome(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "success") return "success";
  if (normalized === "not_found") return "not_found";
  if (normalized === "validation_error" || normalized === "validation_failed") return "validation_error";
  if (normalized === "duplicate_skipped" || normalized === "duplicate") return "duplicate_skipped";
  return "validation_error";
}

function emitRequestEvent(event) {
  console.log("chat_request_event", JSON.stringify(event));
}

async function persistPromptTelemetry({
  supabaseUrl,
  serviceKey,
  userId,
  requestId,
  promptVersion,
  contextChars,
  inputTokensEst,
  workspaceContext,
  isContentGen,
  latencyMs,
  ok,
  errorMessage,
}) {
  const payload = {
    request_id: requestId,
    user_id: userId,
    prompt_version: promptVersion || null,
    context_chars: Number.isFinite(contextChars) ? contextChars : null,
    input_tokens_est: Number.isFinite(inputTokensEst) ? inputTokensEst : null,
    workspace_context: workspaceContext || "chat",
    is_content_gen: Boolean(isContentGen),
    latency_ms: Number.isFinite(latencyMs) ? latencyMs : null,
    ok: Boolean(ok),
    error: errorMessage || null,
    created_at: new Date().toISOString(),
  };

  console.log("chat_prompt_telemetry", payload);

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
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn("prompt telemetry persistence failed:", err?.message || err);
  }
}

/* ── Extract user ID from JWT ── */
function extractUserId(authHeader) {
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64").toString("utf8")
    );
    return payload.sub || null;
  } catch {
    return null;
  }
}

/* ── Rate limiting for content generation (via Supabase REST API) ── */
async function checkContentRateLimit(userId, supabaseUrl, serviceKey) {
  const now = new Date();
  const estNow = new Date(now.getTime() + -5 * 60 * 60 * 1000);
  const todayEST =
    estNow.getFullYear() +
    "-" +
    String(estNow.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(estNow.getDate()).padStart(2, "0");

  const headers = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "application/json",
  };

  const getRes = await fetch(
    `${supabaseUrl}/rest/v1/content_generations?user_id=eq.${userId}&date=eq.${todayEST}&select=count`,
    { headers }
  );
  const getData = await getRes.json();
  const used = getData?.[0]?.count ?? 0;
  const DAILY_LIMIT = 5;

  if (used >= DAILY_LIMIT) {
    return { allowed: false, used };
  }

  await fetch(`${supabaseUrl}/rest/v1/content_generations`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, date: todayEST, count: used + 1 }),
  });

  return { allowed: true, used: used + 1 };
}

/* ── Main handler ── */
export default async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(200).end("ok");
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const SUPABASE_URL =
    process.env.SUPABASE_URL || "https://evqylqgkzlbbrvogxsjn.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const startedAt = Date.now();
  const requestId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  let telemetry = null;

  try {
    const body = req.body;

    // ── Voice transcription path (Groq Whisper) ──
    if (body.mode === "voice") {
      if (!GROQ_API_KEY) {
        return res.status(500).json({ error: "GROQ_API_KEY not configured" });
      }
      const { audioBase64, audioMimeType } = body;
      if (!audioBase64) {
        return res.status(400).json({ error: "No audio data provided" });
      }

      const effectiveMime = audioMimeType || "audio/webm";
      const audioExt = effectiveMime.includes("mp4") || effectiveMime.includes("aac")
        ? "m4a"
        : effectiveMime.includes("ogg")
        ? "ogg"
        : effectiveMime.includes("mp3")
        ? "mp3"
        : "webm";
      const audioBuffer = Buffer.from(audioBase64, "base64");
      const audioBlob = new Blob([audioBuffer], { type: effectiveMime });
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
          headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
          body: groqForm,
        }
      );

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        console.error("Groq Whisper error:", groqRes.status, errText);
        return res.status(groqRes.status).json({ error: "Transcription failed", details: errText });
      }

      const whisperResult = await groqRes.json();
      return res.status(200).json({ text: whisperResult.text || "" });
    }

    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: "GROQ_API_KEY not configured" });
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
      tool_failures,
    } = body;
    const preferredModel = resolveModel(body.preferredModel);
    const userId = extractUserId(req.headers.authorization);
    telemetry = {
      userId,
      promptVersion: typeof prompt_version === "string" ? prompt_version : null,
      contextChars: Number(context_chars),
      inputTokensEst: Number(input_tokens_est),
      workspaceContext: typeof workspaceContext === "string" ? workspaceContext : "chat",
      isContentGen: mode === "studio",
    };
    const inputTokensEstimated = estimateInputTokens({
      systemPrompt,
      messages,
      inputTokensEst: telemetry?.inputTokensEst,
    });

    // ── Studio (content generation) path ──
    // Uses STUDIO_TOOLS with tool_choice required so the model always returns structured output.
    if (mode === "studio") {
      if (userId && SUPABASE_SERVICE_ROLE_KEY) {
        const { allowed, used } = await checkContentRateLimit(userId, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        if (!allowed) {
          return res.status(429).json({ error: "Rate limited", rateLimited: true, used });
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

      await persistPromptTelemetry({
        supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_ROLE_KEY,
        userId, requestId, promptVersion: telemetry?.promptVersion,
        contextChars: telemetry?.contextChars, inputTokensEst: telemetry?.inputTokensEst,
        workspaceContext: "studio", isContentGen: true, latencyMs: Date.now() - startedAt, ok: true,
      });

      return res.status(200).json({
        ...studioResult,
        executed_actions: [],
        orchestration: { mode: "studio", executed_on: "client" },
        rpm: getGroqRpmStatus(),
      });
    }

    // ── Planning pipeline (agentic 3-pass: draft → critique → refine) ──
    if (mode === "planning") {
      if (userId && SUPABASE_SERVICE_ROLE_KEY) {
        const { allowed, used } = await checkContentRateLimit(userId, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        if (!allowed) {
          return res.status(429).json({ error: "Rate limited", rateLimited: true, used });
        }
      }
      const normalizedWs = typeof workspaceContext === "string" ? workspaceContext.trim().toLowerCase() : "studio";
      const planDynamic = dynamicContext ? `${dynamicContext}\n\nWORKSPACE_CONTEXT: ${normalizedWs}` : null;
      const { proposal, critiqueText, iterations } = await runPlanningPipeline({
        apiKey: GROQ_API_KEY,
        systemPrompt: systemPrompt || "",
        staticSystemPrompt: staticSystemPrompt || null,
        dynamicContext: planDynamic,
        messages,
      });
      await persistPromptTelemetry({
        supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_ROLE_KEY,
        userId, requestId, promptVersion: telemetry?.promptVersion,
        contextChars: telemetry?.contextChars, inputTokensEst: telemetry?.inputTokensEst,
        workspaceContext: "planning", isContentGen: true, latencyMs: Date.now() - startedAt, ok: true,
      });
      return res.status(200).json({
        content: "",
        actions: [proposal],
        clarifications: [],
        executed_actions: [],
        orchestration: { mode: "planning", iterations, executed_on: "client" },
        planning_critique: critiqueText,
        rpm: getGroqRpmStatus(),
      });
    }

    // ── Normal chat path ──
    // All chat requests use ACTION_TOOLS with reasoning_effort:high on PRIMARY_MODEL.
    // No route-based model switching — one model handles everything.
    const normalizedWorkspaceContext = typeof workspaceContext === "string"
      ? workspaceContext.trim().toLowerCase()
      : "chat";
    const contextPromptSuffix = `\n\nWORKSPACE_CONTEXT: ${normalizedWorkspaceContext}. Prioritize this context when relevant (schedule => planning/time/tasks, notes => note/doc references, chat/none => general).\n\nCLARIFICATION RULE: If a required field is missing for an action, respond with plain text asking for the specific missing detail — do not call any tool with placeholder values. For greetings, small talk, or messages with no action intent, respond naturally without calling any tool.`;
    // Only append suffix to dynamicContext (per-request) so the staticSystemPrompt stays
    // byte-identical across all requests, preserving Groq's prompt cache.
    const effectiveDynamic = dynamicContext ? `${dynamicContext}${contextPromptSuffix}` : null;
    const effectiveSystemPrompt = `${systemPrompt || ""}${contextPromptSuffix}`;

    const callOptions = {
      isContentGen: false,
      staticSystemPrompt: staticSystemPrompt || null,
      dynamicContext: effectiveDynamic,
    };

    const llmStartedAt = Date.now();
    const result = await callGroq(
      GROQ_API_KEY,
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
    const llmMs = Date.now() - llmStartedAt;

    const toolCallStats = result?.tool_call_stats || { proposed: 0, validated: 0 };
    const executionOutcomes = [
      ...(Array.isArray(result?.validation_warnings) && result.validation_warnings.length > 0
        ? result.validation_warnings.map(() => "validation_error")
        : []),
      ...(Array.isArray(tool_failures)
        ? tool_failures.map((f) => toExecutionOutcome(f?.outcome || f?.category || "validation_error"))
        : []),
    ];
    const outputTokensEstimated = estimateTokensFromText(
      `${result?.content || ""}\n${JSON.stringify(result?.actions || [])}`
    );

    emitRequestEvent({
      event_type: "chat_request",
      request_id: requestId,
      prompt: {
        version: telemetry?.promptVersion || null,
        flags: telemetry?.promptFlags || null,
        workspace_context: telemetry?.workspaceContext || "chat",
      },
      model: {
        primary: PRIMARY_MODEL,
        selected: result?.model_used || null,
        fallback_used: Boolean(result?.fallback_used),
      },
      tokens: { input_est: inputTokensEstimated, output_est: outputTokensEstimated },
      stages: { llm_call_ms: llmMs },
      tool_calls: {
        proposed: toolCallStats.proposed || 0,
        validated: toolCallStats.validated || 0,
        executed: 0,
      },
      execution_outcomes: executionOutcomes,
      status: "success",
    });

    await persistPromptTelemetry({
      supabaseUrl: SUPABASE_URL,
      serviceKey: SUPABASE_SERVICE_ROLE_KEY,
      userId: telemetry?.userId || null,
      requestId,
      promptVersion: telemetry?.promptVersion,
      contextChars: telemetry?.contextChars,
      inputTokensEst: telemetry?.inputTokensEst,
      workspaceContext: telemetry?.workspaceContext,
      isContentGen: false,
      latencyMs: Date.now() - startedAt,
      ok: true,
    });

    return res.status(200).json({
      ...result,
      executed_actions: [],
      orchestration: { mode: "client_execution", executed_on: "client" },
      rpm: getGroqRpmStatus(),
    });
  } catch (err) {
    emitRequestEvent({
      event_type: "chat_request",
      request_id: requestId,
      prompt: {
        version: telemetry?.promptVersion || null,
        workspace_context: telemetry?.workspaceContext || "chat",
      },
      model: { primary: PRIMARY_MODEL, selected: null, fallback_used: false },
      tokens: { input_est: 0, output_est: 0 },
      stages: {},
      tool_calls: { proposed: 0, validated: 0, executed: 0 },
      execution_outcomes: ["validation_error"],
      status: "error",
      error: err?.message || "Internal server error",
    });
    await persistPromptTelemetry({
      supabaseUrl: SUPABASE_URL || "",
      serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      userId: telemetry?.userId || null,
      requestId,
      promptVersion: telemetry?.promptVersion,
      contextChars: telemetry?.contextChars,
      inputTokensEst: telemetry?.inputTokensEst,
      workspaceContext: telemetry?.workspaceContext,
      isContentGen: telemetry?.isContentGen || false,
      latencyMs: Date.now() - startedAt,
      ok: false,
      errorMessage: err?.message || "Internal server error",
    });
    console.error("api/chat error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
