CREATE OR REPLACE FUNCTION public.build_organization_snapshot(_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid;
BEGIN
  _caller := auth.uid();
  -- Allow internal/service-role calls (no JWT) to proceed; for authenticated
  -- callers, require org membership or superuser.
  IF _caller IS NOT NULL AND NOT (
    is_member_of(_caller, _org_id) OR is_superuser(_caller)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN jsonb_build_object(
    'version', 1,
    'generated_at', now(),
    'organization_id', _org_id,
    'backlog_trees', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM backlog_trees t WHERE t.organization_id = _org_id), '[]'::jsonb),
    'backlogs', COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM backlogs b WHERE b.organization_id = _org_id), '[]'::jsonb),
    'work_items', COALESCE((SELECT jsonb_agg(to_jsonb(w)) FROM work_items w WHERE w.organization_id = _org_id), '[]'::jsonb),
    'work_item_backlog_ranks', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM work_item_backlog_ranks r WHERE r.organization_id = _org_id), '[]'::jsonb),
    'work_item_hyperlinks', COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM work_item_hyperlinks h WHERE h.organization_id = _org_id), '[]'::jsonb),
    'work_item_team_assignments', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM work_item_team_assignments a WHERE a.organization_id = _org_id), '[]'::jsonb),
    'labels', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM labels l WHERE l.organization_id = _org_id), '[]'::jsonb),
    'label_assignments', COALESCE((SELECT jsonb_agg(to_jsonb(la)) FROM label_assignments la WHERE la.organization_id = _org_id), '[]'::jsonb),
    'tree_statuses', COALESCE((
      SELECT jsonb_agg(to_jsonb(ts))
      FROM tree_statuses ts
      JOIN backlog_trees bt ON bt.id = ts.tree_id
      WHERE bt.organization_id = _org_id
    ), '[]'::jsonb)
  );
END;
$function$;