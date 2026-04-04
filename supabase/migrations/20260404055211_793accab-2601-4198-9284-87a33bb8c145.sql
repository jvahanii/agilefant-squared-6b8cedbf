
-- Set REPLICA IDENTITY FULL on all realtime-subscribed tables
ALTER TABLE public.work_items REPLICA IDENTITY FULL;
ALTER TABLE public.backlogs REPLICA IDENTITY FULL;
ALTER TABLE public.backlog_trees REPLICA IDENTITY FULL;
ALTER TABLE public.work_item_hyperlinks REPLICA IDENTITY FULL;
ALTER TABLE public.backlog_tree_shares REPLICA IDENTITY FULL;

-- Idempotently add tables to supabase_realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'work_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.work_items;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'backlogs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.backlogs;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'backlog_trees'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.backlog_trees;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'work_item_hyperlinks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.work_item_hyperlinks;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'backlog_tree_shares'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.backlog_tree_shares;
  END IF;
END $$;
