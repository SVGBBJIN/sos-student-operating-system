// Deno edge function mirroring api/proofread.js. Same shape: POST { text, imageBase64,
// imageMimeType, prompt }. Calls runProofread() from shared/ai/proofread-pipeline.js.

import { runProofread } from "../../../shared/ai/proofread-pipeline.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
  if (used >= DAILY_LIMIT) return { allowed: false, used };

  await sb.from("content_generations").upsert(
    { user_id: userId, date: todayEST, count: used + 1 },
    { onConflict: "user_id,date" }
  );

  return { allowed: true, used: used + 1 };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY");
  if (!GROQ_API_KEY) {
    return new Response(
      JSON.stringify({ error: "GROQ_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const body = await req.json();
    const { text, imageBase64, imageMimeType, prompt } = body;
    const userId = extractUserId(req.headers.get("Authorization"));

    if (!text && !imageBase64) {
      return new Response(
        JSON.stringify({ error: "Provide text or imageBase64." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (userId) {
      const { allowed, used } = await checkContentRateLimit(userId);
      if (!allowed) {
        return new Response(
          JSON.stringify({ error: "Rate limited", rateLimited: true, used }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
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

    return new Response(
      JSON.stringify({ classification, results, latency_ms: Date.now() - startedAt }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    const errMsg = (err as Error).message || "Internal server error";
    console.error("sos-proofread error:", errMsg);
    return new Response(JSON.stringify({ error: errMsg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
