
-- 1) Org-wide toggle
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS custom_statuses_enabled boolean NOT NULL DEFAULT false;

-- 2) Per-tree status definitions
CREATE TABLE IF NOT EXISTS public.tree_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id text NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  color text NOT NULL DEFAULT '#94a3b8',
  rank integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tree_id, key)
);

CREATE INDEX IF NOT EXISTS idx_tree_statuses_tree ON public.tree_statuses(tree_id);

ALTER TABLE public.tree_statuses ENABLE ROW LEVEL SECURITY;

-- RLS: anyone with tree access can read/write (per user request)
CREATE POLICY "Tree-accessible users can read tree statuses"
ON public.tree_statuses FOR SELECT TO authenticated
USING (public.is_tree_accessible(auth.uid(), tree_id));

CREATE POLICY "Tree-accessible users can insert tree statuses"
ON public.tree_statuses FOR INSERT TO authenticated
WITH CHECK (public.is_tree_accessible(auth.uid(), tree_id));

CREATE POLICY "Tree-accessible users can update tree statuses"
ON public.tree_statuses FOR UPDATE TO authenticated
USING (public.is_tree_accessible(auth.uid(), tree_id));

CREATE POLICY "Tree-accessible users can delete tree statuses"
ON public.tree_statuses FOR DELETE TO authenticated
USING (public.is_tree_accessible(auth.uid(), tree_id));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_tree_statuses_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_tree_statuses_touch ON public.tree_statuses;
CREATE TRIGGER trg_tree_statuses_touch
  BEFORE UPDATE ON public.tree_statuses
  FOR EACH ROW EXECUTE FUNCTION public.touch_tree_statuses_updated_at();

-- Realtime
ALTER TABLE public.tree_statuses REPLICA IDENTITY FULL;
DO $$ BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.tree_statuses';
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3) Seed defaults for new trees
CREATE OR REPLACE FUNCTION public.seed_default_tree_statuses()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tree_statuses (tree_id, key, label, color, rank) VALUES
    (NEW.id, 'not_started', 'Not Started', '#94a3b8', 0),
    (NEW.id, 'in_progress', 'In Progress', '#3b82f6', 1),
    (NEW.id, 'pending',     'Pending',     '#f59e0b', 2),
    (NEW.id, 'blocked',     'Blocked',     '#ef4444', 3),
    (NEW.id, 'done',        'Done',        '#22c55e', 4)
  ON CONFLICT (tree_id, key) DO NOTHING;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_seed_tree_statuses ON public.backlog_trees;
CREATE TRIGGER trg_seed_tree_statuses
  AFTER INSERT ON public.backlog_trees
  FOR EACH ROW EXECUTE FUNCTION public.seed_default_tree_statuses();

-- 4) Backfill defaults for existing trees
INSERT INTO public.tree_statuses (tree_id, key, label, color, rank)
SELECT bt.id, v.key, v.label, v.color, v.rank
FROM public.backlog_trees bt
CROSS JOIN (VALUES
  ('not_started','Not Started','#94a3b8',0),
  ('in_progress','In Progress','#3b82f6',1),
  ('pending',    'Pending',    '#f59e0b',2),
  ('blocked',    'Blocked',    '#ef4444',3),
  ('done',       'Done',       '#22c55e',4)
) AS v(key,label,color,rank)
ON CONFLICT (tree_id, key) DO NOTHING;
