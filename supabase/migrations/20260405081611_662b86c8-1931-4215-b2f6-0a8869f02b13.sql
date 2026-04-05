
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY organization_id, parent_id
           ORDER BY rank ASC, id ASC
         ) - 1 AS new_rank
  FROM work_items
)
UPDATE work_items wi
SET rank = r.new_rank
FROM ranked r
WHERE wi.id = r.id
  AND wi.rank IS DISTINCT FROM r.new_rank;
