
-- Memberships: let admins update memberships
DROP POLICY IF EXISTS "Admins can update memberships" ON public.memberships;
CREATE POLICY "Admins can update memberships"
ON public.memberships FOR UPDATE TO authenticated
USING (
  has_org_role(auth.uid(), organization_id, 'owner'::app_role)
  OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  OR is_superuser(auth.uid())
);

-- Memberships: let admins delete memberships
DROP POLICY IF EXISTS "Admins can delete memberships" ON public.memberships;
CREATE POLICY "Admins can delete memberships"
ON public.memberships FOR DELETE TO authenticated
USING (
  has_org_role(auth.uid(), organization_id, 'owner'::app_role)
  OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  OR is_superuser(auth.uid())
  OR (user_id = auth.uid())
);

-- Organizations: let admins delete orgs
DROP POLICY IF EXISTS "Owners can delete orgs" ON public.organizations;
CREATE POLICY "Owners and admins can delete orgs"
ON public.organizations FOR DELETE TO authenticated
USING (
  has_org_role(auth.uid(), id, 'owner'::app_role)
  OR has_org_role(auth.uid(), id, 'admin'::app_role)
  OR is_superuser(auth.uid())
);

-- Teams: let all org members create teams
DROP POLICY IF EXISTS "Admins can insert teams" ON public.teams;
CREATE POLICY "Org members can insert teams"
ON public.teams FOR INSERT TO authenticated
WITH CHECK (
  is_member_of(auth.uid(), organization_id)
  OR is_superuser(auth.uid())
);
