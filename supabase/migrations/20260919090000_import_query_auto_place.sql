-- Let a saved job search say which backlogs "Import & auto-place" fills.
--
-- Auto-place used to find its two lists by name -- "Deadlinella" and
-- "Toistaiseksi avoimet" -- in the search's tree. Renaming either list made the
-- button quietly disappear. The lists are now chosen per saved search and kept
-- by id, so a rename changes nothing.
--
-- Text, like backlog_id beside them: backlog ids are "<tree uuid>::bl-<hex>".
-- Null means auto-place is not set up for this search, and the picker does not
-- offer it.

ALTER TABLE public.gmail_import_queries
  ADD COLUMN IF NOT EXISTS auto_place_dated_backlog_id text,
  ADD COLUMN IF NOT EXISTS auto_place_undated_backlog_id text;

COMMENT ON COLUMN public.gmail_import_queries.auto_place_dated_backlog_id IS
  'Backlog "Import & auto-place" files postings with a closing date into. Null = auto-place not set up.';
COMMENT ON COLUMN public.gmail_import_queries.auto_place_undated_backlog_id IS
  'Backlog "Import & auto-place" files postings without a closing date into. Null = auto-place not set up.';
