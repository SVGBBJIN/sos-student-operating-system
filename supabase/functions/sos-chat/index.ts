import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/* ── Groq chat completion ── */
async function callGroq(
  apiKey: string,
  model: string,
  systemPrompt: string,
  messages: { role: string; content: string | { type: string; text?: string; image_url?: { url: string } }[] }[],
  maxTokens: number
): Promise<{ content: string }> {
  const body = {
    model,
    messages: [{ role: "system", content: systemPrompt }, ...messages],
    max_tokens: maxTokens,
    temperature: 0.7,
  };

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Groq ${model} error ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content ?? "";
  return { content };
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

  // Increment
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");

    if (!GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ error: "GROQ_API_KEY not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const body = await req.json();

    // ── Voice transcription path ──
    if (body.mode === "voice") {
      const { audioBase64, audioMimeType } = body;
      if (!audioBase64) {
        return new Response(
          JSON.stringify({ error: "No audio data provided" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Decode base64 → binary → Blob → File for Groq
      const binaryStr = atob(audioBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const effectiveMime = audioMimeType || "audio/webm";
      const audioExt = effectiveMime.includes("mp4") || effectiveMime.includes("aac") ? "m4a"
        : effectiveMime.includes("ogg") ? "ogg"
        : effectiveMime.includes("mp3") ? "mp3"
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
          headers: { Authorization: `Bearer ${GROQ_API_KEY}` },
          body: groqForm,
        }
      );

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        console.error("Groq Whisper error:", groqRes.status, errText);
        return new Response(
          JSON.stringify({ error: "Transcription failed", details: errText }),
          { status: groqRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const whisperResult = await groqRes.json();
      return new Response(
        JSON.stringify({ text: whisperResult.text || "" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
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
    if (isContentGen) {
      const userId = extractUserId(req.headers.get("Authorization"));
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

    const effectiveModel = imageBase64
      ? "meta-llama/llama-4-scout-17b-16e-instruct"
      : (model || "llama-3.1-8b-instant");

    const preparedMessages = [...messages];
    if (imageBase64 && preparedMessages.length > 0) {
      const lastIdx = preparedMessages.length - 1;
      const lastMsg = preparedMessages[lastIdx];
      preparedMessages[lastIdx] = {
        role: lastMsg.role,
        content: [
          { type: "text", text: lastMsg.content as string },
          { type: "image_url", image_url: { url: `data:${imageMimeType || "image/jpeg"};base64,${imageBase64}` } },
        ],
      };
    }

    const result = await callGroq(GROQ_API_KEY, effectiveModel, systemPrompt, preparedMessages, maxTokens);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("sos-chat error:", err);
    return new Response(
      JSON.stringify({
        error: (err as Error).message || "Internal server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
