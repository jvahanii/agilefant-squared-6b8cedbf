
-- Fix backlogs INSERT policy
DROP POLICY "Org members and shared can insert" ON public.backlogs;
CREATE POLICY "Org members and shared can insert" ON public.backlogs
FOR INSERT TO authenticated
WITH CHECK (
  is_member_of(auth.uid(), organization_id)
  OR is_superuser(auth.uid())
);

-- Fix work_items INSERT policy
DROP POLICY "Org members and shared can insert" ON public.work_items;
CREATE POLICY "Org members and shared can insert" ON public.work_items
FOR INSERT TO authenticated
WITH CHECK (
  is_member_of(auth.uid(), organization_id)
  OR is_superuser(auth.uid())
);
