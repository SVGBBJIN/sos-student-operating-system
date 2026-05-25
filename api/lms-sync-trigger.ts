// Vercel endpoint that runs a one-off sync for the authenticated user.
//
//   POST  (no body)
//
// Calls runSync({ userId }) directly — same code path the cron-scheduled Edge
// Function uses — so behavior cannot diverge between immediate and scheduled.

import { extractUserId } from "../shared/auth.js";
import { runSync } from "../shared/lms/orchestrator.js";

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(200).end("ok"); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const userId = extractUserId(req.headers.authorization as string | undefined);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const report = await runSync({ userId });
    res.status(200).json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/lms-sync-trigger error:", message);
    res.status(500).json({ error: message });
  }
}
