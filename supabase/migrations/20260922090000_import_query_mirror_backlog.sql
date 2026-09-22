-- Let a saved job search say which backlog "Import & auto-place" mirrors
-- postings into.
--
-- The picker used to mirror every posting marked In progress into one list
-- fixed in code ("Hae näitä seuraavaksi"). Which postings are mirrored is now
-- a switch on each row, and where they go is chosen per saved search and kept
-- by id, beside the two lists auto-place files into.
--
-- Text, like the columns beside it. Null means the search has not chosen one,
-- and the picker offers the list it used before.

ALTER TABLE public.gmail_import_queries
  ADD COLUMN IF NOT EXISTS auto_place_mirror_backlog_id text;

COMMENT ON COLUMN public.gmail_import_queries.auto_place_mirror_backlog_id IS
  'Backlog "Import & auto-place" mirrors the postings switched on in the picker into. Null = the picker''s default.';
