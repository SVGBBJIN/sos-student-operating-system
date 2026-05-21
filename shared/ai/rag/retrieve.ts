// Hybrid retrieval over the memory_embeddings table. Combines vector similarity
// with recency weighting + metadata filters. Calls the match_memories RPC
// declared in supabase/migrations/.

import { getEnv } from "../../env.js";
import { embedQuery } from "./embeddings.js";

export interface RetrievedChunk {
  id: string;
  source: string;
  source_id: string;
  text: string;
  similarity: number;
  metadata: Record<string, unknown>;
  recencyScore?: number;
  finalScore?: number;
  ageDays?: number;
}

export interface RetrieveOptions {
  userId: string;
  query: string;
  k?: number;
  sources?: string[];
  metadata?: Record<string, unknown>;
  recencyHalfLifeDays?: number;
  budgetMs?: number;
}

// Wall-clock cap on the embed + match_memories round-trips.
const RETRIEVE_BUDGET_MS = 4000;

function recencyWeight(ageDays: number, halfLifeDays: number): number {
  if (!isFinite(ageDays) || ageDays < 0) return 1;
  return Math.exp((-Math.LN2 * ageDays) / Math.max(1, halfLifeDays));
}

export async function retrieve(opts: RetrieveOptions): Promise<RetrievedChunk[]> {
  const supabaseUrl = getEnv("SUPABASE_URL");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return [];
  const k = opts.k ?? 8;
  const halfLife = opts.recencyHalfLifeDays ?? 30;

  // Bound the embed + RPC round-trips — retrieval runs before every
  // schedule-aware request and must never stall it.
  const budgetMs = opts.budgetMs ?? RETRIEVE_BUDGET_MS;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`retrieve timeout after ${budgetMs}ms`)),
    budgetMs
  );
  try {
    const embedding = await embedQuery(opts.query, 1536, controller.signal);
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/match_memories`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query_embedding: embedding,
        user_id_in: opts.userId,
        match_count: k * 2,
        source_filter: opts.sources ?? null,
        metadata_filter: opts.metadata ?? null,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const rows = (await res.json().catch(() => [])) as Array<RetrievedChunk & { created_at?: string }>;

    const now = Date.now();
    const scored = rows.map((row) => {
      const created = row.metadata && typeof (row.metadata as { created_at?: string }).created_at === "string"
        ? Date.parse((row.metadata as { created_at?: string }).created_at!)
        : NaN;
      const ageDays = isFinite(created) ? Math.max(0, (now - created) / 86_400_000) : 0;
      const recency = recencyWeight(ageDays, halfLife);
      const finalScore = row.similarity * recency;
      return { ...row, ageDays, recencyScore: recency, finalScore };
    });

    // Dedupe by source_id (keep top scoring chunk per source).
    const bySourceId = new Map<string, typeof scored[number]>();
    for (const r of scored) {
      const existing = bySourceId.get(r.source_id);
      if (!existing || (r.finalScore ?? 0) > (existing.finalScore ?? 0)) bySourceId.set(r.source_id, r);
    }
    const deduped = [...bySourceId.values()].sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0));
    return deduped.slice(0, k);
  } finally {
    clearTimeout(timer);
  }
}
