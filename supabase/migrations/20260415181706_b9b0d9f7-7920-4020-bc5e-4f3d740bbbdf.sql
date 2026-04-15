
DROP POLICY "Org members can insert own time entries" ON public.time_entries;

CREATE POLICY "Org members can insert time entries"
  ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (
    is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid())
  );
