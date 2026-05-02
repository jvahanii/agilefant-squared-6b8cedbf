-- 1) Restrict organization_backups SELECT to owners/admins/superusers
DROP POLICY IF EXISTS "Org members can read backups" ON public.organization_backups;

CREATE POLICY "Admins can read backups"
ON public.organization_backups
FOR SELECT
TO authenticated
USING (
  has_org_role(auth.uid(), organization_id, 'owner'::app_role)
  OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  OR is_superuser(auth.uid())
);

-- 2) Realtime: allow suffixed org topics (org-{orgId}-%) in addition to exact match
DROP POLICY IF EXISTS "Org members can read org messages" ON realtime.messages;

CREATE POLICY "Org members can read org messages"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND (
        (SELECT realtime.topic()) = ('org-' || m.organization_id::text)
        OR (SELECT realtime.topic()) LIKE ('org-' || m.organization_id::text || '-%')
      )
  )
);