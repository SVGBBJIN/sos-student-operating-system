import { runProofread } from "../shared/ai/proofread-pipeline.js";

// Vercel serverless function for the proofreading panel.
// Mirrors api/chat.js conventions (CORS, JWT extraction, content_generations rate limit).

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

export default async function handler(req, res) {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    return res.status(200).end("ok");
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  const SUPABASE_URL =
    process.env.SUPABASE_URL || "https://evqylqgkzlbbrvogxsjn.supabase.co";
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY not configured" });
  }

  try {
    const body = req.body || {};
    const { text, imageBase64, imageMimeType, prompt } = body;
    const userId = extractUserId(req.headers.authorization);

    if (!text && !imageBase64) {
      return res.status(400).json({ error: "Provide text or imageBase64." });
    }

    if (userId && SUPABASE_SERVICE_ROLE_KEY) {
      const { allowed, used } = await checkContentRateLimit(
        userId,
        SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY
      );
      if (!allowed) {
        return res
          .status(429)
          .json({ error: "Rate limited", rateLimited: true, used });
      }
    }

    const startedAt = Date.now();
    const { classification, results } = await runProofread({
      apiKey: GROQ_API_KEY,
      text: typeof text === "string" ? text : "",
      imageBase64: imageBase64 || null,
      imageMimeType: imageMimeType || null,
      prompt: typeof prompt === "string" ? prompt : "",
    });

    return res.status(200).json({
      classification,
      results,
      latency_ms: Date.now() - startedAt,
    });
  } catch (err) {
    console.error("api/proofread error:", err);
    return res
      .status(500)
      .json({ error: err?.message || "Internal server error" });
  }
}
