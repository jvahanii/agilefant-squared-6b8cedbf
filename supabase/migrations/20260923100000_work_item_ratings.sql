-- Rate a work item from one to five stars, and sort a backlog by it.
--
-- One rating per item, shared by everyone in the organization, like its points
-- or its status. Null means unrated: "no stars" is the absence of a rating, not
-- a rating of zero, and a backlog sorted by rating puts the unrated last.
--
-- Behind an organization setting, off by default, like public links and points
-- before it. Off, nothing changes: no stars on a row, and the sort mode is not
-- offered.

-- 1. The rating itself. Smallint with the range in a constraint: the app offers
--    five stars, and a row that says 9 would come from nowhere good.
ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS rating smallint;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'work_items_rating_range'
  ) THEN
    ALTER TABLE public.work_items
      ADD CONSTRAINT work_items_rating_range CHECK (rating IS NULL OR rating BETWEEN 1 AND 5);
  END IF;
END $$;

COMMENT ON COLUMN public.work_items.rating IS
  'One to five stars, set in the app. Null = unrated, which sorts last. Shown only where organization_settings.ratings_enabled.';

-- 2. The setting. Writing it is already limited to owners, admins and
--    superusers by the existing policies on organization_settings.
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS ratings_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organization_settings.ratings_enabled IS
  'Whether work items in this organization can be rated from one to five stars, and backlogs sorted by it.';

-- 3. Agilefant has it from the start. By id rather than name, since a name is
--    not unique; guarded so a database without this organization skips it.
INSERT INTO public.organization_settings (organization_id, ratings_enabled)
SELECT o.id, true
  FROM public.organizations o
 WHERE o.id = '227ff1d1-36df-4f46-b97e-483ada92ccfb'  -- Agilefant
ON CONFLICT (organization_id)
  DO UPDATE SET ratings_enabled = true, updated_at = now();
