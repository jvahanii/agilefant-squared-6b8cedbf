-- Let the database rest: the Disk IO budget was going on empty WAL segments.
--
-- Supabase sets archive_timeout to 120 seconds. If anything at all was written
-- in the last two minutes, Postgres closes the current 16 MB WAL segment, fills
-- what is left of it with zeros, and the archiver reads the whole file to ship
-- it. A single small write therefore costs 16 MB written and 16 MB read.
--
-- pg_cron logs every run to cron.job_run_details, so a job that runs every
-- minute means the database never stays quiet for two minutes. jira-sync-kick,
-- added on 22 October, did exactly that: about 720 segments a day, 11.5 GB
-- written and as much read, for 60 MB of real changes. Supabase's first warning
-- came that same evening. The counter db_io_report() watched, wal_bytes, leaves
-- the padding out, so it showed 0.2 MB an hour throughout.
--
-- The kick is a fallback. Changes kick the sync themselves, webhooks drain at
-- once, and a drain that leaves anything now kicks the next itself. So it can
-- run every half hour, and Jira's levels be checked hourly, on the same minute
-- as the hourly snapshot so the two share one segment.

DO $cron$
BEGIN
  PERFORM cron.unschedule('jira-sync-kick') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jira-sync-kick');
  PERFORM cron.schedule('jira-sync-kick', '*/30 * * * *', 'SELECT public.jira_kick()');
  PERFORM cron.unschedule('jira-hierarchy-check') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jira-hierarchy-check');
  PERFORM cron.schedule('jira-hierarchy-check', '0 * * * *', 'SELECT public.jira_queue_levels_check()');
END
$cron$;

-- The renames Jira refused for a name it would not show us: the sync now tries
-- the next free name, so they can go through.
UPDATE public.jira_sync_queue
   SET attempts = 0, error = NULL
 WHERE kind = 'rename' AND done_at IS NULL AND attempts >= 3;

-- What the watch was blind to: segments archived, each 16 MB written and read.
ALTER TABLE public.db_io_snapshots ADD COLUMN IF NOT EXISTS archived_count bigint;

CREATE OR REPLACE FUNCTION public.take_db_io_snapshot()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.db_io_snapshots (temp_bytes, temp_files, wal_bytes, blks_read, archived_count)
  SELECT d.temp_bytes, d.temp_files, w.wal_bytes, d.blks_read, a.archived_count
    FROM pg_stat_database d, pg_stat_wal w, pg_stat_archiver a
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
    SELECT taken_at, temp_bytes, temp_files, wal_bytes, blks_read, archived_count,
           lag(temp_bytes) OVER w AS p_temp, lag(temp_files) OVER w AS p_files,
           lag(wal_bytes) OVER w AS p_wal, lag(blks_read) OVER w AS p_read,
           lag(archived_count) OVER w AS p_archived
      FROM public.db_io_snapshots
     WHERE taken_at >= now() - make_interval(hours => _hours) - interval '90 minutes'
    WINDOW w AS (ORDER BY taken_at)
  ),
  steps AS (
    SELECT taken_at,
           CASE WHEN temp_bytes >= p_temp THEN temp_bytes - p_temp ELSE temp_bytes END AS temp,
           CASE WHEN temp_files >= p_files THEN temp_files - p_files ELSE temp_files END AS files,
           CASE WHEN wal_bytes >= p_wal THEN wal_bytes - p_wal ELSE wal_bytes END AS wal,
           CASE WHEN blks_read >= p_read THEN blks_read - p_read ELSE blks_read END AS read,
           CASE WHEN archived_count >= p_archived THEN archived_count - p_archived ELSE archived_count END AS segments
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
    'wal_segments', (SELECT coalesce(sum(segments), 0) FROM steps),
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

SELECT public.take_db_io_snapshot();
