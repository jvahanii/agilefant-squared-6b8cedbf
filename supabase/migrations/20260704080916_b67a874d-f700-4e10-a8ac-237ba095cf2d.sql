
-- Clean up stale backlog_assignments in work_items: keep only (treeId -> backlogId)
-- pairs where the tree exists, the backlog exists, and the backlog belongs to that tree.
WITH cleaned AS (
  SELECT
    wi.id,
    COALESCE((
      SELECT jsonb_object_agg(kv.key, kv.value)
      FROM jsonb_each_text(wi.backlog_assignments) kv
      JOIN public.backlogs b ON b.id = kv.value AND b.tree_id = kv.key
      JOIN public.backlog_trees t ON t.id = kv.key
    ), '{}'::jsonb) AS new_assignments
  FROM public.work_items wi
)
UPDATE public.work_items wi
SET backlog_assignments = cleaned.new_assignments
FROM cleaned
WHERE wi.id = cleaned.id
  AND wi.backlog_assignments IS DISTINCT FROM cleaned.new_assignments;

-- Remove orphan rank rows pointing at backlogs that no longer exist.
DELETE FROM public.work_item_backlog_ranks r
WHERE NOT EXISTS (SELECT 1 FROM public.backlogs b WHERE b.id = r.backlog_id);
