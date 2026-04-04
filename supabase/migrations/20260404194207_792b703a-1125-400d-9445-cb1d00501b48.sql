
-- Create a security definer function that checks if a work item is accessible
-- to a user (via org membership, superuser, or shared tree assignment)
CREATE OR REPLACE FUNCTION public.is_work_item_accessible(_user_id uuid, _work_item_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM work_items wi
    WHERE wi.id = _work_item_id
    AND (
      is_member_of(_user_id, wi.organization_id)
      OR is_superuser(_user_id)
      OR has_accessible_tree_assignment(_user_id, wi.backlog_assignments)
    )
  )
$$;

-- Update hyperlinks SELECT policy to include shared-tree access
DROP POLICY IF EXISTS "Org members and shared can read hyperlinks" ON work_item_hyperlinks;
CREATE POLICY "Org members and shared can read hyperlinks"
  ON work_item_hyperlinks FOR SELECT TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
    OR is_work_item_accessible(auth.uid(), work_item_id)
  );

-- Update hyperlinks UPDATE policy to include shared-tree access
DROP POLICY IF EXISTS "Org members can update hyperlinks" ON work_item_hyperlinks;
CREATE POLICY "Org members and shared can update hyperlinks"
  ON work_item_hyperlinks FOR UPDATE TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
    OR is_work_item_accessible(auth.uid(), work_item_id)
  );

-- Update hyperlinks DELETE policy to include shared-tree access
DROP POLICY IF EXISTS "Org members can delete hyperlinks" ON work_item_hyperlinks;
CREATE POLICY "Org members and shared can delete hyperlinks"
  ON work_item_hyperlinks FOR DELETE TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
    OR is_work_item_accessible(auth.uid(), work_item_id)
  );
