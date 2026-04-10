-- Fix work items whose ID prefix references a deleted organization.
--
-- Background: during org deletion, TeamSettings.tsx transfers work items to a
-- new owner by updating `organization_id`, but left item IDs unchanged.  An
-- item ID embeds the owning org as a prefix ("old_org_uuid::raw_part"); the
-- helper `ownerOrgOf()` re-derives organization_id from that prefix on every
-- upsert.  After the original org is deleted, the next save of a transferred
-- item tries to write organization_id = deleted_org_uuid — an FK violation.
--
-- This migration:
--   1. Creates (or replaces) a reusable function `rename_work_items_org_prefix`
--      that atomically renames item IDs, fixes parent_id back-references, and
--      updates work_item_hyperlinks.work_item_id.
--   2. Runs a DO block that calls the function for every work item whose ID
--      prefix no longer maps to an existing organization (the "8 items").

-- ── 1. Reusable function ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rename_work_items_org_prefix(
  _item_ids   text[],
  _new_org_id uuid
)
RETURNS jsonb          -- mapping: old_id -> new_id
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
  -- Permission: allow when called from a migration (auth.uid() IS NULL),
  -- by a superuser, or by a member of the org that currently owns each item.
  IF auth.uid() IS NOT NULL AND NOT is_superuser(auth.uid()) THEN
    IF EXISTS (
      SELECT 1
      FROM work_items wi
      WHERE wi.id = ANY(_item_ids)
        AND NOT is_member_of(auth.uid(), wi.organization_id)
    ) THEN
      RAISE EXCEPTION 'Permission denied: not a member of the item-owner org';
    END IF;
  END IF;

  -- Build old_id → new_id arrays.
  FOR rec IN SELECT id FROM work_items WHERE id = ANY(_item_ids) LOOP
    _old_id := rec.id;
    IF strpos(_old_id, '::') > 0 THEN
      _new_id := _new_org_id::text || '::' || split_part(_old_id, '::', 2);
    ELSE
      _new_id := _new_org_id::text || '::' || _old_id;
    END IF;
    -- Resolve any collision by generating a fresh suffix.
    WHILE EXISTS (SELECT 1 FROM work_items WHERE id = _new_id) LOOP
      _new_id := _new_org_id::text || '::wi-' || substring(gen_random_uuid()::text, 1, 8);
    END LOOP;
    _old_ids := _old_ids || _old_id;
    _new_ids := _new_ids || _new_id;
    _id_map  := _id_map  || jsonb_build_object(_old_id, _new_id);
  END LOOP;

  IF array_length(_old_ids, 1) IS NULL THEN
    RETURN _id_map;  -- nothing to do
  END IF;

  -- Step 1: Insert new rows with parent_id = NULL to avoid self-referential
  --         FK issues during the bulk insert.
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

  -- Step 2: Restore parent_id on the newly inserted rows.
  --         If the parent is also being renamed, use the new parent ID;
  --         otherwise keep the original parent ID.
  UPDATE work_items nwi
  SET parent_id = COALESCE(_id_map ->> owi.parent_id, owi.parent_id)
  FROM work_items owi
  WHERE owi.id = ANY(_old_ids)
    AND nwi.id = _id_map ->> owi.id
    AND owi.parent_id IS NOT NULL;

  -- Step 3: Update parent_id in OTHER items (not part of this rename batch)
  --         that reference one of the old IDs.
  UPDATE work_items wi
  SET parent_id = _id_map ->> wi.parent_id
  WHERE wi.parent_id = ANY(_old_ids)
    AND wi.id <> ALL(_old_ids)
    AND wi.id <> ALL(_new_ids);

  -- Step 4: Update hyperlinks (work_item_id + organization_id).
  UPDATE work_item_hyperlinks h
  SET work_item_id    = _id_map ->> h.work_item_id,
      organization_id = _new_org_id
  WHERE h.work_item_id = ANY(_old_ids);

  -- Step 5: Delete the old rows.  All parent_id and hyperlink references have
  --         been redirected above, so no cascade side-effects remain.
  DELETE FROM work_items WHERE id = ANY(_old_ids);

  RETURN _id_map;
END;
$$;

-- ── 2. Data fix: repair already-affected items ────────────────────────────────

DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Find work items whose ID prefix is a UUID that no longer exists in the
  -- organizations table, grouped by their current (correct) organization_id.
  FOR rec IN
    SELECT
      organization_id          AS new_org_id,
      array_agg(id ORDER BY id) AS old_ids
    FROM work_items
    WHERE id LIKE '%::%'
      AND (split_part(id, '::', 1))::uuid <> organization_id
      AND NOT EXISTS (
        SELECT 1 FROM organizations o
        WHERE o.id::text = split_part(work_items.id, '::', 1)
      )
    GROUP BY organization_id
  LOOP
    PERFORM public.rename_work_items_org_prefix(rec.old_ids, rec.new_org_id);
  END LOOP;
END $$;
