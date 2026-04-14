-- Migration: add agentic mode and Google auth token storage to profiles
-- 2026-04-12

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS google_access_token             TEXT,
  ADD COLUMN IF NOT EXISTS google_refresh_token            TEXT,
  ADD COLUMN IF NOT EXISTS google_token_expiry             BIGINT,
  ADD COLUMN IF NOT EXISTS google_permissions_acknowledged BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS agentic_mode                    BOOLEAN DEFAULT TRUE;
