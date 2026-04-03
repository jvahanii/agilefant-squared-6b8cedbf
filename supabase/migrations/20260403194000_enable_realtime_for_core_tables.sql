-- Enable Supabase Realtime for core tables.
--
-- For postgres_changes subscriptions to fire, every table that the client
-- subscribes to must be a member of the supabase_realtime publication.
-- work_items, backlogs, and backlog_trees were never added to the publication,
-- so no real-time events were delivered for those tables.
--
-- REPLICA IDENTITY FULL is required so that DELETE events include all column
-- values in the old-record payload.  Without it, filtered subscriptions
-- (e.g. organization_id=eq.<uuid>) cannot match DELETE events because the
-- filter column is absent from the payload.

ALTER TABLE public.work_items REPLICA IDENTITY FULL;
ALTER TABLE public.backlogs REPLICA IDENTITY FULL;
ALTER TABLE public.backlog_trees REPLICA IDENTITY FULL;
ALTER TABLE public.work_item_hyperlinks REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.work_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.backlogs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.backlog_trees;
