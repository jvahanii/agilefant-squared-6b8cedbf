CREATE TABLE public.board_columns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  backlog_id text NOT NULL REFERENCES public.backlogs(id) ON DELETE CASCADE,
  status_key text NOT NULL,
  label text NOT NULL,
  rank double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX board_columns_backlog_id_idx ON public.board_columns(backlog_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_columns TO authenticated;
GRANT ALL ON public.board_columns TO service_role;

ALTER TABLE public.board_columns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members and shared can read board_columns" ON public.board_columns
FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.backlogs b
  WHERE b.id = board_columns.backlog_id
    AND (is_member_of(auth.uid(), b.organization_id) OR is_superuser(auth.uid()) OR is_tree_accessible(auth.uid(), b.tree_id))
));

CREATE POLICY "Members and shared can insert board_columns" ON public.board_columns
FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.backlogs b
  WHERE b.id = board_columns.backlog_id
    AND (is_member_of(auth.uid(), b.organization_id) OR is_superuser(auth.uid()) OR is_tree_accessible(auth.uid(), b.tree_id))
));

CREATE POLICY "Members and shared can update board_columns" ON public.board_columns
FOR UPDATE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.backlogs b
  WHERE b.id = board_columns.backlog_id
    AND (is_member_of(auth.uid(), b.organization_id) OR is_superuser(auth.uid()) OR is_tree_accessible(auth.uid(), b.tree_id))
));

CREATE POLICY "Members and shared can delete board_columns" ON public.board_columns
FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.backlogs b
  WHERE b.id = board_columns.backlog_id
    AND (is_member_of(auth.uid(), b.organization_id) OR is_superuser(auth.uid()) OR is_tree_accessible(auth.uid(), b.tree_id))
));

CREATE TRIGGER update_board_columns_updated_at
BEFORE UPDATE ON public.board_columns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.board_columns;
ALTER TABLE public.board_columns REPLICA IDENTITY FULL;