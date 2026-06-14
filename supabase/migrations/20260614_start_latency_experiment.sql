-- Start-latency experiment: measure (and shrink) the intention→action gap.
--
-- The "gap" is the time between when a student SAYS they'll start a task
-- (pledged_start_at) and when they ACTUALLY start it (the existing `start`
-- event + tasks.started_at). This migration adds:
--   1. a `pledge` event type + tasks.pledged_start_at column (the intention side)
--   2. an experiment_assignments table so each user is pinned to one mechanism
--      ("arm") for the duration of the week-1 cohort, enabling an A/B/n readout
--      of which mechanism cuts the gap most.
--
-- Everything is additive + idempotent so it is safe to re-run.

-- New telemetry signal: `pledge` — the student committed to a start time
-- (via chat "I'll start at 7pm" → pledge_start action, or a UI commit).
-- ALTER TYPE ... ADD VALUE must be committed before first use.
alter type task_event_type add value if not exists 'pledge';

-- The intention side of the metric. The action side already exists
-- (tasks.started_at + the `start` event, added 20260530_decision_gate_start).
alter table tasks
  add column if not exists pledged_start_at timestamptz;

-- Stable per-user experiment arm assignment. One row per (user, experiment).
-- Assignment is deterministic (hash of user_id, see shared/experiments/
-- start-latency.ts) but persisted so the arm survives client reinstalls and
-- the readout query never has to recompute it.
create table if not exists experiment_assignments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  experiment_key  text not null,
  arm             text not null,
  assigned_at     timestamptz not null default now(),
  unique (user_id, experiment_key)
);

create index if not exists experiment_assignments_user_idx
  on experiment_assignments(user_id);
create index if not exists experiment_assignments_arm_idx
  on experiment_assignments(experiment_key, arm);

alter table experiment_assignments enable row level security;
create policy "experiment_assignments_owner_select" on experiment_assignments
  for select using (auth.uid() = user_id);
create policy "experiment_assignments_owner_insert" on experiment_assignments
  for insert with check (auth.uid() = user_id);

-- Readout helper: median start-latency (minutes) per arm over a window.
-- Reads the `start` events that carry a start_latency_ms in metadata (only
-- starts that had a prior pledge do), joins each user's arm, and aggregates.
-- percentile_cont gives a median that resists the long right tail of
-- "pledged then started days later" outliers better than a mean.
create or replace function start_latency_by_arm(window_days int default 14)
returns table (arm text, n bigint, median_minutes numeric, p90_minutes numeric)
language sql
stable
as $$
  select
    a.arm,
    count(*) as n,
    round((percentile_cont(0.5) within group (
      order by (e.metadata->>'start_latency_ms')::numeric) / 60000.0)::numeric, 1)
      as median_minutes,
    round((percentile_cont(0.9) within group (
      order by (e.metadata->>'start_latency_ms')::numeric) / 60000.0)::numeric, 1)
      as p90_minutes
  from task_events e
  join experiment_assignments a
    on a.user_id = e.user_id and a.experiment_key = 'start_latency_v1'
  where e.event_type = 'start'
    and e.metadata ? 'start_latency_ms'
    and e.occurred_at >= now() - make_interval(days => window_days)
  group by a.arm
  order by median_minutes asc nulls last;
$$;
