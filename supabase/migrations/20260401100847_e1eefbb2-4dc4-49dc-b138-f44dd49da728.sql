-- Fix: Admins should not be able to assign 'owner' role
-- Drop the existing policy and replace with a more restrictive one
DROP POLICY IF EXISTS "Admins can manage memberships" ON public.memberships;

CREATE POLICY "Admins can manage memberships"
ON public.memberships
FOR INSERT
TO authenticated
WITH CHECK (
  -- Owners can insert any role
  has_org_role(auth.uid(), organization_id, 'owner'::app_role)
  -- Admins can insert only 'member' or 'admin' roles (not 'owner')
  OR (has_org_role(auth.uid(), organization_id, 'admin'::app_role) AND role IN ('member'::app_role, 'admin'::app_role))
  -- Superusers can do anything
  OR is_superuser(auth.uid())
);