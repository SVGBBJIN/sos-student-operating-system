// Vercel endpoint for student confirmation/rejection of pending LMS auto-closes.
//
// POST { taskId: string, confirm: boolean }
//   confirm=true  → mark the task done (same shape as markTaskCompleted in ingest.ts)
//   confirm=false → clear the pending flag, leave task open

import { extractUserId } from "../shared/auth.js";
import { getEnv } from "../shared/env.js";

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}
interface VercelResponse {
  status(code: number): VercelResponse;
  setHeader(name: string, value: string): void;
  json(payload: unknown): void;
  end(payload?: string): void;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function supabaseHeaders(key: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    apikey: key,
    "Content-Type": "application/json",
    ...extra,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(200).end("ok"); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const userId = extractUserId(req.headers.authorization as string | undefined);
  if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) { res.status(500).json({ error: "Supabase not configured" }); return; }

  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as { taskId?: string; confirm?: boolean };
    const { taskId, confirm } = body ?? {};
    if (!taskId || typeof confirm !== "boolean") {
      res.status(400).json({ error: "taskId and confirm (boolean) are required" });
      return;
    }

    const nowIso = new Date().toISOString();
    const patchUrl = `${supabaseUrl}/rest/v1/tasks?id=eq.${encodeURIComponent(taskId)}&user_id=eq.${encodeURIComponent(userId)}&lms_pending_close=eq.true`;

    if (confirm) {
      // Student confirmed — promote to done.
      await fetch(patchUrl, {
        method: "PATCH",
        headers: supabaseHeaders(serviceKey, { Prefer: "return=minimal" }),
        body: JSON.stringify({
          status: "done",
          completed_at: nowIso,
          completion_source: "lms",
          lms_pending_close: false,
          lms_pending_close_at: null,
        }),
      });
      // Record the completion in task_events so behavioral signals treat it
      // identically to a manual or auto complete.
      await fetch(`${supabaseUrl}/rest/v1/task_events`, {
        method: "POST",
        headers: supabaseHeaders(serviceKey, { Prefer: "return=minimal" }),
        body: JSON.stringify({
          user_id: userId,
          task_id: taskId,
          event_type: "complete",
          from_status: null,
          to_status: "done",
          occurred_at: nowIso,
          metadata: { source: "lms_confirmed" },
        }),
      });
      res.status(200).json({ action: "confirmed" });
    } else {
      // Student said "not yet" — clear the pending flag, keep task open.
      await fetch(patchUrl, {
        method: "PATCH",
        headers: supabaseHeaders(serviceKey, { Prefer: "return=minimal" }),
        body: JSON.stringify({
          lms_pending_close: false,
          lms_pending_close_at: null,
          completion_confidence: null,
        }),
      });
      res.status(200).json({ action: "rejected" });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/lms-confirm error:", message);
    res.status(500).json({ error: message });
  }
}
