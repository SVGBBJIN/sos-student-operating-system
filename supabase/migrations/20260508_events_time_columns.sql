-- Add the time/description/location/priority columns the schema has been
-- accepting from the AI but silently dropping at the DB layer.
--
-- Background: the AI tool schema for `add_event` has long included `time`,
-- `description`, `location`, and `priority`, and the client-side eventShape
-- already reads them with safe fallbacks. But the `events` table had no place
-- to store them, so every event rendered as midnight all-day. This migration
-- closes that gap.
--
-- start_time / end_time as TIME (not timestamptz) keep the event_date column
-- as the single source of truth for the date and avoid timezone drift.

ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS start_time   time        NULL,
  ADD COLUMN IF NOT EXISTS end_time     time        NULL,
  ADD COLUMN IF NOT EXISTS description  text        NULL,
  ADD COLUMN IF NOT EXISTS location     text        NULL,
  ADD COLUMN IF NOT EXISTS priority     text        NULL;

CREATE INDEX IF NOT EXISTS events_user_date_starttime_idx
  ON public.events (user_id, event_date, start_time);
