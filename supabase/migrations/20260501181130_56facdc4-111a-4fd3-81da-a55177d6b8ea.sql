-- Tighten organization_backups: only owners/admins (or superusers) can INSERT or DELETE.
DROP POLICY IF EXISTS "Org members can delete backups" ON public.organization_backups;
DROP POLICY IF EXISTS "Org members can insert backups" ON public.organization_backups;

CREATE POLICY "Admins can delete backups"
ON public.organization_backups
FOR DELETE
TO authenticated
USING (
  has_org_role(auth.uid(), organization_id, 'owner'::app_role)
  OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  OR is_superuser(auth.uid())
);

CREATE POLICY "Admins can insert backups"
ON public.organization_backups
FOR INSERT
TO authenticated
WITH CHECK (
  has_org_role(auth.uid(), organization_id, 'owner'::app_role)
  OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  OR is_superuser(auth.uid())
);