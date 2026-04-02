-- Restore the correct remove_tree_share_with_copy function.
--
-- Migration 20260402163321 accidentally overwrote the bidirectional fix from
-- 20260402160000 with an older version that:
--   • does not copy any work_items at all, and
--   • only creates a copy of the tree/backlogs for the leaving (shared) org.
--
-- The correct behaviour is:
--   • The shared org gets its own independent copy of the tree, backlogs, AND
--     all work_items that were visible in the shared tree (owner-org items are
--     copied into the shared org).
--   • The owner org gets copies of every work_item the shared org had in the
--     tree, so neither side loses data.

CREATE OR REPLACE FUNCTION public.remove_tree_share_with_copy(_share_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tree_id          text;
  v_shared_org_id    uuid;
  v_owner_org_id     uuid;
  v_new_tree_id      text;
  v_backlog_id_map   jsonb;   -- original backlog id  → new id (for shared org's tree)
  v_owner_item_map   jsonb;   -- owner-org item id    → new id (copy for shared org)
  v_shared_item_map  jsonb;   -- shared-org item id   → new id (copy for owner org)
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

  -- Permission: tree owner admin OR shared-org admin/owner OR superuser
  IF NOT (
    is_tree_admin(auth.uid(), v_tree_id)
    OR has_org_role(auth.uid(), v_shared_org_id, 'owner')
    OR has_org_role(auth.uid(), v_shared_org_id, 'admin')
    OR is_superuser(auth.uid())
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  -- ══ PART A: Create an independent tree copy for the leaving (shared) org ══

  -- A-1. New tree
  v_new_tree_id := v_shared_org_id::text || '::' || gen_random_uuid()::text;
  INSERT INTO backlog_trees (id, name, organization_id, rank)
    SELECT v_new_tree_id, name, v_shared_org_id, rank
      FROM backlog_trees WHERE id = v_tree_id;

  -- A-2. Build backlog ID map  (original id → new id)
  SELECT COALESCE(
    jsonb_object_agg(id, v_shared_org_id::text || '::' || gen_random_uuid()::text),
    '{}'::jsonb
  )
    INTO v_backlog_id_map
    FROM backlogs WHERE tree_id = v_tree_id;

  -- A-3. Copy backlogs with parent_id = NULL first (avoids FK violation on self-referential key)
  INSERT INTO backlogs (id, name, tree_id, parent_id, organization_id, rank)
  SELECT
    v_backlog_id_map ->> b.id,
    b.name,
    v_new_tree_id,
    NULL,   -- restored in A-4
    v_shared_org_id,
    b.rank
  FROM backlogs b WHERE b.tree_id = v_tree_id;

  -- A-4. Restore parent hierarchy for copied backlogs
  UPDATE backlogs nb
     SET parent_id = v_backlog_id_map ->> ob.parent_id
    FROM backlogs ob
   WHERE ob.tree_id = v_tree_id
     AND ob.parent_id IS NOT NULL
     AND nb.id = v_backlog_id_map ->> ob.id;

  -- A-5. Build item ID maps BEFORE any item modifications so references are stable
  SELECT COALESCE(
    jsonb_object_agg(id, v_shared_org_id::text || '::' || gen_random_uuid()::text),
    '{}'::jsonb
  )
    INTO v_owner_item_map
    FROM work_items
   WHERE organization_id = v_owner_org_id AND backlog_assignments ? v_tree_id;

  SELECT COALESCE(
    jsonb_object_agg(id, v_owner_org_id::text || '::' || gen_random_uuid()::text),
    '{}'::jsonb
  )
    INTO v_shared_item_map
    FROM work_items
   WHERE organization_id = v_shared_org_id AND backlog_assignments ? v_tree_id;

  -- A-6. Copy owner-org items into the shared org (parent_id = NULL to avoid FK violation)
  INSERT INTO work_items (
    id, title, description, points, status,
    parent_id, backlog_assignments, rank, organization_id,
    respawn_enabled, respawn_interval_days, respawn_hour, respawn_last_triggered_at
  )
  SELECT
    v_owner_item_map ->> wi.id,
    wi.title, wi.description, wi.points, wi.status,
    NULL,   -- restored in A-7
    (wi.backlog_assignments - v_tree_id) || jsonb_build_object(
      v_new_tree_id,
      v_backlog_id_map ->> (wi.backlog_assignments ->> v_tree_id)
    ),
    wi.rank, v_shared_org_id,
    wi.respawn_enabled, wi.respawn_interval_days, wi.respawn_hour, wi.respawn_last_triggered_at
  FROM work_items wi
  WHERE wi.organization_id = v_owner_org_id AND wi.backlog_assignments ? v_tree_id;

  -- A-7. Restore parent hierarchy for copied owner items in shared org
  UPDATE work_items nwi
     SET parent_id = v_owner_item_map ->> owi.parent_id
    FROM work_items owi
   WHERE owi.organization_id = v_owner_org_id
     AND owi.backlog_assignments ? v_tree_id
     AND owi.parent_id IS NOT NULL
     AND v_owner_item_map ? owi.parent_id
     AND nwi.id = v_owner_item_map ->> owi.id;

  -- ══ PART B: Give the owner org copies of the shared org's items ══════════
  -- This makes the separation truly "both sides": each org ends up with a
  -- complete independent copy of all content that was in the shared tree.
  -- NOTE: B-1/B-2 run BEFORE A-8 so shared-org items still carry v_tree_id
  --       in their backlog_assignments (the owner-org copy must reference the
  --       original tree that the owner keeps).

  -- B-1. Copy shared-org items to the owner org (parent_id = NULL to avoid FK violation)
  --      Shared-org items still reference v_tree_id at this point; keep that assignment
  --      so the copies are correctly slotted into the owner's existing tree.
  INSERT INTO work_items (
    id, title, description, points, status,
    parent_id, backlog_assignments, rank, organization_id,
    respawn_enabled, respawn_interval_days, respawn_hour, respawn_last_triggered_at
  )
  SELECT
    v_shared_item_map ->> wi.id,
    wi.title, wi.description, wi.points, wi.status,
    NULL,   -- restored in B-2
    wi.backlog_assignments,   -- still contains v_tree_id (unchanged before A-8)
    wi.rank, v_owner_org_id,
    wi.respawn_enabled, wi.respawn_interval_days, wi.respawn_hour, wi.respawn_last_triggered_at
  FROM work_items wi
  WHERE wi.organization_id = v_shared_org_id AND wi.backlog_assignments ? v_tree_id;

  -- B-2. Restore parent hierarchy for the owner-org copies of shared items.
  --      Parent within the copied set → map via v_shared_item_map.
  --      Parent is an owner-org item (not in map) → keep the original parent_id directly,
  --      since the owner retains those items with unchanged IDs.
  UPDATE work_items nwi
     SET parent_id = CASE
           WHEN v_shared_item_map ? swi.parent_id
             THEN v_shared_item_map ->> swi.parent_id
           ELSE swi.parent_id
         END
    FROM work_items swi
   WHERE swi.organization_id = v_shared_org_id
     AND swi.backlog_assignments ? v_tree_id   -- items not yet reassigned
     AND swi.parent_id IS NOT NULL
     AND nwi.id = v_shared_item_map ->> swi.id;

  -- ══ A-8 onwards: reassign / fix pointers for the shared org ══════════════

  -- A-8. Reassign shared-org's own items from the original tree to the new tree
  UPDATE work_items
     SET backlog_assignments =
           (backlog_assignments - v_tree_id) || jsonb_build_object(
             v_new_tree_id,
             v_backlog_id_map ->> (backlog_assignments ->> v_tree_id)
           )
   WHERE organization_id = v_shared_org_id
     AND backlog_assignments ? v_tree_id;

  -- A-9a. Fix parent pointers: shared-org items pointing at owner-org items → copied items
  UPDATE work_items
     SET parent_id = v_owner_item_map ->> parent_id
   WHERE organization_id = v_shared_org_id
     AND parent_id IS NOT NULL
     AND v_owner_item_map ? parent_id;

  -- A-9b. Null out parent pointers to owner-org items that were not copied
  UPDATE work_items
     SET parent_id = NULL
   WHERE organization_id = v_shared_org_id
     AND parent_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM work_items wi WHERE wi.id = work_items.parent_id AND wi.organization_id = v_owner_org_id)
     AND NOT (v_owner_item_map ? parent_id);

  -- B-3a. Fix parent pointers: owner-org items pointing at shared-org items → copied items
  UPDATE work_items
     SET parent_id = v_shared_item_map ->> parent_id
   WHERE organization_id = v_owner_org_id
     AND parent_id IS NOT NULL
     AND v_shared_item_map ? parent_id;

  -- B-3b. Null out parent pointers to shared-org items that were not copied
  UPDATE work_items
     SET parent_id = NULL
   WHERE organization_id = v_owner_org_id
     AND parent_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM work_items wi WHERE wi.id = work_items.parent_id AND wi.organization_id = v_shared_org_id)
     AND NOT (v_shared_item_map ? parent_id);

  -- ══ Delete the share record ═══════════════════════════════════════════════
  DELETE FROM backlog_tree_shares WHERE id = _share_id;

  RETURN jsonb_build_object('new_tree_id', v_new_tree_id);
END;
$$;
