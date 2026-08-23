// Index synced course material into memory_embeddings so RAG retrieval picks it
// up with no change to retrieve() or match_memories.
//
// Runs under the service role (the sync has no user bearer token), which is why
// it writes directly rather than calling the embed-batch function — that
// endpoint deliberately derives user_id from the caller's own JWT.

import { embedBatch } from "../ai/rag/embeddings.js";
import { upsertRows, type SupabaseRest } from "./supabaseRest.js";

/** Gemini's embedding input ceiling, with headroom for the title prefix. */
const CHUNK_CHARS = 1800;
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS_PER_ITEM = 12;
const EMBED_BATCH_SIZE = 50;

export interface IndexableItem {
  source: "lms_content" | "attachment";
  sourceId: string;
  title: string | null;
  text: string;
  metadata?: Record<string, unknown>;
}

/**
 * Split on paragraph boundaries where possible — a chunk that ends mid-sentence
 * retrieves worse than one that ends at a break.
 */
export function chunkText(text: string): string[] {
  const clean = text.trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_CHARS) return [clean];

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < clean.length && chunks.length < MAX_CHUNKS_PER_ITEM) {
    let end = Math.min(cursor + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      const window = clean.slice(cursor, end);
      const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
      // Only honour the break if it isn't so early that we'd waste the chunk.
      if (breakAt > CHUNK_CHARS * 0.5) end = cursor + breakAt;
    }
    const piece = clean.slice(cursor, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    cursor = Math.max(end - CHUNK_OVERLAP, cursor + 1);
  }
  return chunks;
}

interface EmbeddingRow {
  user_id: string;
  source: string;
  source_id: string;
  chunk_idx: number;
  text: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

/**
 * Embed and upsert. Returns the number of chunks written. Never throws — a
 * failed embedding must not cost the caller its already-persisted content rows;
 * the next sync will retry.
 */
export async function indexItems(
  ctx: SupabaseRest,
  userId: string,
  items: IndexableItem[]
): Promise<number> {
  if (items.length === 0) return 0;

  // Flatten to chunks first so one embed call can span several items.
  const pending: Array<{ item: IndexableItem; chunkIdx: number; text: string }> = [];
  for (const item of items) {
    const chunks = chunkText(item.text);
    chunks.forEach((chunk, chunkIdx) => {
      // Prefixing the title gives the vector some of the document's identity,
      // which matters for short chunks pulled from the middle of a long page.
      const text = item.title ? `${item.title}\n\n${chunk}` : chunk;
      pending.push({ item, chunkIdx, text });
    });
  }
  if (pending.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < pending.length; i += EMBED_BATCH_SIZE) {
    const batch = pending.slice(i, i + EMBED_BATCH_SIZE);
    try {
      const vectors = await embedBatch(batch.map((p) => p.text), "RETRIEVAL_DOCUMENT", 1536);
      const rows: EmbeddingRow[] = [];
      batch.forEach((p, idx) => {
        const embedding = vectors[idx];
        if (!embedding) return;
        rows.push({
          user_id: userId,
          source: p.item.source,
          source_id: p.item.sourceId,
          chunk_idx: p.chunkIdx,
          text: p.text,
          embedding,
          metadata: {
            ...(p.item.metadata ?? {}),
            title: p.item.title,
            created_at: new Date().toISOString(),
          },
        });
      });
      await upsertRows(ctx, "memory_embeddings", rows, "user_id,source,source_id,chunk_idx");
      written += rows.length;
    } catch (err) {
      console.error("[lms-embed] batch failed", {
        userId,
        batchStart: i,
        error: err instanceof Error ? err.message : String(err),
      });
      // Continue: partial indexing beats none.
    }
  }
  return written;
}
