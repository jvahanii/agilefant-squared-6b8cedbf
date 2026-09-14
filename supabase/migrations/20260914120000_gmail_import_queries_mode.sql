-- Importing job ads is a distinct feature from the generic Gmail link import,
-- so a saved query records which extractor it runs under.
--
--   links  the existing behaviour: every link found in a matching message
--   jobs   job postings only, reduced to a canonical URL per posting
--
-- Existing rows default to 'links', so nothing already scheduled changes.

ALTER TABLE public.gmail_import_queries
  ADD COLUMN IF NOT EXISTS import_mode text NOT NULL DEFAULT 'links';

ALTER TABLE public.gmail_import_queries
  DROP CONSTRAINT IF EXISTS gmail_import_queries_import_mode_check;

ALTER TABLE public.gmail_import_queries
  ADD CONSTRAINT gmail_import_queries_import_mode_check
  CHECK (import_mode IN ('links', 'jobs'));

COMMENT ON COLUMN public.gmail_import_queries.import_mode IS
  'Which extractor this query runs under: links (generic) or jobs (job-ad import).';
