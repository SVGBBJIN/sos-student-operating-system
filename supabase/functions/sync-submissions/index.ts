// sync-submissions Edge Function — pull-mode orchestrator.
//
// Invocations:
//   - pg_cron, every 10 minutes, no body → sync every active pull integration
//   - per-user trigger, `POST { userId }` from the Step 3 immediate-sync
//
// All logic lives in shared/lms/orchestrator.ts so the Vercel proxy in
// api/lms-sync-trigger.ts cannot drift.

import { runSync } from "../../../shared/lms/orchestrator.js";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

  let userId: string | undefined;
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body === "object" && typeof (body as { userId?: unknown }).userId === "string") {
      userId = (body as { userId: string }).userId;
    }
  } catch {
    // empty body is fine — cron invocations have no body
  }

  try {
    const report = await runSync(userId ? { userId } : {});
    return new Response(JSON.stringify(report), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[sync-submissions] fatal", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
