
-- Create work_item_backlog_ranks table to store per-backlog ranks for work items.
-- This replaces the single global `rank` column on work_items with per-backlog
-- granularity, enabling a work item to have independent orderings in each backlog
-- it is assigned to.

CREATE TABLE public.work_item_backlog_ranks (
  work_item_id  text    NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  backlog_id    text    NOT NULL,
  rank          integer NOT NULL DEFAULT 0,
  organization_id uuid  NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  PRIMARY KEY (work_item_id, backlog_id)
);

-- Index to support fast per-org deletes (used during org reset / data cleanup).
CREATE INDEX idx_work_item_backlog_ranks_org ON public.work_item_backlog_ranks (organization_id);

-- Enable Row Level Security.
ALTER TABLE public.work_item_backlog_ranks ENABLE ROW LEVEL SECURITY;

-- Org members (and superusers) can read ranks for their own work items.
CREATE POLICY "Org members can read work item backlog ranks"
  ON public.work_item_backlog_ranks FOR SELECT TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

-- Org members can insert ranks.
CREATE POLICY "Org members can insert work item backlog ranks"
  ON public.work_item_backlog_ranks FOR INSERT TO authenticated
  WITH CHECK (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

-- Org members can update ranks.
CREATE POLICY "Org members can update work item backlog ranks"
  ON public.work_item_backlog_ranks FOR UPDATE TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

-- Org members can delete ranks.
CREATE POLICY "Org members can delete work item backlog ranks"
  ON public.work_item_backlog_ranks FOR DELETE TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

-- Enable realtime so clients receive live rank updates.
ALTER PUBLICATION supabase_realtime ADD TABLE public.work_item_backlog_ranks;
