CREATE TABLE public.backlog_tree_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(tree_id, organization_id)
);

ALTER TABLE public.backlog_tree_shares ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_tree_accessible(_user_id uuid, _tree_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM backlog_trees bt WHERE bt.id = _tree_id AND is_member_of(_user_id, bt.organization_id)
  ) OR EXISTS (
    SELECT 1 FROM backlog_tree_shares bts
    JOIN memberships m ON m.organization_id = bts.organization_id AND m.user_id = _user_id
    WHERE bts.tree_id = _tree_id
  ) OR is_superuser(_user_id)
$$;

CREATE OR REPLACE FUNCTION public.has_accessible_tree_assignment(_user_id uuid, _assignments jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM jsonb_object_keys(_assignments) AS tree_id
    WHERE is_tree_accessible(_user_id, tree_id)
  )
$$;

CREATE POLICY "Owner and shared org members can read shares"
ON backlog_tree_shares FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM backlog_trees bt WHERE bt.id = backlog_tree_shares.tree_id AND is_member_of(auth.uid(), bt.organization_id))
  OR is_member_of(auth.uid(), backlog_tree_shares.organization_id)
  OR is_superuser(auth.uid())
);

CREATE POLICY "Owner org admins can insert shares"
ON backlog_tree_shares FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM backlog_trees bt WHERE bt.id = backlog_tree_shares.tree_id AND (
      has_org_role(auth.uid(), bt.organization_id, 'owner')
      OR has_org_role(auth.uid(), bt.organization_id, 'admin')
      OR is_superuser(auth.uid())
    )
  )
);

CREATE POLICY "Owner org admins can delete shares"
ON backlog_tree_shares FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM backlog_trees bt WHERE bt.id = backlog_tree_shares.tree_id AND (
      has_org_role(auth.uid(), bt.organization_id, 'owner')
      OR has_org_role(auth.uid(), bt.organization_id, 'admin')
      OR is_superuser(auth.uid())
    )
  )
);

DROP POLICY IF EXISTS "Org members can read" ON backlog_trees;
CREATE POLICY "Org members and shared can read" ON backlog_trees
FOR SELECT TO authenticated
USING (
  is_member_of(auth.uid(), backlog_trees.organization_id) OR is_superuser(auth.uid())
  OR EXISTS (
    SELECT 1 FROM backlog_tree_shares bts
    JOIN memberships m ON m.organization_id = bts.organization_id AND m.user_id = auth.uid()
    WHERE bts.tree_id = backlog_trees.id
  )
);

DROP POLICY IF EXISTS "Org members can update" ON backlog_trees;
CREATE POLICY "Org members and shared can update" ON backlog_trees
FOR UPDATE TO authenticated
USING (
  is_member_of(auth.uid(), backlog_trees.organization_id) OR is_superuser(auth.uid())
  OR EXISTS (
    SELECT 1 FROM backlog_tree_shares bts
    JOIN memberships m ON m.organization_id = bts.organization_id AND m.user_id = auth.uid()
    WHERE bts.tree_id = backlog_trees.id
  )
);

DROP POLICY IF EXISTS "Org members can read" ON backlogs;
CREATE POLICY "Org members and shared can read" ON backlogs
FOR SELECT TO authenticated
USING (is_member_of(auth.uid(), backlogs.organization_id) OR is_superuser(auth.uid()) OR is_tree_accessible(auth.uid(), backlogs.tree_id));

DROP POLICY IF EXISTS "Org members can update" ON backlogs;
CREATE POLICY "Org members and shared can update" ON backlogs
FOR UPDATE TO authenticated
USING (is_member_of(auth.uid(), backlogs.organization_id) OR is_superuser(auth.uid()) OR is_tree_accessible(auth.uid(), backlogs.tree_id));

DROP POLICY IF EXISTS "Org members can insert" ON backlogs;
CREATE POLICY "Org members and shared can insert" ON backlogs
FOR INSERT TO authenticated
WITH CHECK (is_member_of(auth.uid(), backlogs.organization_id) OR is_superuser(auth.uid()) OR is_tree_accessible(auth.uid(), backlogs.tree_id));

DROP POLICY IF EXISTS "Org members can delete" ON backlogs;
CREATE POLICY "Org members and shared can delete" ON backlogs
FOR DELETE TO authenticated
USING (is_member_of(auth.uid(), backlogs.organization_id) OR is_superuser(auth.uid()) OR is_tree_accessible(auth.uid(), backlogs.tree_id));

DROP POLICY IF EXISTS "Org members can read" ON work_items;
CREATE POLICY "Org members and shared can read" ON work_items
FOR SELECT TO authenticated
USING (is_member_of(auth.uid(), work_items.organization_id) OR is_superuser(auth.uid()) OR has_accessible_tree_assignment(auth.uid(), work_items.backlog_assignments));

DROP POLICY IF EXISTS "Org members can update" ON work_items;
CREATE POLICY "Org members and shared can update" ON work_items
FOR UPDATE TO authenticated
USING (is_member_of(auth.uid(), work_items.organization_id) OR is_superuser(auth.uid()) OR has_accessible_tree_assignment(auth.uid(), work_items.backlog_assignments));

DROP POLICY IF EXISTS "Org members can insert" ON work_items;
CREATE POLICY "Org members and shared can insert" ON work_items
FOR INSERT TO authenticated
WITH CHECK (is_member_of(auth.uid(), work_items.organization_id) OR is_superuser(auth.uid()) OR has_accessible_tree_assignment(auth.uid(), work_items.backlog_assignments));

DROP POLICY IF EXISTS "Org members can delete" ON work_items;
CREATE POLICY "Org members and shared can delete" ON work_items
FOR DELETE TO authenticated
USING (is_member_of(auth.uid(), work_items.organization_id) OR is_superuser(auth.uid()) OR has_accessible_tree_assignment(auth.uid(), work_items.backlog_assignments));