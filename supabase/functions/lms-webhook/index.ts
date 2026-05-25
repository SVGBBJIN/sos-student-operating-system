// lms-webhook Edge Function — push-mode receiver.
//
// LMS sends:    POST /functions/v1/lms-webhook/{provider}
//
// All logic lives in shared/lms/webhook.ts. We never call extractUserId here —
// authentication is HMAC signature on the request body, not a Supabase JWT.

import { handleWebhook } from "../../../shared/lms/webhook.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-schoology-signature, x-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  // Path shape: /functions/v1/lms-webhook/{provider} → take the last non-empty segment.
  const segments = url.pathname.split("/").filter(Boolean);
  const provider = segments[segments.length - 1] || "";
  if (!provider || provider === "lms-webhook") {
    return new Response(JSON.stringify({ error: "missing provider in path" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const result = await handleWebhook(provider, req);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[lms-webhook] fatal", { provider, error: message });
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
