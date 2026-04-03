-- Reverse migration: remove work_item_hyperlinks table
-- Run this to undo the 20260403054300_add_work_item_hyperlinks migration.

DROP POLICY IF EXISTS "Shared tree members can read hyperlinks" ON public.work_item_hyperlinks;
DROP POLICY IF EXISTS "Org members can manage hyperlinks" ON public.work_item_hyperlinks;
DROP INDEX IF EXISTS idx_work_item_hyperlinks_organization_id;
DROP INDEX IF EXISTS idx_work_item_hyperlinks_work_item_id;
DROP TABLE IF EXISTS public.work_item_hyperlinks;
