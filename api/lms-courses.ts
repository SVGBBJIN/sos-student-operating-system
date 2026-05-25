// Vercel endpoint that lists the user's courses for a pull provider.
//
//   GET ?provider=classroom
//
// Calls the same adapter the orchestrator does, with the user's stored tokens,
// so we can never serve courses for an LMS the user hasn't connected.

import { extractUserId } from "../shared/auth.js";
import { listCoursesViaAdapter } from "../shared/lms/integrations.js";

interface VercelRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[] | undefined>;
  url?: string;
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
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(200).end("ok"); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "Method not allowed" }); return; }

  try {
    const userId = extractUserId(req.headers.authorization as string | undefined);
    if (!userId) { res.status(401).json({ error: "Authentication required" }); return; }

    const provider =
      (req.query?.provider as string | undefined) ??
      (req.url ? new URL(req.url, "http://x").searchParams.get("provider") || undefined : undefined);
    if (!provider) { res.status(400).json({ error: "provider query parameter is required" }); return; }

    const courses = await listCoursesViaAdapter(userId, provider);
    res.status(200).json({ courses });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/lms-courses error:", message);
    res.status(500).json({ error: message });
  }
}
