// sos-lms-event Edge Function — browser-extension evidence ingest.
//
// Deno mirror of api/lms-event.ts. All scoring/matching/persistence lives in
// shared/lms/ingest.ts so the two runtimes cannot drift. See the sibling
// sos-chat function for the same transport-shim pattern.

import { handleLmsEvent } from "../../../shared/lms/ingest.js";
import { extractUserId } from "../../../shared/auth.js";
import { SCHEMA_VERSIONS } from "../../../shared/ai/index.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

console.log(`[sos-lms-event] adapter=supabase schema_version=${SCHEMA_VERSIONS.lms_event}`);

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const userId = extractUserId(req.headers.get("Authorization"));
    if (!userId) {
      return new Response(JSON.stringify({ error: "Authentication required" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const raw = (await req.json().catch(() => null)) as { events?: unknown } | unknown[] | null;
    const events =
      raw && typeof raw === "object" && !Array.isArray(raw) && "events" in raw ? (raw as { events: unknown }).events
      : raw;

    const outcome = await handleLmsEvent({ userId, events });
    if (!outcome.ok) {
      return new Response(JSON.stringify({ error: outcome.error, ...(outcome.issues ? { issues: outcome.issues } : {}) }), {
        status: outcome.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ schema_version: SCHEMA_VERSIONS.lms_event, results: outcome.results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("sos-lms-event error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
