// sos-proofread Edge Function — Gemini-native. Mirrors api/proofread.ts.

import { runProofread } from "../../../shared/ai/index.js";
import { getEnv } from "../../../shared/env.js";
import { extractUserId } from "../../../shared/auth.js";
import { checkContentRateLimit } from "../../../shared/rate-limit.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProofreadBody {
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  prompt?: string;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!getEnv("GEMINI_API_KEY")) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY is not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = (await req.json()) as ProofreadBody;
    const userId = extractUserId(req.headers.get("Authorization"));
    if (!body.text && !body.imageBase64) {
      return new Response(JSON.stringify({ error: "Provide text or imageBase64." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (userId) {
      const rl = await checkContentRateLimit(userId);
      if (!rl.allowed) {
        return new Response(JSON.stringify({ error: "Rate limited", rateLimited: true, used: rl.used }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    const startedAt = Date.now();
    const { classification, results } = await runProofread({
      text: body.text ?? "",
      imageBase64: body.imageBase64 ?? null,
      imageMimeType: body.imageMimeType ?? null,
      prompt: body.prompt ?? "",
    });
    return new Response(JSON.stringify({ classification, results, latency_ms: Date.now() - startedAt }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sos-proofread error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
