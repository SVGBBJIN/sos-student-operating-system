// Vercel proofread handler — thin transport around runProofread().

import { runProofread } from "../shared/ai/index.js";
import { getEnv } from "../shared/env.js";
import { extractUserId } from "../shared/auth.js";
import { checkContentRateLimit } from "../shared/rate-limit.js";

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

interface ProofreadBody {
  text?: string;
  imageBase64?: string;
  imageMimeType?: string;
  prompt?: string;
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
    const body = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as ProofreadBody;
    const userId = extractUserId(req.headers.authorization as string | undefined);
    if (!body.text && !body.imageBase64) {
      res.status(400).json({ error: "Provide text or imageBase64." });
      return;
    }
    if (userId) {
      const rl = await checkContentRateLimit(userId);
      if (!rl.allowed) {
        res.status(429).json({ error: "Rate limited", rateLimited: true, used: rl.used });
        return;
      }
    }
    const startedAt = Date.now();
    const { classification, results } = await runProofread({
      text: body.text ?? "",
      imageBase64: body.imageBase64 ?? null,
      imageMimeType: body.imageMimeType ?? null,
      prompt: body.prompt ?? "",
    });
    res.status(200).json({ classification, results, latency_ms: Date.now() - startedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("api/proofread error:", message);
    res.status(500).json({ error: message });
  }
}
