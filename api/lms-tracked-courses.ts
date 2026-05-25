// Vercel endpoint to save a user's course selections.
//
//   POST { provider: 'classroom', selections: [{ externalCourseId, courseName }] }

import { extractUserId } from "../shared/auth.js";
import { saveTrackedCourses } from "../shared/lms/integrations.js";

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

interface Body {
  provider?: string;
  selections?: Array<{ externalCourseId?: string; courseName?: string | null }>;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(200).end("ok"); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const userId = extractUserId(req.headers.authorization as string | undefined);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const body = (typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {})) as Body;
    if (!body.provider || !Array.isArray(body.selections)) {
      res.status(400).json({ error: "provider and selections[] are required" });
      return;
    }
    const cleaned = body.selections
      .filter((s) => s && typeof s.externalCourseId === "string" && s.externalCourseId.length > 0)
      .map((s) => ({ externalCourseId: s.externalCourseId as string, courseName: s.courseName ?? null }));

    await saveTrackedCourses(userId, body.provider, cleaned);
    res.status(200).json({ ok: true, saved: cleaned.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/lms-tracked-courses error:", message);
    res.status(500).json({ error: message });
  }
}
