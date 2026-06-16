// Batched Gemini embeddings with concurrency and retry.

import { getEnv } from "../../env.js";
import { getProvider } from "../providers/index.js";
import { backoffMs, isRetryable } from "../resilience.js";
import { embedModel } from "../router.js";
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

// ── Request coalescer ─────────────────────────────────────────────────────────
// The embedding API is request-bound (100 RPM / 1k RPD) but token-rich (30K
// TPM). So spending a whole request on a handful of words is wasteful. This
// coalesces embed calls that arrive within a short window and share the same
// (model, taskType, dim) into a single upstream request, then scatters the
// result back to each caller. Under concurrent load — exactly when RPM matters —
// many turns' embeds collapse into one request; under no load a call just waits
// one flush tick. Each caller's inputs stay contiguous so results slice cleanly.

interface PendingEmbed {
  texts: string[];
  resolve: (vecs: number[][]) => void;
  reject: (err: unknown) => void;
}

interface CoalesceQueue {
  items: PendingEmbed[];
  timer: ReturnType<typeof setTimeout> | null;
}

const FLUSH_MS = 15;
// Per upstream request: stay well under the API's input cap and TPM ceiling.
const MAX_BATCH_INPUTS = 100;
const MAX_BATCH_CHARS = 24_000; // ~6k tokens at ~4 chars/token — far below 30K TPM

const coalesceQueues = new Map<string, CoalesceQueue>();

function flushCoalesceQueue(key: string, taskType: EmbedRequest["taskType"], dim: number, model: string): void {
  const q = coalesceQueues.get(key);
  if (!q) return;
  coalesceQueues.delete(key);

  const runBatch = (group: PendingEmbed[], texts: string[]): Promise<void> =>
    embedWithRetry({ inputs: texts, taskType, dim, model }).then(
      (vectors) => {
        let off = 0;
        for (const it of group) {
          it.resolve(vectors.slice(off, off + it.texts.length));
          off += it.texts.length;
        }
      },
      (err) => {
        for (const it of group) it.reject(err);
      }
    );

  // Pack callers into upstream batches respecting the input + char caps.
  const flushes: Promise<void>[] = [];
  let group: PendingEmbed[] = [];
  let groupTexts: string[] = [];
  let groupChars = 0;
  for (const it of q.items) {
    const itChars = it.texts.reduce((s, t) => s + t.length, 0);
    if (group.length > 0 && (groupTexts.length + it.texts.length > MAX_BATCH_INPUTS || groupChars + itChars > MAX_BATCH_CHARS)) {
      flushes.push(runBatch(group, groupTexts));
      group = []; groupTexts = []; groupChars = 0;
    }
    group.push(it);
    groupTexts.push(...it.texts);
    groupChars += itChars;
  }
  if (group.length > 0) flushes.push(runBatch(group, groupTexts));
  void Promise.all(flushes);
}

export interface CoalesceOptions {
  taskType?: EmbedRequest["taskType"];
  dim?: number;
  model?: string;
}

// Embed a caller's texts, coalescing with other in-flight calls of the same
// (model, taskType, dim). Returns vectors 1:1 with `texts`.
export function embedCoalesced(texts: string[], opts: CoalesceOptions = {}): Promise<number[][]> {
  if (texts.length === 0) return Promise.resolve([]);
  const taskType = opts.taskType ?? "RETRIEVAL_DOCUMENT";
  const dim = opts.dim ?? 1536;
  const model = opts.model ?? embedModel("primary");
  const key = `${model}::${taskType}::${dim}`;
  return new Promise<number[][]>((resolve, reject) => {
    let q = coalesceQueues.get(key);
    if (!q) { q = { items: [], timer: null }; coalesceQueues.set(key, q); }
    q.items.push({ texts, resolve, reject });
    if (q.timer === null) {
      q.timer = setTimeout(() => flushCoalesceQueue(key, taskType, dim, model), FLUSH_MS);
    }
  });
}
