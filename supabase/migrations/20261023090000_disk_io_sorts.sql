-- Less Disk IO: two reads made every time the app opens stop sorting on disk.
--
-- Supabase warned (2026-10-23) that the project was depleting its Disk IO
-- budget. Nearly all of it was temporary files — 487 MB in three days, against
-- 63 MB of WAL — from sorts too big for the 2 MB of work_mem, made by:
--
-- 1. The paged load of work items (ORDER BY id, LIMIT 1000 OFFSET n). Signed
--    in, with RLS checked row by row, the planner read all of an
--    organization's items by organization_id and sorted them on every page;
--    from the fourth page on the sort no longer fitted in memory. With an
--    index on (organization_id, id) the rows come in id order and the read
--    stops when the page is full: no sort at all.

CREATE INDEX IF NOT EXISTS idx_work_items_org_id ON public.work_items (organization_id, id);

-- 2. get_work_item_ranks, which wrote some 2 MB to disk on each call building
--    its maps of ranks. Given 16 MB of work_mem for itself — one call per app
--    load, so the rest of the database's memory is unchanged — it wrote 90%
--    less in a test.

ALTER FUNCTION public.get_work_item_ranks(uuid[]) SET work_mem = '16MB';
