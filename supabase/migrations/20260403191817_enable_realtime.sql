-- Enable REPLICA IDENTITY FULL so that DELETE events carry the full old row,
-- allowing the client-side applyRealtime* handlers to identify which record
-- was removed.
ALTER TABLE public.work_items REPLICA IDENTITY FULL;
ALTER TABLE public.backlogs REPLICA IDENTITY FULL;
ALTER TABLE public.backlog_trees REPLICA IDENTITY FULL;
ALTER TABLE public.backlog_tree_shares REPLICA IDENTITY FULL;

-- Add the tables to the Supabase Realtime publication so that row-level
-- change events are broadcast to subscribed clients.
ALTER PUBLICATION supabase_realtime ADD TABLE public.work_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.backlogs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.backlog_trees;
ALTER PUBLICATION supabase_realtime ADD TABLE public.backlog_tree_shares;
