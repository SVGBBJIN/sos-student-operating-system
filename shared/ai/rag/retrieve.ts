// Hybrid retrieval over the memory_embeddings table. Combines vector similarity
// with BM25 text scoring, recency weighting, negation handling, and metadata
// filters. Calls the match_memories RPC declared in supabase/migrations/.

import { getEnv } from "../../env.js";
import { embedQuery } from "./embeddings.js";

export interface RetrievedChunk {
  id: string;
  source: string;
  source_id: string;
  text: string;
  similarity: number;
  text_score?: number;
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

const RETRIEVE_BUDGET_MS = 4000;

// Matches "no/not/without/... <single-word>" — single-word capture avoids
// pulling stop words into the negation list (e.g. "no exam this week" →
// ["exam"], leaving "this week" as the positive query).
const NEGATION_RE =
  /\b(?:not?|without|except|excluding|no|don'?t|doesn'?t|didn'?t|can'?t|won'?t|isn'?t|aren'?t)\s+([\w]+)/gi;

function parseNegations(query: string): { positiveQuery: string; negatedTerms: string[] } {
  const negatedTerms: string[] = [];
  const positiveQuery = query
    .replace(NEGATION_RE, (_, term: string) => {
      negatedTerms.push(term.toLowerCase());
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { positiveQuery, negatedTerms };
}

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
    const { positiveQuery, negatedTerms } = parseNegations(opts.query);

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
        query_text: positiveQuery || null,
        negation_terms: negatedTerms.length > 0 ? negatedTerms : null,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const rows = (await res.json().catch(() => [])) as Array<RetrievedChunk & { created_at?: string }>;

    const now = Date.now();
    const scored = rows.map((row) => {
      const created =
        row.metadata && typeof (row.metadata as { created_at?: string }).created_at === "string"
          ? Date.parse((row.metadata as { created_at?: string }).created_at!)
          : NaN;
      const ageDays = isFinite(created) ? Math.max(0, (now - created) / 86_400_000) : 0;
      const recency = recencyWeight(ageDays, halfLife);
      // Blend vector similarity (0.7) and BM25 text score (0.3), then decay by age.
      // The SQL already applied the negation penalty to the candidate ordering, so
      // negation-penalised rows are unlikely to survive into the top-k after recency.
      const hybridSim = row.similarity * 0.7 + (row.text_score ?? 0) * 0.3;
      const finalScore = hybridSim * recency;
      return { ...row, ageDays, recencyScore: recency, finalScore };
    });

    // Dedupe by source_id (keep top scoring chunk per source).
    const bySourceId = new Map<string, (typeof scored)[number]>();
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
