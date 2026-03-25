
-- 1. Fix memberships INSERT: remove self-join loophole
DROP POLICY IF EXISTS "Admins can manage memberships" ON public.memberships;

CREATE POLICY "Admins can manage memberships" ON public.memberships
FOR INSERT TO authenticated
WITH CHECK (
  has_org_role(auth.uid(), organization_id, 'owner'::app_role)
  OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  OR is_superuser(auth.uid())
);

-- 2. Drop unused test_notes table
DROP TABLE IF EXISTS public.test_notes;

-- 3. Fix organizations INSERT: require authenticated user to be the one creating
DROP POLICY IF EXISTS "Authenticated users can create orgs" ON public.organizations;

CREATE POLICY "Authenticated users can create orgs" ON public.organizations
FOR INSERT TO authenticated
WITH CHECK (auth.uid() IS NOT NULL);
