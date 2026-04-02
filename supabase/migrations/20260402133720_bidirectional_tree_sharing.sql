-- Allow shared-org admins/owners to also remove a share (e.g. leave a shared tree)
DROP POLICY IF EXISTS "Owner org admins can delete shares" ON backlog_tree_shares;
CREATE POLICY "Participants can delete shares" ON backlog_tree_shares
FOR DELETE TO authenticated
USING (
  is_tree_admin(auth.uid(), backlog_tree_shares.tree_id)
  OR has_org_role(auth.uid(), backlog_tree_shares.organization_id, 'owner')
  OR has_org_role(auth.uid(), backlog_tree_shares.organization_id, 'admin')
  OR is_superuser(auth.uid())
);

-- Function: atomically remove a tree share and copy the shared tree to the leaving org.
-- The tree owner keeps the original; the formerly-shared org gets an independent copy of
-- the tree (backlogs + work items) so that no content is lost.
CREATE OR REPLACE FUNCTION public.remove_tree_share_with_copy(_share_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tree_id        text;
  v_shared_org_id  uuid;
  v_owner_org_id   uuid;
  v_new_tree_id    text;
  v_backlog_id_map jsonb;
  v_item_id_map    jsonb;
  rec              record;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Fetch share details
  SELECT bts.tree_id, bts.organization_id, bt.organization_id
    INTO v_tree_id, v_shared_org_id, v_owner_org_id
    FROM backlog_tree_shares bts
    JOIN backlog_trees bt ON bt.id = bts.tree_id
   WHERE bts.id = _share_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share not found';
  END IF;

  -- Permission: tree owner admin OR shared-org admin/owner
  IF NOT (
    is_tree_admin(auth.uid(), v_tree_id)
    OR has_org_role(auth.uid(), v_shared_org_id, 'owner')
    OR has_org_role(auth.uid(), v_shared_org_id, 'admin')
    OR is_superuser(auth.uid())
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- ── 1. Create a new tree for the leaving org ──────────────────────────────
  v_new_tree_id := v_shared_org_id::text || '::' || gen_random_uuid()::text;

  INSERT INTO backlog_trees (id, name, organization_id, rank)
    SELECT v_new_tree_id, name, v_shared_org_id, rank
      FROM backlog_trees WHERE id = v_tree_id;

  -- ── 2. Build backlog ID mapping (old id → new id) ────────────────────────
  SELECT COALESCE(
    jsonb_object_agg(id, v_shared_org_id::text || '::' || gen_random_uuid()::text),
    '{}'::jsonb
  )
    INTO v_backlog_id_map
    FROM backlogs WHERE tree_id = v_tree_id;

  -- ── 3. Copy backlogs with new IDs ────────────────────────────────────────
  FOR rec IN SELECT * FROM backlogs WHERE tree_id = v_tree_id LOOP
    INSERT INTO backlogs (id, name, tree_id, parent_id, organization_id, rank)
    VALUES (
      v_backlog_id_map ->> rec.id,
      rec.name,
      v_new_tree_id,
      CASE WHEN rec.parent_id IS NOT NULL
           THEN v_backlog_id_map ->> rec.parent_id
           ELSE NULL END,
      v_shared_org_id,
      rec.rank
    );
  END LOOP;

  -- ── 4. Build item ID mapping for owner-org items assigned to this tree ───
  SELECT COALESCE(
    jsonb_object_agg(id, v_shared_org_id::text || '::' || gen_random_uuid()::text),
    '{}'::jsonb
  )
    INTO v_item_id_map
    FROM work_items
   WHERE organization_id = v_owner_org_id
     AND backlog_assignments ? v_tree_id;

  -- ── 5. Copy owner-org items into the leaving org ─────────────────────────
  FOR rec IN
    SELECT * FROM work_items
     WHERE organization_id = v_owner_org_id
       AND backlog_assignments ? v_tree_id
  LOOP
    INSERT INTO work_items (
      id, title, description, points, status,
      parent_id, backlog_assignments, rank, organization_id,
      respawn_enabled, respawn_interval_days, respawn_hour, respawn_last_triggered_at
    ) VALUES (
      v_item_id_map ->> rec.id,
      rec.title,
      rec.description,
      rec.points,
      rec.status,
      -- preserve hierarchy within the copied set; orphan items outside it
      CASE WHEN rec.parent_id IS NOT NULL AND v_item_id_map ? rec.parent_id
           THEN v_item_id_map ->> rec.parent_id
           ELSE NULL END,
      -- replace old tree/backlog ref with new ones; keep any other assignments
      (rec.backlog_assignments - v_tree_id) || jsonb_build_object(
        v_new_tree_id,
        v_backlog_id_map ->> (rec.backlog_assignments ->> v_tree_id)
      ),
      rec.rank,
      v_shared_org_id,
      rec.respawn_enabled,
      rec.respawn_interval_days,
      rec.respawn_hour,
      rec.respawn_last_triggered_at
    );
  END LOOP;

  -- ── 6. Update leaving-org items: reassign from old tree to new tree ───────
  UPDATE work_items
     SET backlog_assignments =
           (backlog_assignments - v_tree_id) || jsonb_build_object(
             v_new_tree_id,
             v_backlog_id_map ->> (backlog_assignments ->> v_tree_id)
           )
   WHERE organization_id = v_shared_org_id
     AND backlog_assignments ? v_tree_id;

  -- ── 7a. Fix parent pointers of leaving-org items that pointed at copied owner items
  UPDATE work_items
     SET parent_id = v_item_id_map ->> parent_id
   WHERE organization_id = v_shared_org_id
     AND parent_id IS NOT NULL
     AND v_item_id_map ? parent_id;

  -- ── 7b. Null out parent pointers referencing owner-org items that were NOT copied
  --       (those items are no longer accessible to the leaving org after separation).
  UPDATE work_items
     SET parent_id = NULL
   WHERE organization_id = v_shared_org_id
     AND parent_id IS NOT NULL
     AND parent_id IN (
       SELECT wi.id FROM work_items wi WHERE wi.organization_id = v_owner_org_id
     )
     AND NOT (v_item_id_map ? parent_id);

  -- ── 8. Delete the share record ────────────────────────────────────────────
  DELETE FROM backlog_tree_shares WHERE id = _share_id;

  RETURN jsonb_build_object('new_tree_id', v_new_tree_id);
END;
$$;
