-- Pending-close state for LMS auto-completions that have one strong signal
-- but not yet corroboration from a second independent source.
--
-- When the ingest layer sets lms_pending_close = true, the client shows an
-- actionable toast: "Looks like you submitted X — mark it done? [Yes] [Not yet]"
-- The student has 5 minutes to respond. If they don't, pg_cron promotes it
-- automatically (catch-and-confirm rather than catch-and-block).

alter table tasks
  add column if not exists lms_pending_close    boolean     not null default false,
  add column if not exists lms_pending_close_at timestamptz;

-- Index so the cron job can scan only the handful of rows that need promotion
-- without a full table scan.
create index if not exists tasks_lms_pending_close_idx
  on tasks (lms_pending_close_at)
  where lms_pending_close = true;

-- Auto-promote tasks that have been pending for more than 5 minutes and are
-- still open. Runs inside the existing pg_cron infrastructure.
create or replace function lms_promote_pending_closes()
returns void language plpgsql as $$
begin
  update tasks
  set
    status                = 'done',
    completed_at          = now(),
    completion_source     = 'lms',
    lms_pending_close     = false,
    lms_pending_close_at  = null
  where
    lms_pending_close = true
    and lms_pending_close_at < now() - interval '5 minutes'
    and status <> 'done';
end;
$$;

-- Schedule the promotion sweep every 2 minutes so the auto-confirm window
-- stays close to 5 min without waiting a full 10-min sync cycle.
do $$
begin
  if not exists (select 1 from cron.job where jobname = 'lms-promote-pending-closes') then
    perform cron.schedule(
      'lms-promote-pending-closes',
      '*/2 * * * *',
      $cron$select lms_promote_pending_closes()$cron$
    );
  end if;
end $$;
