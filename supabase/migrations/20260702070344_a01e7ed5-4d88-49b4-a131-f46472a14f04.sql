-- Densify work_item_backlog_ranks so that every (backlog_id, effective_parent_in_that_tree)
-- sibling group has consecutive 0..N-1 ranks. Order by current rank then work_item_id as
-- a deterministic tiebreaker. No schema change; data cleanup only.

WITH tree_of_backlog AS (
  SELECT id AS backlog_id, tree_id FROM backlogs
),
groups AS (
  SELECT
    r.work_item_id,
    r.backlog_id,
    tob.tree_id,
    CASE
      WHEN wi.parent_id_overrides ? tob.tree_id
        THEN wi.parent_id_overrides ->> tob.tree_id
      ELSE wi.parent_id
    END AS eff_parent,
    r.rank AS old_rank
  FROM work_item_backlog_ranks r
  JOIN work_items wi ON wi.id = r.work_item_id
  JOIN tree_of_backlog tob ON tob.backlog_id = r.backlog_id
),
ranked AS (
  SELECT
    work_item_id,
    backlog_id,
    (ROW_NUMBER() OVER (
      PARTITION BY backlog_id, COALESCE(eff_parent, '__ROOT__')
      ORDER BY old_rank, work_item_id
    ) - 1)::int AS new_rank
  FROM groups
)
UPDATE work_item_backlog_ranks r
SET rank = ranked.new_rank
FROM ranked
WHERE r.work_item_id = ranked.work_item_id
  AND r.backlog_id = ranked.backlog_id
  AND r.rank IS DISTINCT FROM ranked.new_rank;
