
CREATE OR REPLACE FUNCTION public.remove_tree_share_with_copy(_share_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tree_id text;
  _org_id uuid;
  _new_tree_id text;
  _new_backlog_id text;
  _new_wi_id text;
  _rec record;
BEGIN
  -- Get share details
  SELECT tree_id, organization_id INTO _tree_id, _org_id
  FROM backlog_tree_shares
  WHERE id = _share_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share not found';
  END IF;

  -- Verify caller has permission (tree admin or superuser)
  IF NOT is_tree_admin(auth.uid(), _tree_id) AND NOT is_superuser(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- Generate a new tree id for the copy
  _new_tree_id := _org_id::text || '::' || gen_random_uuid()::text;

  -- Copy the backlog tree
  INSERT INTO backlog_trees (id, name, organization_id, rank)
  SELECT _new_tree_id, name, _org_id, rank
  FROM backlog_trees
  WHERE id = _tree_id;

  -- Copy backlogs with new IDs, maintaining hierarchy
  CREATE TEMP TABLE _backlog_id_map (old_id text, new_id text) ON COMMIT DROP;

  FOR _rec IN
    SELECT id, name, parent_id, rank
    FROM backlogs
    WHERE tree_id = _tree_id
    ORDER BY rank
  LOOP
    _new_backlog_id := _org_id::text || '::' || gen_random_uuid()::text;
    INSERT INTO _backlog_id_map (old_id, new_id) VALUES (_rec.id, _new_backlog_id);

    INSERT INTO backlogs (id, name, tree_id, parent_id, rank, organization_id)
    VALUES (
      _new_backlog_id,
      _rec.name,
      _new_tree_id,
      NULL,
      _rec.rank,
      _org_id
    );
  END LOOP;

  -- Fix parent_id references for backlogs
  UPDATE backlogs b
  SET parent_id = pm.new_id
  FROM _backlog_id_map bm
  JOIN backlogs orig ON orig.id = bm.old_id
  JOIN _backlog_id_map pm ON pm.old_id = orig.parent_id
  WHERE b.id = bm.new_id
    AND orig.parent_id IS NOT NULL;

  -- Copy work items that are assigned to the original tree
  CREATE TEMP TABLE _wi_id_map (old_id text, new_id text) ON COMMIT DROP;

  FOR _rec IN
    SELECT id, title, description, points, status, parent_id, backlog_assignments, rank,
           respawn_enabled, respawn_interval_days, respawn_hour, respawn_last_triggered_at
    FROM work_items
    WHERE backlog_assignments ? _tree_id
    ORDER BY rank
  LOOP
    _new_wi_id := _org_id::text || '::' || gen_random_uuid()::text;
    INSERT INTO _wi_id_map (old_id, new_id) VALUES (_rec.id, _new_wi_id);

    -- Build new backlog_assignments: replace old tree_id key with new tree_id,
    -- and map old backlog_id to new backlog_id
    INSERT INTO work_items (id, title, description, points, status, parent_id,
                            backlog_assignments, rank, organization_id,
                            respawn_enabled, respawn_interval_days, respawn_hour, respawn_last_triggered_at)
    VALUES (
      _new_wi_id,
      _rec.title,
      _rec.description,
      _rec.points,
      _rec.status,
      NULL, -- fix parent_id later
      jsonb_build_object(
        _new_tree_id,
        COALESCE(
          (SELECT new_id FROM _backlog_id_map WHERE old_id = (_rec.backlog_assignments ->> _tree_id)),
          _rec.backlog_assignments ->> _tree_id
        )
      ),
      _rec.rank,
      _org_id,
      _rec.respawn_enabled,
      _rec.respawn_interval_days,
      _rec.respawn_hour,
      _rec.respawn_last_triggered_at
    );
  END LOOP;

  -- Fix parent_id references for work items
  UPDATE work_items wi
  SET parent_id = wm.new_id
  FROM _wi_id_map wm_child
  JOIN work_items orig ON orig.id = wm_child.old_id
  JOIN _wi_id_map wm ON wm.old_id = orig.parent_id
  WHERE wi.id = wm_child.new_id
    AND orig.parent_id IS NOT NULL;

  -- Delete the share
  DELETE FROM backlog_tree_shares WHERE id = _share_id;
END;
$$;
