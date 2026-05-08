-- ─── Entity Links ────────────────────────────────────────────────────────────
-- Bidirectional graph layer connecting notes, events, and tasks.
-- One row per directed link; queries resolve both directions via OR on source/target.
-- Run this migration in the Supabase SQL editor or via supabase db push.

DO $$ BEGIN
  CREATE TYPE entity_kind AS ENUM ('note','event','task');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS entity_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users NOT NULL,
  source_type   entity_kind NOT NULL,
  source_id     uuid NOT NULL,
  target_type   entity_kind NOT NULL,
  target_id     uuid NOT NULL,
  -- 'manual' = user-clicked, 'wikilink' = parsed from [[X]] in content,
  -- 'heuristic' = scored auto-suggestion accepted, 'llm' = LLM-gated suggestion accepted,
  -- 'rejected' = user dismissed a suggestion (suppresses re-suggestion).
  origin        text NOT NULL DEFAULT 'manual'
                CHECK (origin IN ('manual','wikilink','heuristic','llm','rejected')),
  confirmed_at  timestamptz,
  created_at    timestamptz DEFAULT now(),
  UNIQUE (user_id, source_type, source_id, target_type, target_id)
);

ALTER TABLE entity_links ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users manage own links"
    ON entity_links FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_entity_links_target
  ON entity_links (user_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_entity_links_source
  ON entity_links (user_id, source_type, source_id);

-- Lookup helper for "all links involving entity X" — covers either side.
CREATE INDEX IF NOT EXISTS idx_entity_links_user_origin
  ON entity_links (user_id, origin);
