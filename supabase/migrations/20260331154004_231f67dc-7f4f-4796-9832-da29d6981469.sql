CREATE OR REPLACE FUNCTION public.get_tree_sharing_info(_tree_id text, _exclude_org_id uuid)
RETURNS TABLE(org_id uuid, org_name text, is_owner boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT o.id, o.name, (o.id = bt.organization_id) AS is_owner
  FROM backlog_trees bt
  CROSS JOIN LATERAL (
    SELECT bt.organization_id AS oid
    UNION
    SELECT bts.organization_id AS oid
    FROM backlog_tree_shares bts
    WHERE bts.tree_id = _tree_id
  ) orgs
  JOIN organizations o ON o.id = orgs.oid
  WHERE bt.id = _tree_id
    AND orgs.oid IS NOT NULL
    AND orgs.oid != _exclude_org_id
    AND is_tree_accessible(auth.uid(), _tree_id)
$$;