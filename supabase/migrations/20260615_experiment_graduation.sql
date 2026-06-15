-- Automatic graduation for the start-latency experiment.
--
-- "Graduate whenever there's a clear winner; otherwise keep running." Once a
-- mechanism is decisively ahead, the experiment graduates and new users route
-- straight to the winner (see resolveAdaptiveArm in App.jsx). Until then the
-- adaptive allocator keeps exploring.
--
-- Runs entirely in the database (no edge function / secrets), scheduled via
-- pg_cron. Idempotent + additive.

-- Clear-winner test, mirroring armReward() in shared/experiments/allocation.ts:
--   reward = conversion * 2^(-median_latency_min / 60)
-- A winner must:
--   * have >= p_min_starts measured starts (enough data to trust the median),
--   * beat the runner-up by >= p_min_margin in reward, and
--   * be compared against at least one other arm that also cleared the bar
--     (you can't be "clearly" best with no one to beat).
-- If those don't hold, the experiment stays running and the function reports why.
-- Graduation only fires from the 'running' state, so it's stable once decided.
create or replace function evaluate_start_latency_graduation(
  p_min_starts int default 30,
  p_min_margin numeric default 0.08,
  p_window_days int default 14
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status     text;
  v_winner     text;
  v_best       numeric;
  v_second     numeric;
  v_qualifying int;
begin
  select status into v_status from experiments where key = 'start_latency_v1';
  if v_status is null then
    return jsonb_build_object('action', 'skip', 'reason', 'experiment not registered');
  end if;
  if v_status <> 'running' then
    return jsonb_build_object('action', 'skip', 'reason', 'not running', 'status', v_status);
  end if;

  with perf as (
    select
      arm,
      pledges,
      starts,
      median_latency_min,
      (starts::numeric / nullif(pledges, 0))
        * power(2, -greatest(median_latency_min, 0) / 60.0) as reward
    from experiment_arm_performance('start_latency_v1', p_window_days)
    where starts >= p_min_starts
      and pledges > 0
      and median_latency_min is not null
  ),
  ranked as (
    select arm, reward, row_number() over (order by reward desc nulls last) as rn
    from perf
  )
  select
    (select count(*) from ranked),
    (select arm    from ranked where rn = 1),
    (select reward from ranked where rn = 1),
    (select reward from ranked where rn = 2)
  into v_qualifying, v_winner, v_best, v_second;

  if v_qualifying < 2 then
    return jsonb_build_object(
      'action', 'wait',
      'reason', 'need >= 2 arms past the sample bar',
      'qualifying', v_qualifying
    );
  end if;

  if (v_best - coalesce(v_second, 0)) >= p_min_margin then
    update experiments
      set status = 'graduated', graduated_arm = v_winner, updated_at = now()
      where key = 'start_latency_v1' and status = 'running';
    return jsonb_build_object(
      'action', 'graduated', 'arm', v_winner,
      'best', round(v_best, 4), 'second', round(coalesce(v_second, 0), 4),
      'margin', round(v_best - coalesce(v_second, 0), 4)
    );
  end if;

  return jsonb_build_object(
    'action', 'wait', 'reason', 'no clear winner',
    'best', round(v_best, 4), 'second', round(coalesce(v_second, 0), 4),
    'margin', round(v_best - coalesce(v_second, 0), 4)
  );
end;
$$;

-- Server-side / cron only: clients must never be able to force graduation.
-- `from public` is required too — CREATE FUNCTION grants EXECUTE to PUBLIC by
-- default, which anon/authenticated inherit.
revoke all on function evaluate_start_latency_graduation(int, numeric, int) from public, anon, authenticated;

-- Evaluate every 6 hours. pg_cron runs as the job owner, which can execute the
-- definer function directly — no GUC/secret wiring needed.
create extension if not exists pg_cron;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'start-latency-graduation-6h') then
    perform cron.schedule(
      'start-latency-graduation-6h',
      '0 */6 * * *',
      $cron$ select evaluate_start_latency_graduation(); $cron$
    );
  end if;
end $$;
