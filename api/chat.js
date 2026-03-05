// Vercel serverless function — mirrors supabase/functions/sos-chat/index.ts
// Reads GROQ_API_KEY, GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY from env vars

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
      max_tokens: maxTokens,
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

/* ── Gemini generateContent ── */
async function callGemini(apiKey, systemPrompt, messages, maxTokens, imageBase64, imageMimeType) {
  const merged = [];

  for (const msg of messages) {
    const geminiRole = msg.role === "assistant" ? "model" : "user";
    const last = merged[merged.length - 1];
    if (last && last.role === geminiRole) {
      last.parts.push({ text: "\n" + msg.content });
    } else {
      merged.push({ role: geminiRole, parts: [{ text: msg.content }] });
    }
  }

  if (merged.length > 0 && merged[0].role !== "user") {
    merged.unshift({ role: "user", parts: [{ text: "(context)" }] });
  }

  if (imageBase64 && imageMimeType) {
    const lastUser = [...merged].reverse().find((m) => m.role === "user");
    if (lastUser) {
      lastUser.parts.push({ inlineData: { mimeType: imageMimeType, data: imageBase64 } });
    }
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: merged,
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return { content };
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
  if (!getRes.ok) {
    const errText = await getRes.text().catch(() => "");
    throw new Error(`Failed to load rate limit usage (${getRes.status}): ${errText}`);
  }
  const getData = await getRes.json();
  const used = Number(getData?.[0]?.count ?? 0);
  const DAILY_LIMIT = 5;

  if (used >= DAILY_LIMIT) {
    return { allowed: false, used };
  }

  const upsertRes = await fetch(`${supabaseUrl}/rest/v1/content_generations`, {
    method: "POST",
    headers: { ...headers, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ user_id: userId, date: todayEST, count: used + 1 }),
  });
  if (!upsertRes.ok) {
    const errText = await upsertRes.text().catch(() => "");
    throw new Error(`Failed to update rate limit usage (${upsertRes.status}): ${errText}`);
  }

  return { allowed: true, used: used + 1 };
}

/* ── Main handler ── */
module.exports = async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(200).end("ok");
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  const SUPABASE_URL =
    process.env.SUPABASE_URL || "https://evqylqgkzlbbrvogxsjn.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY not configured" });
  }

  try {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return res.status(400).json({ error: "Invalid JSON request body" });
    }

    // ── Voice transcription path ──
    if (body.mode === "voice") {
      const { audioBase64, audioMimeType } = body;
      if (!audioBase64) {
        return res.status(400).json({ error: "No audio data provided" });
      }

      const audioBuffer = Buffer.from(audioBase64, "base64");
      const audioBlob = new Blob([audioBuffer], { type: audioMimeType || "audio/webm" });
      const audioFile = new File([audioBlob], "voice.webm", {
        type: audioMimeType || "audio/webm",
      });

      const groqForm = new FormData();
      groqForm.append("file", audioFile, "voice.webm");
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
      provider,
      isContentGen,
      imageBase64,
      imageMimeType,
    } = body;

    if (typeof systemPrompt !== "string" || !Array.isArray(messages)) {
      return res
        .status(400)
        .json({ error: "systemPrompt must be a string and messages must be an array" });
    }

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

    let result;

    if (provider === "gemini") {
      if (!GEMINI_API_KEY) {
        // No Gemini key — fall back to llama-3.3-70b-versatile via Groq
        console.warn("No GEMINI_API_KEY, falling back to llama-3.3-70b-versatile via Groq");
        result = await callGroq(
          GROQ_API_KEY,
          "llama-3.3-70b-versatile",
          systemPrompt,
          messages,
          maxTokens
        );
      } else {
        try {
          result = await callGemini(
            GEMINI_API_KEY,
            systemPrompt,
            messages,
            maxTokens,
            imageBase64,
            imageMimeType
          );
        } catch (geminiErr) {
          // Gemini failed → fall back to llama-3.3-70b-versatile via Groq
          console.warn(
            "Gemini failed, falling back to llama-3.3-70b-versatile:",
            geminiErr.message
          );
          result = await callGroq(
            GROQ_API_KEY,
            "llama-3.3-70b-versatile",
            systemPrompt,
            messages,
            maxTokens
          );
        }
      }
    } else {
      result = await callGroq(
        GROQ_API_KEY,
        model || "llama-3.1-8b-instant",
        systemPrompt,
        messages,
        maxTokens
      );
    }

    return res.status(200).json(result);
  } catch (err) {
    console.error("api/chat error:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
};
