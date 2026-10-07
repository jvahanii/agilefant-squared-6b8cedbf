-- A work item's start and end dates.
--
-- When work on an item began and when it finished, as two days of their own.
-- A deadline says when something is due and a created date when it was written
-- down; neither says when it was actually done.
--
-- Dates, not timestamps, like the other two: days on a calendar that a person
-- sets and may correct. Both are empty until someone sets them, and either may
-- be set without the other -- work that has started has no end yet.
--
-- Nothing fills them in: there is no record to recover them from, and a status
-- change is not a reliable stand-in (an item can be marked done long after the
-- work stopped).
--
-- Three switches, as for created dates:
--   * the organization's, off by default: with it off there is nothing in the
--     menus and nothing on the rows. On for Agilefant's own organization, which
--     asked for it.
--   * each backlog's own, off until switched on, for showing the dates on its
--     rows. The dates can be set from an item's menu wherever the organization
--     has them on; a list only decides whether it shows them.

ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS started_on date,
  ADD COLUMN IF NOT EXISTS ended_on date;

COMMENT ON COLUMN public.work_items.started_on IS
  'The day work on this item began, or null where none is set. Set by hand.';
COMMENT ON COLUMN public.work_items.ended_on IS
  'The day work on this item finished, or null where none is set. Set by hand.';

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS start_end_dates_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organization_settings.start_end_dates_enabled IS
  'Whether work items can be given start and end dates. Off by default.';

INSERT INTO public.organization_settings (organization_id, start_end_dates_enabled)
VALUES ('227ff1d1-36df-4f46-b97e-483ada92ccfb', true)
ON CONFLICT (organization_id)
  DO UPDATE SET start_end_dates_enabled = true, updated_at = now();

ALTER TABLE public.backlogs
  ADD COLUMN IF NOT EXISTS start_end_dates_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.backlogs.start_end_dates_enabled IS
  'Whether this backlog shows its items'' start and end dates on their rows. Off until switched on, and only consulted where organization_settings.start_end_dates_enabled.';
