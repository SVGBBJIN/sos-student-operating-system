import {
  BACKUP_MODEL,
  callGroq,
  CONTENT_ACTION_TOOLS,
  CORE_CHECKSUM,
  CORE_VERSION,
  PRIMARY_MODEL,
} from "../shared/ai/chat-core.js";

// Vercel serverless function — mirrors supabase/functions/sos-chat/index.ts
// Reads ANTHROPIC_API_KEY, GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from env vars

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

console.log(`[chat-core] adapter=vercel version=${CORE_VERSION} checksum=${CORE_CHECKSUM}`);

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

function buildToolFallbackPrompt(failures = []) {
  const lines = failures.map((failure, idx) => {
    const actionType = failure?.action_type || "unknown_action";
    const category = failure?.category || "execution_failed";
    const detail = typeof failure?.detail === "string" ? failure.detail.trim() : "";
    const suggestion = Array.isArray(failure?.suggestions) ? failure.suggestions.filter(Boolean).join(" | ") : "";
    const parts = [
      `#${idx + 1}`,
      `action=${actionType}`,
      `category=${category}`,
      detail ? `detail=${detail}` : "",
      suggestion ? `candidates=${suggestion}` : "",
    ].filter(Boolean);
    return parts.join(" ; ");
  });
  return [
    "Tool execution failed client-side for one or more proposed actions.",
    "Write a concise, helpful follow-up question that asks only for the missing/ambiguous details needed to continue.",
    "If category=not_found: ask for exact title/date/time.",
    "If category=ambiguous: ask user to choose between candidate options.",
    "If category=validation_failed: ask for corrected fields using expected formats.",
    "Do not claim any action was completed.",
    "",
    "FAILURE_REPORT:",
    lines.join("\n"),
  ].join("\n");
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
  const stageTimings = {
    prompt_build_ms: 0,
    llm_call_ms: 0,
    parse_ms: 0,
    execution_ms: 0,
  };
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

    // ── Chat completion path (Groq) ──
    if (!GROQ_API_KEY) {
      return res.status(500).json({ error: "GROQ_API_KEY not configured" });
    }

    const {
      mode,
      systemPrompt,
      messages,
      maxTokens = 1024,
      isContentGen,
      imageBase64,
      imageMimeType,
      workspaceContext,
      prompt_version,
      context_chars,
      input_tokens_est,
      tool_failures,
    } = body;
    const userId = extractUserId(req.headers.authorization);
    telemetry = {
      userId,
      promptVersion: typeof prompt_version === "string" ? prompt_version : null,
      contextChars: Number(context_chars),
      inputTokensEst: Number(input_tokens_est),
      workspaceContext: typeof workspaceContext === "string" ? workspaceContext : "chat",
      isContentGen: Boolean(isContentGen),
    };
    const inputTokensEstimated = estimateInputTokens({
      systemPrompt,
      messages,
      inputTokensEst: telemetry?.inputTokensEst,
    });

    if (mode === "tool_fallback") {
      const fallbackMessages = Array.isArray(messages) ? messages.filter((m) => m && typeof m.content === "string") : [];
      const failureReport = buildToolFallbackPrompt(Array.isArray(tool_failures) ? tool_failures : []);
      const followupMessages = [
        ...fallbackMessages,
        { role: "user", content: failureReport },
      ];
      const llmStartedAt = Date.now();
      const fallbackResult = await callGroq(
        GROQ_API_KEY,
        PRIMARY_MODEL,
        `${systemPrompt || ""}\n\nWhen tool execution fails, ask a targeted clarification question.`,
        followupMessages,
        Math.min(Number(maxTokens) || 512, 512),
        null,
        null,
        false,
        null,
        "auto",
        BACKUP_MODEL,
        {
          isContentGen: false,
          routeType: "conversational",
        }
      );
      stageTimings.llm_call_ms = Date.now() - llmStartedAt;
      const fallbackParseStartedAt = Date.now();
      const toolCallStats = fallbackResult?.tool_call_stats || { proposed: 0, validated: 0 };
      stageTimings.parse_ms = Date.now() - fallbackParseStartedAt;
      const executionStartedAt = Date.now();
      const executionOutcomes = Array.isArray(tool_failures)
        ? tool_failures.map((failure) => toExecutionOutcome(failure?.outcome || failure?.category || "validation_error"))
        : [];
      stageTimings.execution_ms = Date.now() - executionStartedAt;
      const outputTokensEstimated = estimateTokensFromText(
        `${fallbackResult?.content || ""}\n${JSON.stringify(fallbackResult?.actions || [])}`
      );
      emitRequestEvent({
        event_type: "chat_request",
        request_id: requestId,
        prompt_version: telemetry?.promptVersion || null,
        model: {
          primary: PRIMARY_MODEL,
          backup: BACKUP_MODEL,
          selected: fallbackResult?.model_used || null,
          fallback_used: Boolean(fallbackResult?.fallback_used),
        },
        tokens: {
          input_est: inputTokensEstimated,
          output_est: outputTokensEstimated,
        },
        stages: stageTimings,
        tool_calls: {
          proposed: toolCallStats.proposed || 0,
          validated: toolCallStats.validated || 0,
          executed: 0,
        },
        execution_outcomes: executionOutcomes,
        status: "success",
      });
      return res.status(200).json({
        ...fallbackResult,
        actions: [],
        executed_actions: [],
        orchestration: { mode: "tool_fallback", executed_on: "server" },
      });
    }

    // Rate limiting for content generation
    if (isContentGen && SUPABASE_SERVICE_ROLE_KEY) {
      if (userId) {
        const { allowed, used } = await checkContentRateLimit(
          userId,
          SUPABASE_URL,
          SUPABASE_SERVICE_ROLE_KEY
        );
        if (!allowed) {
          return res.status(429).json({ error: "Rate limited", rateLimited: true, used });
        }
      }
    }

    const normalizedWorkspaceContext = typeof workspaceContext === "string"
      ? workspaceContext.trim().toLowerCase()
      : "chat";
    const latestUserMessage = [...(Array.isArray(messages) ? messages : [])]
      .reverse()
      .find((m) => m?.role === "user" && typeof m?.content === "string");
    const latestUserText = (latestUserMessage?.content || "").toLowerCase();
    const likelyToolHeavy = /(schedule|calendar|homework|assignment|deadline|task|plan|quiz|exam|note)/i.test(latestUserText)
      || normalizedWorkspaceContext === "schedule"
      || normalizedWorkspaceContext === "notes";
    const routeType = isContentGen || likelyToolHeavy ? "tool_heavy" : "conversational";
    const toolsForRequest = isContentGen ? CONTENT_ACTION_TOOLS : null;
    const toolChoice = isContentGen ? "required" : "auto";
    const contextPromptSuffix = `\n\nWORKSPACE_CONTEXT: ${normalizedWorkspaceContext}. Prioritize this context when relevant (schedule => planning/time/tasks, notes => note/doc references, chat/none => general).`;
    const promptBuildStartedAt = Date.now();
    const effectiveSystemPrompt = `${systemPrompt || ""}${contextPromptSuffix}`;
    stageTimings.prompt_build_ms = Date.now() - promptBuildStartedAt;

    // Always use full ACTION_TOOLS so the AI can call any tool based on actual message intent,
    // not regex-gated detection. openai/gpt-oss-120b handles chat + tool calling in one pass.
    const llmStartedAt = Date.now();
    const result = await callGroq(
      GROQ_API_KEY,
      PRIMARY_MODEL,
      effectiveSystemPrompt,
      messages,
      maxTokens,
      imageBase64,
      imageMimeType,
      true,         // includeTools — always on; model decides when to call tools
      toolsForRequest, // toolsOverride — content-gen is constrained to typed content tools
      toolChoice,
      BACKUP_MODEL, // fallback if primary fails or returns empty
      {
        isContentGen: Boolean(isContentGen),
        routeType,
      }
    );
    stageTimings.llm_call_ms = Date.now() - llmStartedAt;
    const parseStartedAt = Date.now();
    const toolCallStats = result?.tool_call_stats || { proposed: 0, validated: 0 };
    stageTimings.parse_ms = Date.now() - parseStartedAt;
    if (isContentGen && (!Array.isArray(result.actions) || result.actions.length === 0)) {
      throw new Error("Content generation must return typed actions[] payloads.");
    }

    const executionStartedAt = Date.now();
    const executionOutcomes = [
      ...(Array.isArray(result?.validation_warnings) && result.validation_warnings.length > 0
        ? result.validation_warnings.map(() => "validation_error")
        : []),
      ...(Array.isArray(tool_failures)
        ? tool_failures.map((failure) => toExecutionOutcome(failure?.outcome || failure?.category || "validation_error"))
        : []),
    ];
    stageTimings.execution_ms = Date.now() - executionStartedAt;
    const outputTokensEstimated = estimateTokensFromText(
      `${result?.content || ""}\n${JSON.stringify(result?.actions || [])}`
    );
    emitRequestEvent({
      event_type: "chat_request",
      request_id: requestId,
      prompt_version: telemetry?.promptVersion || null,
      model: {
        primary: PRIMARY_MODEL,
        backup: BACKUP_MODEL,
        selected: result?.model_used || null,
        fallback_used: Boolean(result?.fallback_used),
      },
      tokens: {
        input_est: inputTokensEstimated,
        output_est: outputTokensEstimated,
      },
      stages: stageTimings,
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
      isContentGen: telemetry?.isContentGen,
      latencyMs: Date.now() - startedAt,
      ok: true,
    });
    return res.status(200).json({
      ...result,
      executed_actions: [],
      orchestration: { mode: "client_execution", executed_on: "client" },
    });
  } catch (err) {
    emitRequestEvent({
      event_type: "chat_request",
      request_id: requestId,
      prompt_version: telemetry?.promptVersion || null,
      model: {
        primary: PRIMARY_MODEL,
        backup: BACKUP_MODEL,
        selected: null,
        fallback_used: false,
      },
      tokens: {
        input_est: Number.isFinite(telemetry?.inputTokensEst) ? telemetry.inputTokensEst : null,
        output_est: 0,
      },
      stages: stageTimings,
      tool_calls: {
        proposed: 0,
        validated: 0,
        executed: 0,
      },
      execution_outcomes: ["validation_error"],
      status: "error",
      error: err?.message || "Internal server error",
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
      isContentGen: telemetry?.isContentGen,
      latencyMs: Date.now() - startedAt,
      ok: false,
      errorMessage: err?.message || "Internal server error",
    });
    console.error("api/chat error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
}
