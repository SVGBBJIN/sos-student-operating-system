-- Home Decision Gate + Start Primitive + Decision Rollup + 24h Plan Rule.
--
-- Adds the `start_source`/`started_at` columns that mirror the existing
-- completion_source pattern, plus the task_event_type values the new
-- surfaces emit. Everything is additive and idempotent so it is safe to
-- re-run against a project that already has some of these objects.

-- New telemetry signals:
--   start         — the Start primitive fired (gate, manual, or ai source).
--   gate_dismiss  — user chose "Nothing right now" on the Home Decision Gate.
--   plan_applied  — a study/intent plan was applied (24h-plan-rule instrument).
-- "Not this one" gate passes reuse the existing `postpone` value with a
-- metadata marker, so no enum churn is needed for them.
--
-- ALTER TYPE ... ADD VALUE is committed before first use (separate from any
-- statement that references it), which is allowed on Postgres 12+.
alter type task_event_type add value if not exists 'start';
alter type task_event_type add value if not exists 'gate_dismiss';
alter type task_event_type add value if not exists 'plan_applied';

-- Start primitive provenance, mirroring completion_source (manual|gate|ai).
alter table tasks
  add column if not exists start_source text,
  add column if not exists started_at   timestamptz;

alter table tasks
  drop constraint if exists tasks_start_source_check;
alter table tasks
  add  constraint tasks_start_source_check
    check (start_source is null or start_source in ('manual', 'gate', 'ai'));
