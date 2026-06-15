-- Adaptive layer for the start-latency experiment.
--
-- The fixed arm assignment (20260614) splits users uniformly. This migration
-- adds the feedback loop that lets allocation shift toward whatever's working:
--   1. an `experiments` registry — anchors each experiment's start date (for
--      temperature annealing) and records graduation (the winning arm to route
--      new users to once a clear winner emerges).
--   2. experiment_arm_performance() — a SECURITY DEFINER aggregate that returns
--      ONLY per-arm counts + median latency across all users. The raw
--      task_events are RLS-locked per user, so this definer function is what
--      lets a client compute global allocation weights without ever seeing
--      another user's rows. It exposes no user-identifying data.
--
-- Everything is additive + idempotent.

create table if not exists experiments (
  key            text primary key,
  started_at     timestamptz not null default now(),
  status         text not null default 'running',  -- running | graduated | paused
  graduated_arm  text,
  updated_at     timestamptz not null default now()
);

insert into experiments (key) values ('start_latency_v1')
  on conflict (key) do nothing;

alter table experiments enable row level security;
-- Experiment config is non-sensitive (no PII); any signed-in client may read it
-- to compute its own adaptive assignment. Writes stay server-side only.
drop policy if exists "experiments_read_all" on experiments;
create policy "experiments_read_all" on experiments
  for select to authenticated using (true);

-- Aggregate-only performance per arm. SECURITY DEFINER so it can read across
-- all users' task_events (which are otherwise RLS-restricted to the owner),
-- but it returns nothing that identifies a user — just counts and a median.
-- The arm is read from each event's metadata.experiment_arm, i.e. the arm the
-- behavior actually happened under.
create or replace function experiment_arm_performance(
  p_experiment_key text default 'start_latency_v1',
  p_window_days int default 14
)
returns table (
  arm                text,
  pledges            bigint,
  starts             bigint,
  median_latency_min numeric
)
language sql
security definer
set search_path = public
stable
as $$
  -- p_experiment_key is reserved for when events are tagged per-experiment;
  -- today there is a single experiment so all arm-tagged events belong to it.
  select
    t.arm,
    count(*) filter (where t.event_type = 'pledge') as pledges,
    count(*) filter (
      where t.event_type = 'start' and t.metadata ? 'start_latency_ms'
    ) as starts,
    round((percentile_cont(0.5) within group (
      order by case
        when t.event_type = 'start' and t.metadata ? 'start_latency_ms'
        then (t.metadata->>'start_latency_ms')::numeric
      end
    ) / 60000.0)::numeric, 1) as median_latency_min
  from (
    select event_type, metadata, metadata->>'experiment_arm' as arm
    from task_events
    where occurred_at >= now() - make_interval(days => p_window_days)
      and metadata ? 'experiment_arm'
      and nullif(metadata->>'experiment_arm', '') is not null
  ) t
  group by t.arm;
$$;

-- Expose the aggregate to SIGNED-IN clients only (anon never needs it); the
-- underlying tables stay RLS-protected. This is intentionally callable by
-- authenticated users — it returns counts + median latency only, no PII — so
-- each client can compute its own adaptive allocation. The linter warning for
-- a SECURITY DEFINER function being authenticated-executable is accepted here.
revoke all on function experiment_arm_performance(text, int) from public, anon;
grant execute on function experiment_arm_performance(text, int) to authenticated;
