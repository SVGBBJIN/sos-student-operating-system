-- Onboarding: extend the capture → review → commit confidence gate to recurring
-- blocks, and track first-run completion on the profile.
--
-- The three-question onboarding writes a weekly recurring skeleton. Two kinds of
-- block come out of it:
--   * Committed time — school + the student's stated after-school commitments —
--     is TRUE. We write it confirmed / high-confidence so the proactive layer can
--     trust it.
--   * The drafted focus / break / lighter blocks are unverified intent, not fact.
--     We write them tentative / low-confidence so downstream features treat them
--     accordingly and never bank a speculative block as a known fact.
--
-- This mirrors the columns already added to `tasks` and `events` in
-- 20260523_tentative_confidence.sql — we reuse that gate rather than invent a
-- parallel one. recurring_blocks has no prior `status`/`commitment` column, so we
-- use the cleaner `commitment` name (same vocabulary as tasks).

alter table recurring_blocks
  add column if not exists confidence numeric(3,2)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add column if not exists commitment text
    check (commitment in ('tentative','confirmed'))
    default 'confirmed';

-- Partial index — most blocks are confirmed committed time; the tentative pile
-- (drafted study blocks awaiting real-world calibration) is what the proactive
-- layer queries when deciding what it's allowed to lean on.
create index if not exists recurring_blocks_tentative_idx
  on recurring_blocks (user_id, commitment)
  where commitment = 'tentative';

-- First-run gate. The onboarding overlay shows once, cold, for a brand-new user;
-- this flag is the durable, cross-device record that it has run.
alter table profiles
  add column if not exists onboarding_completed boolean not null default false;
