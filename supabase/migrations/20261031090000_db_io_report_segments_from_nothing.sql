-- The Disk IO report counted the first snapshot that had archived_count as if
-- every segment since statistics began had been archived that hour: the snapshot
-- before it, from before the column, has none to subtract, and the comparison
-- then fell through to the branch meant for a counter reset by a restart. So the
-- watch reported 6083 segments on 31 October, not the real 154, and failed.
-- A step with nothing to compare against now counts as none.

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
           CASE WHEN p_archived IS NULL THEN 0
                WHEN archived_count >= p_archived THEN archived_count - p_archived
                ELSE archived_count END AS segments
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
