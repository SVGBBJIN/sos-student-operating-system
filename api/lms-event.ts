// Vercel transport for browser-extension LMS evidence. Thin shim over
// handleLmsEvent in shared/lms/ingest.ts so the Supabase Edge mirror cannot
// drift from this implementation. Mirrors api/embed.ts in shape.

import { handleLmsEvent } from "../shared/lms/ingest.js";
import { extractUserId } from "../shared/auth.js";
import { SCHEMA_VERSIONS } from "../shared/ai/index.js";

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

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(200).end("ok"); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const userId = extractUserId(req.headers.authorization as string | undefined);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as { events?: unknown };
    const events = body && typeof body === "object" && "events" in body ? body.events : body;

    const outcome = await handleLmsEvent({ userId, events });
    if (!outcome.ok) {
      res.status(outcome.status).json({ error: outcome.error, ...(outcome.issues ? { issues: outcome.issues } : {}) });
      return;
    }
    res.status(200).json({ schema_version: SCHEMA_VERSIONS.lms_event, results: outcome.results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/lms-event error:", message);
    res.status(500).json({ error: message });
  }
}
