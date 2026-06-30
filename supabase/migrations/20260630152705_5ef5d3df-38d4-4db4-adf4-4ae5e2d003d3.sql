
-- 1) Add boards_enabled flag to organization_settings
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS boards_enabled boolean NOT NULL DEFAULT false;

-- 2) Boards table
CREATE TABLE IF NOT EXISTS public.boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('tree','custom')),
  tree_id text NULL,
  filter_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  rank integer NOT NULL DEFAULT 0,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.boards TO authenticated;
GRANT ALL ON public.boards TO service_role;
ALTER TABLE public.boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "boards_select_member_or_shared"
  ON public.boards FOR SELECT TO authenticated
  USING (
    public.is_member_of(auth.uid(), organization_id)
    OR public.is_superuser(auth.uid())
    OR (scope = 'tree' AND tree_id IS NOT NULL AND public.is_tree_accessible(auth.uid(), tree_id))
  );
CREATE POLICY "boards_insert_member"
  ON public.boards FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of(auth.uid(), organization_id));
CREATE POLICY "boards_update_member"
  ON public.boards FOR UPDATE TO authenticated
  USING (public.is_member_of(auth.uid(), organization_id))
  WITH CHECK (public.is_member_of(auth.uid(), organization_id));
CREATE POLICY "boards_delete_member"
  ON public.boards FOR DELETE TO authenticated
  USING (public.is_member_of(auth.uid(), organization_id));

CREATE INDEX IF NOT EXISTS boards_org_idx ON public.boards(organization_id);
CREATE INDEX IF NOT EXISTS boards_tree_idx ON public.boards(tree_id) WHERE tree_id IS NOT NULL;

CREATE TRIGGER trg_boards_updated_at
  BEFORE UPDATE ON public.boards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3) board_columns
CREATE TABLE IF NOT EXISTS public.board_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#94a3b8',
  rank integer NOT NULL DEFAULT 0,
  rule_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_unmatched boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_columns TO authenticated;
GRANT ALL ON public.board_columns TO service_role;
ALTER TABLE public.board_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "board_columns_select_via_board"
  ON public.board_columns FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_columns.board_id
        AND (
          public.is_member_of(auth.uid(), b.organization_id)
          OR public.is_superuser(auth.uid())
          OR (b.scope = 'tree' AND b.tree_id IS NOT NULL AND public.is_tree_accessible(auth.uid(), b.tree_id))
        )
    )
  );
CREATE POLICY "board_columns_write_member"
  ON public.board_columns FOR ALL TO authenticated
  USING (public.is_member_of(auth.uid(), organization_id))
  WITH CHECK (public.is_member_of(auth.uid(), organization_id));

CREATE INDEX IF NOT EXISTS board_columns_board_idx ON public.board_columns(board_id);

CREATE TRIGGER trg_board_columns_updated_at
  BEFORE UPDATE ON public.board_columns
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) board_card_ranks
CREATE TABLE IF NOT EXISTS public.board_card_ranks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES public.boards(id) ON DELETE CASCADE,
  column_id uuid NOT NULL REFERENCES public.board_columns(id) ON DELETE CASCADE,
  work_item_id text NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  rank integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (board_id, column_id, work_item_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_card_ranks TO authenticated;
GRANT ALL ON public.board_card_ranks TO service_role;
ALTER TABLE public.board_card_ranks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "board_card_ranks_select_via_board"
  ON public.board_card_ranks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.boards b
      WHERE b.id = board_card_ranks.board_id
        AND (
          public.is_member_of(auth.uid(), b.organization_id)
          OR public.is_superuser(auth.uid())
          OR (b.scope = 'tree' AND b.tree_id IS NOT NULL AND public.is_tree_accessible(auth.uid(), b.tree_id))
        )
    )
  );
CREATE POLICY "board_card_ranks_write_member"
  ON public.board_card_ranks FOR ALL TO authenticated
  USING (public.is_member_of(auth.uid(), organization_id))
  WITH CHECK (public.is_member_of(auth.uid(), organization_id));

CREATE INDEX IF NOT EXISTS board_card_ranks_board_col_idx ON public.board_card_ranks(board_id, column_id);
CREATE INDEX IF NOT EXISTS board_card_ranks_wi_idx ON public.board_card_ranks(work_item_id);

CREATE TRIGGER trg_board_card_ranks_updated_at
  BEFORE UPDATE ON public.board_card_ranks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5) Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.boards;
ALTER PUBLICATION supabase_realtime ADD TABLE public.board_columns;
ALTER PUBLICATION supabase_realtime ADD TABLE public.board_card_ranks;
