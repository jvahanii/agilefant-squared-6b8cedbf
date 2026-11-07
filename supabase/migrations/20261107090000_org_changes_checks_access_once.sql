-- get_org_changes checks access once, not once per row it counts.
--
-- Read as the caller, every row of the four counts went through its table's
-- access rule — a function call per row, some 21,000 of them for the largest
-- organization: 0.2 s warm, over a second cold, and five to seven seconds in
-- the app, where it runs beside the rest of a load's requests. The rows it
-- counts and returns are an organization's own, which a member sees all of;
-- so whether the caller is a member, or a superuser, is asked once, and the
-- rest is read as the owner. Anyone else is refused, and the app then loads
-- in full as before (rowMirror.ts).

CREATE OR REPLACE FUNCTION public.get_org_changes(_org_id uuid, _since timestamptz)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := public.current_user_id();
BEGIN
  IF _uid IS NULL OR NOT (public.is_member_of(_uid, _org_id) OR public.is_superuser(_uid)) THEN
    RAISE EXCEPTION 'not a member of this organization' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT json_build_object(
      'now', now(),
      'counts', json_build_object(
        'items', (SELECT count(*) FROM work_items WHERE organization_id = _org_id),
        'backlogRanks', (SELECT count(*) FROM work_item_backlog_ranks WHERE organization_id = _org_id),
        'boardRanks', (SELECT count(*) FROM work_item_board_ranks WHERE organization_id = _org_id),
        'hyperlinks', (SELECT count(*) FROM work_item_hyperlinks WHERE organization_id = _org_id)
      ),
      'items', CASE WHEN _since IS NULL THEN NULL ELSE (
        SELECT coalesce(json_agg(w), '[]'::json) FROM work_items w
        WHERE w.organization_id = _org_id AND w.changed_at > _since) END,
      'backlogRanks', CASE WHEN _since IS NULL THEN NULL ELSE (
        SELECT coalesce(json_agg(json_build_array(r.work_item_id, r.backlog_id, r.rank)), '[]'::json) FROM work_item_backlog_ranks r
        WHERE r.organization_id = _org_id AND r.changed_at > _since) END,
      'boardRanks', CASE WHEN _since IS NULL THEN NULL ELSE (
        SELECT coalesce(json_agg(json_build_array(r.work_item_id, r.backlog_id, r.rank)), '[]'::json) FROM work_item_board_ranks r
        WHERE r.organization_id = _org_id AND r.changed_at > _since) END,
      'hyperlinks', CASE WHEN _since IS NULL THEN NULL ELSE (
        SELECT coalesce(json_agg(json_build_object('id', h.id, 'work_item_id', h.work_item_id, 'url', h.url, 'alt_text', h.alt_text, 'rank', h.rank)), '[]'::json)
        FROM work_item_hyperlinks h WHERE h.organization_id = _org_id AND h.changed_at > _since) END,
      'deleted', CASE WHEN _since IS NULL THEN NULL ELSE (
        SELECT coalesce(json_agg(json_build_array(d.kind, d.row_key)), '[]'::json) FROM row_deletions d
        WHERE d.organization_id = _org_id AND d.deleted_at > _since) END
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_changes(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_changes(uuid, timestamptz) TO authenticated, service_role;
