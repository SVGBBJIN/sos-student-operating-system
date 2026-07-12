// Vercel endpoint: fetch a public URL and return extracted readable text.
//
//   POST { url: string }  →  { title, text, url }
//
// No AI call here -- the client feeds the returned text into the existing
// study-pack generation pipeline (generateStudyPackInBackground in
// src/App.jsx), same as the Google Docs/PDF import paths.

import { extractUserId } from "../shared/auth.js";
import { extractArticle, ImportUrlError } from "../shared/import/extract.js";

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

    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as { url?: string };
    if (!body?.url || typeof body.url !== "string") {
      res.status(400).json({ error: "url is required" });
      return;
    }

    const result = await extractArticle(body.url);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof ImportUrlError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/import-url error:", message);
    res.status(500).json({ error: message });
  }
}
