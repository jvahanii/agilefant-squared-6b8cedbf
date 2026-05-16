
-- 1. Add target-org membership check to rename_work_items_org_prefix
CREATE OR REPLACE FUNCTION public.rename_work_items_org_prefix(
  _item_ids   text[],
  _new_org_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old_ids  text[]  := '{}';
  _new_ids  text[]  := '{}';
  _id_map   jsonb   := '{}';
  rec       RECORD;
  _old_id   text;
  _new_id   text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_superuser(auth.uid()) THEN
    -- Caller must be a member of the destination org
    IF NOT is_member_of(auth.uid(), _new_org_id) THEN
      RAISE EXCEPTION 'Permission denied: not a member of target org';
    END IF;
    -- And a member of the source org for every item being moved
    IF EXISTS (
      SELECT 1
      FROM work_items wi
      WHERE wi.id = ANY(_item_ids)
        AND NOT is_member_of(auth.uid(), wi.organization_id)
    ) THEN
      RAISE EXCEPTION 'Permission denied: not a member of the item-owner org';
    END IF;
  END IF;

  FOR rec IN SELECT id FROM work_items WHERE id = ANY(_item_ids) LOOP
    _old_id := rec.id;
    IF strpos(_old_id, '::') > 0 THEN
      _new_id := _new_org_id::text || '::' || split_part(_old_id, '::', 2);
    ELSE
      _new_id := _new_org_id::text || '::' || _old_id;
    END IF;
    WHILE EXISTS (SELECT 1 FROM work_items WHERE id = _new_id) LOOP
      _new_id := _new_org_id::text || '::wi-' || substring(gen_random_uuid()::text, 1, 8);
    END LOOP;
    _old_ids := _old_ids || _old_id;
    _new_ids := _new_ids || _new_id;
    _id_map  := _id_map  || jsonb_build_object(_old_id, _new_id);
  END LOOP;

  IF array_length(_old_ids, 1) IS NULL THEN
    RETURN _id_map;
  END IF;

  INSERT INTO work_items (
    id, title, description, points, status,
    parent_id, backlog_assignments, rank, organization_id,
    respawn_enabled, respawn_interval_days, respawn_hour, respawn_last_triggered_at
  )
  SELECT
    _id_map ->> wi.id,
    wi.title, wi.description, wi.points, wi.status,
    NULL,
    wi.backlog_assignments, wi.rank, _new_org_id,
    wi.respawn_enabled, wi.respawn_interval_days, wi.respawn_hour, wi.respawn_last_triggered_at
  FROM work_items wi
  WHERE wi.id = ANY(_old_ids);

  UPDATE work_items child
  SET parent_id = _id_map ->> child.parent_id
  WHERE child.id = ANY(_new_ids)
    AND (SELECT parent_id FROM work_items orig WHERE orig.id = (
      SELECT key FROM jsonb_each_text(_id_map) WHERE value = child.id
    )) IS NOT NULL;

  UPDATE work_item_hyperlinks h
  SET work_item_id = _id_map ->> h.work_item_id
  WHERE h.work_item_id = ANY(_old_ids);

  UPDATE work_item_backlog_ranks r
  SET work_item_id = _id_map ->> r.work_item_id
  WHERE r.work_item_id = ANY(_old_ids);

  UPDATE work_item_team_assignments a
  SET work_item_id = _id_map ->> a.work_item_id
  WHERE a.work_item_id = ANY(_old_ids);

  UPDATE label_assignments la
  SET entity_id = _id_map ->> la.entity_id
  WHERE la.entity_type = 'work_item' AND la.entity_id = ANY(_old_ids);

  DELETE FROM work_items WHERE id = ANY(_old_ids);

  RETURN _id_map;
END;
$$;

-- 2. Restrict github_repo_integrations SELECT to admins/owners (webhook secret protection)
DROP POLICY IF EXISTS "Members can read integrations" ON public.github_repo_integrations;
CREATE POLICY "Admins can read integrations"
  ON public.github_repo_integrations FOR SELECT
  TO authenticated
  USING (
    has_org_role(auth.uid(), organization_id, 'owner'::app_role)
    OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
    OR is_superuser(auth.uid())
  );
