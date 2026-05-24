-- Tentative + confidence support for the capture → review → commit loop.
--
-- Adds two columns to `tasks` and `events`:
--   * confidence  — model-self-reported 0..1 score on the extracted item
--   * commitment / status — 'tentative' (needs user confirmation) | 'confirmed'
--
-- We use a different name on tasks (commitment) because `tasks.status` is an
-- existing enum (not_started/in_progress/done) and we must not collide with it.
-- Events have no prior status column so we use the cleaner name there.

alter table tasks
  add column if not exists confidence numeric(3,2)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add column if not exists commitment text
    check (commitment in ('tentative','confirmed'))
    default 'confirmed';

alter table events
  add column if not exists confidence numeric(3,2)
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  add column if not exists status text
    check (status in ('tentative','confirmed'))
    default 'confirmed';

-- Partial indexes — most rows are confirmed; the tentative pile is small and
-- gets queried whenever the briefing/follow-up surfaces ask "what's still
-- waiting on a yes/no?".
create index if not exists tasks_tentative_idx  on tasks  (user_id, commitment)
  where commitment = 'tentative';
create index if not exists events_tentative_idx on events (user_id, status)
  where status = 'tentative';
