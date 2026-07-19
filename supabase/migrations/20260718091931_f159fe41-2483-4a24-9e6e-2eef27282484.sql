
CREATE OR REPLACE FUNCTION public.move_time_entries(
  _entry_ids uuid[],
  _target_kind text,
  _target_id text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid;
  _target_org uuid;
  _updated integer;
BEGIN
  _caller := auth.uid();
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _target_kind NOT IN ('work_item','backlog','tree') THEN
    RAISE EXCEPTION 'Invalid target kind: %', _target_kind;
  END IF;

  IF _entry_ids IS NULL OR array_length(_entry_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Resolve destination org
  IF _target_kind = 'work_item' THEN
    SELECT organization_id INTO _target_org FROM work_items WHERE id = _target_id;
  ELSIF _target_kind = 'backlog' THEN
    SELECT organization_id INTO _target_org FROM backlogs WHERE id = _target_id;
  ELSE
    SELECT organization_id INTO _target_org FROM backlog_trees WHERE id = _target_id;
  END IF;

  IF _target_org IS NULL THEN
    RAISE EXCEPTION 'Target % % not found', _target_kind, _target_id;
  END IF;

  IF NOT (is_member_of(_caller, _target_org) OR is_superuser(_caller)) THEN
    RAISE EXCEPTION 'Permission denied: not a member of the target organization';
  END IF;

  -- Caller must be a member of every source org referenced by these entries
  IF NOT is_superuser(_caller) AND EXISTS (
    SELECT 1 FROM time_entries te
    WHERE te.id = ANY(_entry_ids)
      AND NOT is_member_of(_caller, te.organization_id)
  ) THEN
    RAISE EXCEPTION 'Permission denied: not a member of one or more source organizations';
  END IF;

  UPDATE time_entries
  SET
    work_item_id = CASE WHEN _target_kind = 'work_item' THEN _target_id ELSE NULL END,
    backlog_id   = CASE WHEN _target_kind = 'backlog'   THEN _target_id ELSE NULL END,
    tree_id      = CASE WHEN _target_kind = 'tree'      THEN _target_id ELSE NULL END,
    organization_id = _target_org
  WHERE id = ANY(_entry_ids);

  GET DIAGNOSTICS _updated = ROW_COUNT;
  RETURN _updated;
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_time_entries(uuid[], text, text) TO authenticated;
