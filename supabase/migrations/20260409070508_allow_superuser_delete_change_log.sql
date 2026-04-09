
-- Allow superusers to delete change_log entries so that org deletion can clean up
-- audit log rows that would otherwise be left orphaned (change_log.organization_id
-- has no FK cascade to organizations).
CREATE POLICY "Superusers can delete change log"
ON public.change_log FOR DELETE TO authenticated
USING (is_superuser(auth.uid()));
