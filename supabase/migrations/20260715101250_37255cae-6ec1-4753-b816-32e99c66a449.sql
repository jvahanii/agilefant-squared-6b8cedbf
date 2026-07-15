
ALTER TABLE public.time_entries ADD COLUMN tree_id text NULL REFERENCES public.backlog_trees(id) ON DELETE CASCADE;

ALTER TABLE public.time_entries DROP CONSTRAINT IF EXISTS time_entry_target_check;
ALTER TABLE public.time_entries ADD CONSTRAINT time_entry_target_check
  CHECK (work_item_id IS NOT NULL OR backlog_id IS NOT NULL OR tree_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS time_entries_tree_id_idx ON public.time_entries(tree_id);
