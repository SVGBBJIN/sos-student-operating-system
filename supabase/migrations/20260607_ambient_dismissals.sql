-- ── Ambient status surface: extend trigger_dismissals ─────────────────────────
-- The ambient status surface (the "always watching" Island layer) surfaces at
-- most one terse status at a time and must remember durable dismissals. It
-- reuses the existing trigger_dismissals table, but ambient items are keyed by a
-- stable taxonomy `kind` and a per-item `signature` rather than always by task —
-- and some ambient items (e.g. plan slippage) are not tied to a single task.
--
-- This migration:
--   1. adds `kind` + `signature` columns,
--   2. relaxes the NOT NULL on task_id (existing skill-hub inserts still pass a
--      task_id, so they are unaffected),
--   3. indexes (user_id, signature) for exact-item suppression lookups and
--      (user_id, kind) for per-class engagement counts.
-- DB-level expiry continues to ride the existing (user_id, expires_at) index.

ALTER TABLE trigger_dismissals ADD COLUMN IF NOT EXISTS kind text;
ALTER TABLE trigger_dismissals ADD COLUMN IF NOT EXISTS signature text;
ALTER TABLE trigger_dismissals ALTER COLUMN task_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_trigger_dismissals_user_signature
  ON trigger_dismissals (user_id, signature);

CREATE INDEX IF NOT EXISTS idx_trigger_dismissals_user_kind
  ON trigger_dismissals (user_id, kind);
