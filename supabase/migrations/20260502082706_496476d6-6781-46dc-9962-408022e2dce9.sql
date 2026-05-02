DROP POLICY IF EXISTS "Org members can insert change log" ON public.change_log;

CREATE POLICY "Org members can insert change log"
ON public.change_log
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()))
);