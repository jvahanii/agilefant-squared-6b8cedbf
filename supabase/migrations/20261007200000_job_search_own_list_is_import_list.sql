-- A job search imports into one list — make its own list that list.
--
-- A saved search has always named a list of its own (backlog_id): where a
-- scheduled run imports to, and what the search shows under its name. The job
-- picker then got a list of its own to import into (auto_place_backlog_id).
-- Two lists for one search meant a job could end up in either, depending on
-- which button was pressed, and the picker's plain import still filled the
-- first one after the second had become the list everything else used.
--
-- The picker now has one import, and choosing its list sets both columns. This
-- brings the searches saved before that into line: where the picker's list is
-- set and still exists in the search's tree, it becomes the search's own list.
-- For the search there is, that moves it from the old inbox list to the list
-- named "Open jobs".

UPDATE public.gmail_import_queries q
SET backlog_id = q.auto_place_backlog_id
WHERE q.import_mode = 'jobs'
  AND q.auto_place_backlog_id IS NOT NULL
  AND q.backlog_id IS DISTINCT FROM q.auto_place_backlog_id
  AND EXISTS (
    SELECT 1 FROM public.backlogs b
    WHERE b.id = q.auto_place_backlog_id AND b.tree_id = q.tree_id
  );
