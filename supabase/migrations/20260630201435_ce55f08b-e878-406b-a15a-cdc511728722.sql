DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='board_card_ranks') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.board_card_ranks;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='board_columns') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.board_columns;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='boards') THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.boards;
  END IF;
END $$;

DROP TABLE IF EXISTS public.board_card_ranks CASCADE;
DROP TABLE IF EXISTS public.board_columns CASCADE;
DROP TABLE IF EXISTS public.boards CASCADE;

ALTER TABLE public.organization_settings DROP COLUMN IF EXISTS boards_enabled;