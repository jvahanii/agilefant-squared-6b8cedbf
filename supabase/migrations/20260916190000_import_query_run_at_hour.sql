-- Let a daily import say what time of day it wants.
--
-- Until now there was no answer to "when does this run?". pg_cron wakes the
-- checker at seven minutes past every hour, and a daily query was skipped unless
-- twenty-three hours had passed since its last run -- so it ran at whatever hour
-- it happened to run the first time, and nobody chose that hour. The one query
-- in the database settled on 19:07 UTC by accident.
--
-- An hour is as fine as this can get: the checker only wakes hourly, so a
-- chosen hour means "at seven minutes past it". The timezone is stored beside
-- the hour rather than folded into UTC, because folding it in would be wrong
-- twice a year -- a run set for 08:00 in Helsinki must stay at 08:00 when the
-- clocks change, not drift to 09:00.
--
-- Null means what it meant before: run whenever twenty-three hours have passed.

ALTER TABLE public.gmail_import_queries
  ADD COLUMN IF NOT EXISTS run_at_hour smallint,
  ADD COLUMN IF NOT EXISTS run_at_timezone text;

ALTER TABLE public.gmail_import_queries
  DROP CONSTRAINT IF EXISTS gmail_import_queries_run_at_hour_range;

ALTER TABLE public.gmail_import_queries
  ADD CONSTRAINT gmail_import_queries_run_at_hour_range
  CHECK (run_at_hour IS NULL OR (run_at_hour >= 0 AND run_at_hour <= 23));

COMMENT ON COLUMN public.gmail_import_queries.run_at_hour IS
  'Hour of day (0-23, in run_at_timezone) a daily query should run, at :07 past. Null = run whenever 23h have passed since the last run.';
COMMENT ON COLUMN public.gmail_import_queries.run_at_timezone IS
  'IANA timezone the hour is expressed in, e.g. Europe/Helsinki. Stored rather than converted so the chosen hour survives a daylight saving change.';
