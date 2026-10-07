-- Let a saved job search name the one list its picker imports into.
--
-- The picker used to file postings into two lists, one for those with a
-- closing date and one for the rest, each chosen per search. Deadlines are a
-- field of their own now, a list can be sorted and filtered by them, and one
-- list of open jobs does what the two did. So the picker imports everything it
-- is given into a single list.
--
-- Kept by id, like the lists before it: found by name, a rename would quietly
-- break the import. Null means the search has not chosen one, and the picker
-- imports into the search's own list.
--
-- The two older columns stay. An app build from before this change still reads
-- them, and nothing is gained by taking them away under it.

ALTER TABLE public.gmail_import_queries
  ADD COLUMN IF NOT EXISTS auto_place_backlog_id text;

COMMENT ON COLUMN public.gmail_import_queries.auto_place_backlog_id IS
  'Backlog the job picker imports the chosen postings into. Null = the search''s own backlog.';

-- A search that had its two lists chosen carries on into the one that held the
-- dated postings — where it still exists. For the search there is, that is the
-- list since renamed "Open jobs"; its other list has been deleted.
UPDATE public.gmail_import_queries q
SET auto_place_backlog_id = q.auto_place_dated_backlog_id
WHERE q.auto_place_backlog_id IS NULL
  AND q.auto_place_dated_backlog_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.backlogs b WHERE b.id = q.auto_place_dated_backlog_id);
