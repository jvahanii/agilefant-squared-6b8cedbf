-- Security definer function to check if a tree is shared with a user's org
-- This avoids RLS recursion by bypassing policies
CREATE OR REPLACE FUNCTION public.is_tree_shared_with_user(_user_id uuid, _tree_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM backlog_tree_shares bts
    JOIN memberships m ON m.organization_id = bts.organization_id AND m.user_id = _user_id
    WHERE bts.tree_id = _tree_id
  )
$$;

-- Security definer function to check if user owns the tree (member of tree's org)
CREATE OR REPLACE FUNCTION public.is_tree_owner_member(_user_id uuid, _tree_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM backlog_trees bt
    WHERE bt.id = _tree_id AND is_member_of(_user_id, bt.organization_id)
  )
$$;

-- Security definer to check if user is admin/owner of tree's org
CREATE OR REPLACE FUNCTION public.is_tree_admin(_user_id uuid, _tree_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM backlog_trees bt
    WHERE bt.id = _tree_id AND (
      has_org_role(_user_id, bt.organization_id, 'owner')
      OR has_org_role(_user_id, bt.organization_id, 'admin')
    )
  )
$$;

-- Replace is_tree_accessible to use the new functions (no cross-table RLS)
CREATE OR REPLACE FUNCTION public.is_tree_accessible(_user_id uuid, _tree_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT is_tree_owner_member(_user_id, _tree_id)
    OR is_tree_shared_with_user(_user_id, _tree_id)
    OR is_superuser(_user_id)
$$;

-- Fix backlog_trees policies: use security definer functions instead of subqueries
DROP POLICY IF EXISTS "Org members and shared can read" ON backlog_trees;
CREATE POLICY "Org members and shared can read" ON backlog_trees
FOR SELECT TO authenticated
USING (
  is_member_of(auth.uid(), backlog_trees.organization_id)
  OR is_superuser(auth.uid())
  OR is_tree_shared_with_user(auth.uid(), backlog_trees.id)
);

DROP POLICY IF EXISTS "Org members and shared can update" ON backlog_trees;
CREATE POLICY "Org members and shared can update" ON backlog_trees
FOR UPDATE TO authenticated
USING (
  is_member_of(auth.uid(), backlog_trees.organization_id)
  OR is_superuser(auth.uid())
  OR is_tree_shared_with_user(auth.uid(), backlog_trees.id)
);

-- Fix backlog_tree_shares policies: use security definer functions
DROP POLICY IF EXISTS "Owner and shared org members can read shares" ON backlog_tree_shares;
CREATE POLICY "Owner and shared org members can read shares" ON backlog_tree_shares
FOR SELECT TO authenticated
USING (
  is_tree_owner_member(auth.uid(), backlog_tree_shares.tree_id)
  OR is_member_of(auth.uid(), backlog_tree_shares.organization_id)
  OR is_superuser(auth.uid())
);

DROP POLICY IF EXISTS "Owner org admins can insert shares" ON backlog_tree_shares;
CREATE POLICY "Owner org admins can insert shares" ON backlog_tree_shares
FOR INSERT TO authenticated
WITH CHECK (
  is_tree_admin(auth.uid(), backlog_tree_shares.tree_id)
  OR is_superuser(auth.uid())
);

DROP POLICY IF EXISTS "Owner org admins can delete shares" ON backlog_tree_shares;
CREATE POLICY "Owner org admins can delete shares" ON backlog_tree_shares
FOR DELETE TO authenticated
USING (
  is_tree_admin(auth.uid(), backlog_tree_shares.tree_id)
  OR is_superuser(auth.uid())
);