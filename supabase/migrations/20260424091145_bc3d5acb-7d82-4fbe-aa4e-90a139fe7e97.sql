-- Fix work_item_backlog_ranks INSERT policy to allow shared-tree users to insert
-- rank rows for work items they have access to (e.g. when moving an item in a
-- shared backlog that also resides in a non-shared backlog owned by another org).
-- The UPDATE and DELETE policies already include is_work_item_accessible; the
-- INSERT policy was missing that check, causing an RLS violation when the active
-- user's org differs from the item's owner org.
DROP POLICY "Org members can insert ranks" ON public.work_item_backlog_ranks;
CREATE POLICY "Org members and shared can insert ranks"
  ON public.work_item_backlog_ranks FOR INSERT TO authenticated
  WITH CHECK (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
    OR is_work_item_accessible(auth.uid(), work_item_id)
  );
