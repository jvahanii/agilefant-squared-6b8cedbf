
DO $$
DECLARE
  _org record;
  _tree_id text;
  _backlog_id text;
BEGIN
  FOR _org IN
    SELECT organization_id, count(*) AS n
    FROM work_items
    WHERE backlog_assignments = '{}'::jsonb OR backlog_assignments IS NULL
    GROUP BY organization_id
  LOOP
    _tree_id := _org.organization_id::text || '::bt-recovered-' || substring(gen_random_uuid()::text, 1, 8);
    _backlog_id := _org.organization_id::text || '::bl-recovered-' || substring(gen_random_uuid()::text, 1, 8);

    INSERT INTO backlog_trees (id, name, organization_id, rank)
    VALUES (_tree_id, 'Recovered items', _org.organization_id,
            COALESCE((SELECT max(rank) + 1 FROM backlog_trees WHERE organization_id = _org.organization_id), 0));

    INSERT INTO backlogs (id, name, tree_id, parent_id, rank, organization_id)
    VALUES (_backlog_id, 'Recovered items', _tree_id, NULL, 0, _org.organization_id);

    UPDATE work_items
    SET backlog_assignments = jsonb_build_object(_tree_id, _backlog_id),
        parent_id = NULL
    WHERE organization_id = _org.organization_id
      AND (backlog_assignments = '{}'::jsonb OR backlog_assignments IS NULL);

    INSERT INTO work_item_backlog_ranks (work_item_id, backlog_id, rank, organization_id)
    SELECT wi.id, _backlog_id, COALESCE(wi.rank, 0), _org.organization_id
    FROM work_items wi
    WHERE wi.organization_id = _org.organization_id
      AND wi.backlog_assignments = jsonb_build_object(_tree_id, _backlog_id)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;
