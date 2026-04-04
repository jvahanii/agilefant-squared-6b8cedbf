
DO $$
DECLARE
  grp RECORD;
  item RECORD;
  new_rank INT;
BEGIN
  FOR grp IN
    SELECT DISTINCT d.organization_id, d.parent_id
    FROM (
      SELECT organization_id, parent_id, rank
      FROM work_items
      GROUP BY organization_id, parent_id, rank
      HAVING count(*) > 1
    ) d
  LOOP
    new_rank := 0;
    FOR item IN
      SELECT id
      FROM work_items
      WHERE organization_id = grp.organization_id
        AND parent_id IS NOT DISTINCT FROM grp.parent_id
      ORDER BY rank ASC, id ASC
    LOOP
      UPDATE work_items SET rank = new_rank WHERE id = item.id;
      new_rank := new_rank + 1;
    END LOOP;
  END LOOP;
END $$;
