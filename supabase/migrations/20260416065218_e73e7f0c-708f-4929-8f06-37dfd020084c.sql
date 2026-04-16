
-- Helper: does the caller belong to an org that shares trees with _org_id?
CREATE OR REPLACE FUNCTION public.has_shared_tree_with_org(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- User's org owns a tree shared with _org_id
    SELECT 1
    FROM backlog_trees bt
    JOIN memberships m ON m.organization_id = bt.organization_id AND m.user_id = _user_id
    JOIN backlog_tree_shares bts ON bts.tree_id = bt.id AND bts.organization_id = _org_id
    UNION ALL
    -- User's org received a share from _org_id
    SELECT 1
    FROM backlog_tree_shares bts
    JOIN memberships m ON m.organization_id = bts.organization_id AND m.user_id = _user_id
    JOIN backlog_trees bt ON bt.id = bts.tree_id AND bt.organization_id = _org_id
  )
$$;

-- Teams: allow reading teams from sharing-partner orgs
DROP POLICY IF EXISTS "Org members can read teams" ON public.teams;
CREATE POLICY "Org members can read teams" ON public.teams
  FOR SELECT TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
    OR has_shared_tree_with_org(auth.uid(), organization_id)
  );

-- Work item team assignments: allow insert for accessible work items
DROP POLICY IF EXISTS "Org members can insert assignments" ON public.work_item_team_assignments;
CREATE POLICY "Org members can insert assignments" ON public.work_item_team_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
    OR is_work_item_accessible(auth.uid(), work_item_id)
  );

-- Work item team assignments: allow delete for accessible work items
DROP POLICY IF EXISTS "Org members can delete assignments" ON public.work_item_team_assignments;
CREATE POLICY "Org members can delete assignments" ON public.work_item_team_assignments
  FOR DELETE TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
    OR is_work_item_accessible(auth.uid(), work_item_id)
  );
