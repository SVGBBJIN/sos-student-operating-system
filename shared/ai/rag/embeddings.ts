// Batched Gemini embeddings with concurrency and retry.

import { getEnv } from "../../env.js";
import { getProvider } from "../providers/index.js";
import { backoffMs, isRetryable } from "../resilience.js";
import type { EmbedRequest } from "../providers/types.js";

const BATCH = 100;
const CONCURRENCY = 4;
const MAX_RETRIES = 3;

function chunks<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function embedOnce(req: EmbedRequest): Promise<number[][]> {
  const apiKey = getEnv("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  const provider = getProvider("gemini", apiKey);
  const res = await provider.embed(req);
  return res.vectors;
}

async function embedWithRetry(req: EmbedRequest): Promise<number[][]> {
  let attempt = 0;
  while (true) {
    try {
      return await embedOnce(req);
    } catch (err) {
      attempt += 1;
      // An aborted request (budget exhausted) is terminal — never retry it.
      if (req.signal?.aborted || attempt > MAX_RETRIES || !isRetryable(err)) throw err;
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
    }
  }
}

export async function embedBatch(texts: string[], taskType: EmbedRequest["taskType"] = "RETRIEVAL_DOCUMENT", dim = 1536): Promise<number[][]> {
  if (texts.length === 0) return [];
  const batches = chunks(texts, BATCH);
  const results: number[][][] = new Array(batches.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= batches.length) return;
      results[i] = await embedWithRetry({ inputs: batches[i]!, taskType, dim });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, () => worker()));
  return results.flat();
}

export async function embedQuery(text: string, dim = 1536, signal?: AbortSignal): Promise<number[]> {
  const [vec] = await embedWithRetry({ inputs: [text], taskType: "RETRIEVAL_QUERY", dim, signal });
  if (!vec) throw new Error("embedQuery: no vector returned");
  return vec;
}
