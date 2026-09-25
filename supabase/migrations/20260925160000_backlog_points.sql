-- A backlog's own points: an estimate for a release or a sprint before its
-- work is broken into items.
--
-- The app counts a backlog as the larger of this and what its contents add up
-- to — the rule items already follow — and its burnup draws its target line
-- here, with the contents as a separate scope line. Null means no estimate:
-- the backlog is then exactly the sum of its items, as it always was.

ALTER TABLE public.backlogs
  ADD COLUMN IF NOT EXISTS points integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'backlogs_points_not_negative'
  ) THEN
    ALTER TABLE public.backlogs
      ADD CONSTRAINT backlogs_points_not_negative CHECK (points IS NULL OR points >= 0);
  END IF;
END $$;

COMMENT ON COLUMN public.backlogs.points IS
  'Estimate for the backlog as a whole, or null for none. Counted as the larger of this and its contents.';
