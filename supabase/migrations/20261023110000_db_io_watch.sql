-- Keeping an eye on Disk IO.
--
-- Supabase warned on 2026-10-23 that the project was depleting its Disk IO
-- budget: sorts spilling to temporary files, fixed in 20261023090000. Its
-- dashboard shows the consumption, but nothing told us when it rose. Now the
-- database records its own IO counters every hour, and db_io_report() says
-- how much went where over a window — read daily by the "Disk IO watch"
-- workflow, which fails, and so emails, when a day's use is over budget.

CREATE TABLE IF NOT EXISTS public.db_io_snapshots (
  taken_at     timestamptz PRIMARY KEY DEFAULT now(),
  -- Sorts and hashes too big for work_mem, written to temporary files.
  temp_bytes   bigint NOT NULL,
  temp_files   bigint NOT NULL,
  -- Write-ahead log: every change written.
  wal_bytes    numeric NOT NULL,
  -- Blocks read from disk rather than memory.
  blks_read    bigint NOT NULL
);

-- Only the database and the service role: nothing here is for the app.
ALTER TABLE public.db_io_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.db_io_snapshots FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.db_io_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.take_db_io_snapshot()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.db_io_snapshots (temp_bytes, temp_files, wal_bytes, blks_read)
  SELECT d.temp_bytes, d.temp_files, w.wal_bytes, d.blks_read
    FROM pg_stat_database d, pg_stat_wal w
   WHERE d.datname = current_database();
  -- A month is plenty to compare against.
  DELETE FROM public.db_io_snapshots WHERE taken_at < now() - interval '31 days';
$function$;

/**
 * IO over the last `_hours`: the counters' growth between snapshots, a drop
 * (a restart resets them) counted from zero. With the statements that have
 * written most to temporary files since statistics were last reset — the
 * place to look when temp_mb is high.
 */
CREATE OR REPLACE FUNCTION public.db_io_report(_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
  WITH s AS (
    SELECT taken_at, temp_bytes, temp_files, wal_bytes, blks_read,
           lag(temp_bytes) OVER w AS p_temp, lag(temp_files) OVER w AS p_files,
           lag(wal_bytes) OVER w AS p_wal, lag(blks_read) OVER w AS p_read
      FROM public.db_io_snapshots
     WHERE taken_at >= now() - make_interval(hours => _hours) - interval '90 minutes'
    WINDOW w AS (ORDER BY taken_at)
  ),
  steps AS (
    SELECT taken_at,
           CASE WHEN temp_bytes >= p_temp THEN temp_bytes - p_temp ELSE temp_bytes END AS temp,
           CASE WHEN temp_files >= p_files THEN temp_files - p_files ELSE temp_files END AS files,
           CASE WHEN wal_bytes >= p_wal THEN wal_bytes - p_wal ELSE wal_bytes END AS wal,
           CASE WHEN blks_read >= p_read THEN blks_read - p_read ELSE blks_read END AS read
      FROM s
     WHERE p_temp IS NOT NULL AND taken_at >= now() - make_interval(hours => _hours)
  )
  SELECT jsonb_build_object(
    'hours', _hours,
    'snapshots', (SELECT count(*) FROM steps),
    'covered_hours', (SELECT round((extract(epoch FROM max(taken_at) - min(taken_at)) / 3600)::numeric, 1)
                        FROM s WHERE p_temp IS NOT NULL OR taken_at = (SELECT min(taken_at) FROM s)),
    'temp_mb', (SELECT round(coalesce(sum(temp), 0) / 1048576.0, 1) FROM steps),
    'temp_files', (SELECT coalesce(sum(files), 0) FROM steps),
    'wal_mb', (SELECT round(coalesce(sum(wal), 0) / 1048576.0, 1) FROM steps),
    'disk_read_mb', (SELECT round(coalesce(sum(read), 0) * 8192 / 1048576.0, 1) FROM steps),
    'top_temp_statements', (
      SELECT coalesce(jsonb_agg(t), '[]'::jsonb) FROM (
        SELECT left(regexp_replace(query, '\s+', ' ', 'g'), 200) AS query, calls,
               round(temp_blks_written * 8192 / 1048576.0, 1) AS temp_mb_total,
               round(temp_blks_written::numeric / greatest(calls, 1), 1) AS temp_blocks_per_call
          FROM pg_stat_statements
         WHERE temp_blks_written > 0
         ORDER BY temp_blks_written DESC
         LIMIT 5
      ) t)
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.take_db_io_snapshot(), public.db_io_report(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.take_db_io_snapshot(), public.db_io_report(integer) TO service_role;

DO $cron$
BEGIN
  PERFORM cron.unschedule('db-io-snapshot') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'db-io-snapshot');
  PERFORM cron.schedule('db-io-snapshot', '0 * * * *', 'SELECT public.take_db_io_snapshot()');
END
$cron$;

-- The first one now, so the first report has a starting point.
SELECT public.take_db_io_snapshot();
