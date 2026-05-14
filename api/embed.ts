// Vercel embed endpoint. Accepts { inputs: string[], taskType?, dim? } and
// returns 1536-dim vectors. Used by client-driven indexing (e.g. backfilling
// notes the user just edited) and by future server jobs.

import { embedBatch } from "../shared/ai/index.js";
import { getEnv } from "../shared/env.js";
import { extractUserId } from "../shared/auth.js";

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

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" | "SEMANTIC_SIMILARITY" | "CLASSIFICATION" | "CLUSTERING";

interface EmbedBody {
  inputs?: string[];
  taskType?: TaskType;
  dim?: number;
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);
  if (req.method === "OPTIONS") { res.status(200).end("ok"); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  if (!getEnv("GEMINI_API_KEY")) {
    res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
    return;
  }

  try {
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as EmbedBody;
    const userId = extractUserId(req.headers.authorization as string | undefined);
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (!Array.isArray(body.inputs) || body.inputs.length === 0) {
      res.status(400).json({ error: "inputs[] is required" });
      return;
    }
    if (body.inputs.length > 200) {
      res.status(400).json({ error: "Too many inputs (max 200 per request)" });
      return;
    }
    const vectors = await embedBatch(body.inputs, body.taskType ?? "RETRIEVAL_DOCUMENT", body.dim ?? 1536);
    res.status(200).json({ vectors, model: "gemini-embedding-002", dim: body.dim ?? 1536 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/embed error:", message);
    res.status(500).json({ error: message });
  }
}
