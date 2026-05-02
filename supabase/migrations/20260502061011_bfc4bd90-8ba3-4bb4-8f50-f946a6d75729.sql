
-- 1) Realtime: only allow exact-match topic 'org-{organization_id}'.
-- The previous LIKE 'org-{id}-%' suffix permitted topic-spoofing where another
-- org's id is a suffix of the legitimate one. Use exact match only; if
-- sub-channels are ever needed, encode them inside the message payload.
DROP POLICY IF EXISTS "Authenticated users can listen to their org channels" ON realtime.messages;

CREATE POLICY "Authenticated users can listen to their org channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND (SELECT realtime.topic()) = ('org-' || m.organization_id::text)
  )
  OR public.is_superuser(auth.uid())
);

-- 2) organization_backups: explicit UPDATE policy restricted to admins/owners/superusers.
CREATE POLICY "Admins can update backups"
ON public.organization_backups
FOR UPDATE
TO authenticated
USING (
  has_org_role(auth.uid(), organization_id, 'owner'::app_role)
  OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  OR is_superuser(auth.uid())
)
WITH CHECK (
  has_org_role(auth.uid(), organization_id, 'owner'::app_role)
  OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
  OR is_superuser(auth.uid())
);

-- 3) label_assignments: explicit UPDATE policy mirroring INSERT/DELETE.
CREATE POLICY "Members and shared can update assignments"
ON public.label_assignments
FOR UPDATE
TO authenticated
USING (
  is_member_of(auth.uid(), organization_id)
  OR is_superuser(auth.uid())
  OR is_label_entity_accessible(auth.uid(), entity_type, entity_id)
)
WITH CHECK (
  is_member_of(auth.uid(), organization_id)
  OR is_superuser(auth.uid())
  OR is_label_entity_accessible(auth.uid(), entity_type, entity_id)
);
