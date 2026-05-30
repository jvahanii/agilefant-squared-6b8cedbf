
CREATE TABLE public.tree_financial_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id text NOT NULL REFERENCES public.backlog_trees(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  year integer NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  metric text NOT NULL DEFAULT 'savings',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tree_id, year, metric)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tree_financial_targets TO authenticated;
GRANT ALL ON public.tree_financial_targets TO service_role;

ALTER TABLE public.tree_financial_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tree members can view targets"
  ON public.tree_financial_targets FOR SELECT
  TO authenticated
  USING (public.is_tree_accessible(auth.uid(), tree_id));

CREATE POLICY "Tree admins can insert targets"
  ON public.tree_financial_targets FOR INSERT
  TO authenticated
  WITH CHECK (public.is_tree_accessible(auth.uid(), tree_id) AND public.is_member_of(auth.uid(), organization_id));

CREATE POLICY "Tree admins can update targets"
  ON public.tree_financial_targets FOR UPDATE
  TO authenticated
  USING (public.is_tree_accessible(auth.uid(), tree_id))
  WITH CHECK (public.is_tree_accessible(auth.uid(), tree_id));

CREATE POLICY "Tree admins can delete targets"
  ON public.tree_financial_targets FOR DELETE
  TO authenticated
  USING (public.is_tree_accessible(auth.uid(), tree_id));

CREATE TRIGGER trg_tree_financial_targets_updated_at
  BEFORE UPDATE ON public.tree_financial_targets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.tree_financial_targets;
