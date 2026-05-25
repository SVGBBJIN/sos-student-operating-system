-- Schedule the pull-mode sync orchestrator to run every 10 minutes.
--
-- The Edge Function URL and service-role token are read from GUC settings so
-- secrets never live in the migration. To activate this job on a deployment,
-- a project admin must run once:
--
--   alter database postgres set app.sync_url     = 'https://<project>.functions.supabase.co/sync-submissions';
--   alter database postgres set app.service_role = '<service-role-jwt>';
--
-- After setting the GUCs, run `select cron.alter_job(job_id := <id>, schedule := '*/10 * * * *');`
-- to force a reload, or wait for the next scheduled tick.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'sync-submissions-every-10m') then
    perform cron.schedule(
      'sync-submissions-every-10m',
      '*/10 * * * *',
      $cron$
        select net.http_post(
          url     := current_setting('app.sync_url', true),
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.service_role', true)
          ),
          body    := '{}'::jsonb
        )
        where coalesce(current_setting('app.sync_url', true), '') <> ''
      $cron$
    );
  end if;
end $$;
