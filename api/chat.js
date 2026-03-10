// Vercel serverless function — mirrors supabase/functions/sos-chat/index.ts
// Reads GROQ_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from env vars

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/* ── Groq chat completion ── */
async function callGroq(apiKey, model, systemPrompt, messages, maxTokens) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      max_completion_tokens: maxTokens,
      temperature: 0.7,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq ${model} error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  return { content: data.choices?.[0]?.message?.content ?? "" };
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
module.exports = async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(200).end("ok");
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const SUPABASE_URL =
    process.env.SUPABASE_URL || "https://evqylqgkzlbbrvogxsjn.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY not configured" });
  }

  try {
    const body = req.body;

    // ── Voice transcription path ──
    if (body.mode === "voice") {
      const { audioBase64, audioMimeType } = body;
      if (!audioBase64) {
        return res.status(400).json({ error: "No audio data provided" });
      }

      const effectiveMime = audioMimeType || "audio/webm";
      const audioExt = effectiveMime.includes("mp4") || effectiveMime.includes("aac") ? "m4a"
        : effectiveMime.includes("ogg") ? "ogg"
        : effectiveMime.includes("mp3") ? "mp3"
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
        return res
          .status(groqRes.status)
          .json({ error: "Transcription failed", details: errText });
      }

      const whisperResult = await groqRes.json();
      return res.status(200).json({ text: whisperResult.text || "" });
    }

    // ── Chat completion path ──
    const {
      systemPrompt,
      messages,
      maxTokens = 1024,
      model,
      isContentGen,
      imageBase64,
      imageMimeType,
    } = body;

    // Rate limiting for content generation
    if (isContentGen && SUPABASE_SERVICE_ROLE_KEY) {
      const userId = extractUserId(req.headers.authorization);
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

    const effectiveModel = imageBase64
      ? "meta-llama/llama-4-scout-17b-16e-instruct"
      : (model || "llama-3.1-8b-instant");

    // For vision requests: use lean prompt + minimal history to avoid payload bloat & contamination
    let effectivePrompt = systemPrompt;
    let preparedMessages = [...messages];

    if (imageBase64) {
      effectivePrompt = "You are SOS, a chill study sidekick. The student sent you a photo. Describe what you see and help with any school-related content visible (homework, assignments, schedules, textbook pages, etc.). Be casual and brief (2-4 sentences). If you can identify specific tasks or deadlines, mention them clearly.";

      // Only keep last 2 messages — vision doesn't need full history
      preparedMessages = preparedMessages
        .filter(m => m.content && (typeof m.content !== 'string' || m.content.trim()))
        .slice(-2);

      if (preparedMessages.length > 0) {
        const lastIdx = preparedMessages.length - 1;
        const lastMsg = preparedMessages[lastIdx];
        const textContent = lastMsg.content || "What do you see in this image?";
        preparedMessages[lastIdx] = {
          role: lastMsg.role,
          content: [
            { type: "text", text: textContent },
            { type: "image_url", image_url: { url: `data:${imageMimeType || "image/jpeg"};base64,${imageBase64}` } },
          ],
        };
      }
    }

    const result = await callGroq(
      GROQ_API_KEY,
      effectiveModel,
      effectivePrompt,
      preparedMessages,
      maxTokens
    );

    return res.status(200).json(result);
  } catch (err) {
    console.error("api/chat error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};
