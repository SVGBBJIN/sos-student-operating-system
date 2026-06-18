-- Hybrid search: phrase recall + BM25 term importance + negation handling.
-- Adds a stored tsvector column and replaces match_memories with a two-phase
-- hybrid retrieval: ANN vector candidates → BM25 re-rank + negation penalty.

-- 1. Stored tsvector — backfills automatically for all existing rows.
ALTER TABLE memory_embeddings
  ADD COLUMN IF NOT EXISTS text_search tsvector
    GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;

-- 2. GIN index for O(log n) FTS lookups.
CREATE INDEX IF NOT EXISTS memory_embeddings_text_search_idx
  ON memory_embeddings USING gin(text_search);

-- 3. Hybrid match_memories.
--    Phase 1: pull match_count * 4 ANN candidates via the IVF index (fast).
--    Phase 2: re-rank each candidate by:
--               0.7 * vector_sim + 0.3 * bm25 - 0.3 * negation_penalty
--    New params are nullable — existing callers without them still work.
CREATE OR REPLACE FUNCTION match_memories(
  query_embedding   vector(1536),
  user_id_in        uuid,
  match_count       int     DEFAULT 8,
  source_filter     text[]  DEFAULT null,
  metadata_filter   jsonb   DEFAULT null,
  query_text        text    DEFAULT null,   -- positive terms for BM25 boost
  negation_terms    text[]  DEFAULT null    -- terms to penalise
) RETURNS TABLE (
  id          uuid,
  source      text,
  source_id   uuid,
  text        text,
  similarity  float,
  text_score  float,
  metadata    jsonb
)
LANGUAGE sql
STABLE
AS $$
  WITH
  parsed(fts_query) AS (
    SELECT
      CASE WHEN query_text IS NOT NULL AND trim(query_text) <> ''
        THEN websearch_to_tsquery('english', query_text)
        ELSE NULL::tsquery
      END
  ),
  -- Phase 1: cheap ANN — IVF index keeps this to microseconds even at 100 k rows.
  candidates AS (
    SELECT
      me.id, me.source, me.source_id, me.text, me.text_search, me.metadata,
      (1 - (me.embedding <=> query_embedding))::float AS similarity
    FROM memory_embeddings me
    WHERE me.user_id = user_id_in
      AND (source_filter IS NULL OR me.source = ANY(source_filter))
      AND (metadata_filter IS NULL OR me.metadata @> metadata_filter)
    ORDER BY me.embedding <=> query_embedding
    LIMIT match_count * 4
  ),
  -- Phase 2: compute BM25 and negation penalty once per candidate row.
  scored AS (
    SELECT
      c.id, c.source, c.source_id, c.text, c.metadata, c.similarity,
      CASE
        WHEN p.fts_query IS NOT NULL AND c.text_search @@ p.fts_query
          -- ts_rank_cd norm=32 → rank/(rank+1), keeps score in [0, 1).
          THEN ts_rank_cd(c.text_search, p.fts_query, 32)::float
        ELSE 0.0
      END AS text_score,
      CASE
        WHEN negation_terms IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM unnest(negation_terms) t(term)
            -- plainto_tsquery ignores stop words; to_tsquery would error on them.
            WHERE c.text_search @@ plainto_tsquery('english', term)
          )
        THEN 0.3
        ELSE 0.0
      END AS neg_penalty
    FROM candidates c, parsed p
  )
  SELECT id, source, source_id, text, similarity, text_score, metadata
  FROM scored
  ORDER BY (similarity * 0.7 + text_score * 0.3 - neg_penalty) DESC
  LIMIT match_count;
$$;
