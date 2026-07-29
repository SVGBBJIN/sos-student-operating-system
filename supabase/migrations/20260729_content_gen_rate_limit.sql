-- Daily content-generation rate limit: the durable table plus an ATOMIC
-- claim/release pair.
--
-- Two problems this fixes.
--
-- 1. content_generations was read and written by shared/rate-limit.ts but never
--    created by any migration in this repo. Against a database without it,
--    PostgREST returns an error object, `rows[0].count` reads as undefined ->
--    used = 0, and the cap silently never engaged.
--
-- 2. The check was a read-then-write: two concurrent requests both read 3, both
--    wrote 4, and the user got two generations for one slot. The upsert also
--    *overwrote* the count rather than incrementing it. claim_content_generation
--    below does the whole thing in one statement, so concurrent callers
--    serialize on the row and each sees a distinct post-increment value.

CREATE TABLE IF NOT EXISTS public.content_generations (
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  date date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, date)
);

ALTER TABLE public.content_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS content_generations_own_rows ON public.content_generations;
CREATE POLICY content_generations_own_rows ON public.content_generations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Atomically consume one generation slot. Returns the post-increment count and
-- whether the caller is allowed to proceed. When the cap is already reached the
-- count is left untouched, so a blocked caller never inflates the number that
-- the UI shows back to the student.
CREATE OR REPLACE FUNCTION public.claim_content_generation(
  user_id_in uuid,
  date_in date,
  limit_in integer
)
RETURNS TABLE (allowed boolean, used integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_count integer;
BEGIN
  INSERT INTO public.content_generations AS cg (user_id, date, count, updated_at)
  VALUES (user_id_in, date_in, 1, now())
  ON CONFLICT (user_id, date) DO UPDATE
    SET count = cg.count + 1,
        updated_at = now()
    WHERE cg.count < limit_in
  RETURNING cg.count INTO new_count;

  IF new_count IS NULL THEN
    -- The DO UPDATE guard failed: already at or over the cap. Report the
    -- current value without consuming anything.
    SELECT cg.count INTO new_count
      FROM public.content_generations cg
     WHERE cg.user_id = user_id_in AND cg.date = date_in;
    RETURN QUERY SELECT false, COALESCE(new_count, 0);
  ELSE
    RETURN QUERY SELECT true, new_count;
  END IF;
END;
$$;

-- Give a slot back when the work the caller claimed it for then failed. A
-- student should not lose one of five because a pipeline errored. Floors at 0
-- so a double refund can never mint credit.
CREATE OR REPLACE FUNCTION public.release_content_generation(
  user_id_in uuid,
  date_in date
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.content_generations
     SET count = GREATEST(count - 1, 0),
         updated_at = now()
   WHERE user_id = user_id_in AND date = date_in;
$$;
