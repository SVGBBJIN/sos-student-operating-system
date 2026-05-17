-- Active timers set via the `set_timer` AI tool. Persisted so they survive a
-- page reload — on rehydrate the client re-schedules a setTimeout for each
-- unfired row, and fires-immediately any row whose fire_at is already past.

CREATE TABLE IF NOT EXISTS public.timers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  label         text NOT NULL,
  fire_at       timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  fired         boolean NOT NULL DEFAULT false,
  dismissed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS timers_user_fire_idx
  ON public.timers (user_id, fire_at)
  WHERE fired = false;

ALTER TABLE public.timers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timers owner" ON public.timers;
CREATE POLICY "timers owner" ON public.timers
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
