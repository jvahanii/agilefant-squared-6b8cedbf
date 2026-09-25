-- A work item's deadline, as a date of its own.
--
-- Until now a deadline lived in the item's name: the job-ad importer wrote
-- "0930 Fortum — Analyst", so a list sorted by name came out in date order.
-- That left the date without a year, unsortable any other way, lost whenever
-- a name was edited, and readable only by parsing titles. This column holds it
-- instead; the names are converted in a later migration, once the app that
-- shows the column is live, so no date disappears from view in between.
--
-- A date, not a timestamp: a closing day, with no time or zone to disagree on.

ALTER TABLE public.work_items
  ADD COLUMN IF NOT EXISTS deadline date;

COMMENT ON COLUMN public.work_items.deadline IS
  'The day this item is due, or null for none. Replaces the "MMDD " prefix the job-ad importer used to put in names.';
