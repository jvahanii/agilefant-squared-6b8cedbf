-- Cold start read every rank row individually: ~10 400 rows for the largest
-- org, each repeating an org-prefixed work_item_id and backlog_id, which came
-- to 1.7 MB of a 3.5 MB payload. Almost all of that was repetition — those rows
-- reference only 54 distinct backlogs.
--
-- This returns the ranks grouped by work item, with backlog ids interned into a
-- dictionary so each rank costs an array index instead of a ~75-character
-- string. Same data, ~650 kB instead of ~1.7 MB.
--
--   { "backlogIds": ["<backlog id>", ...],
--     "backlog":    { "<work item id>": { "<index into backlogIds>": rank } },
--     "board":      { "<work item id>": { "<index into backlogIds>": rank } } }
--
-- SECURITY INVOKER (the default, stated here deliberately) is load-bearing:
-- both tables are protected by RLS policies that admit a row when the caller is
-- a member of the owning org, is a superuser, or can reach the work item via a
-- shared tree. Running as the definer would hand every caller every org's
-- ranks, so this must execute as the caller and let those policies filter it
-- exactly as the direct table reads did.
CREATE OR REPLACE FUNCTION public.get_work_item_ranks(_org_ids uuid[])
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH visible_backlog AS (
    SELECT work_item_id, backlog_id, rank
    FROM public.work_item_backlog_ranks
    WHERE organization_id = ANY(_org_ids)
      AND work_item_id IS NOT NULL
      AND backlog_id IS NOT NULL
  ),
  visible_board AS (
    SELECT work_item_id, backlog_id, rank
    FROM public.work_item_board_ranks
    WHERE organization_id = ANY(_org_ids)
      AND work_item_id IS NOT NULL
      AND backlog_id IS NOT NULL
  ),
  -- One dictionary serves both maps, so a backlog appearing in each is stored once.
  backlog_index AS (
    SELECT backlog_id, (row_number() OVER (ORDER BY backlog_id) - 1) AS idx
    FROM (
      SELECT backlog_id FROM visible_backlog
      UNION
      SELECT backlog_id FROM visible_board
    ) distinct_ids
  )
  SELECT jsonb_build_object(
    'backlogIds', COALESCE(
      (SELECT jsonb_agg(backlog_id ORDER BY idx) FROM backlog_index), '[]'::jsonb),
    'backlog', COALESCE((
      SELECT jsonb_object_agg(work_item_id, ranks)
      FROM (
        SELECT v.work_item_id,
               jsonb_object_agg(backlog_index.idx::text, COALESCE(v.rank, 0)) AS ranks
        FROM visible_backlog v
        JOIN backlog_index USING (backlog_id)
        GROUP BY v.work_item_id
      ) grouped_backlog
    ), '{}'::jsonb),
    'board', COALESCE((
      SELECT jsonb_object_agg(work_item_id, ranks)
      FROM (
        SELECT v.work_item_id,
               jsonb_object_agg(backlog_index.idx::text, COALESCE(v.rank, 0)) AS ranks
        FROM visible_board v
        JOIN backlog_index USING (backlog_id)
        GROUP BY v.work_item_id
      ) grouped_board
    ), '{}'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.get_work_item_ranks(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_work_item_ranks(uuid[]) TO authenticated, service_role;
