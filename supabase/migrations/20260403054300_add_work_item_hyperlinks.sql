-- Add hyperlinks table for work items
-- Each work item can have zero or more hyperlinks with a URL and optional alt text.

CREATE TABLE public.work_item_hyperlinks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id text NOT NULL REFERENCES public.work_items(id) ON DELETE CASCADE,
  url text NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  rank integer NOT NULL DEFAULT 0,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup by work item
CREATE INDEX idx_work_item_hyperlinks_work_item_id ON public.work_item_hyperlinks(work_item_id);

-- Index for org-scoped queries
CREATE INDEX idx_work_item_hyperlinks_organization_id ON public.work_item_hyperlinks(organization_id);

-- Enable RLS
ALTER TABLE public.work_item_hyperlinks ENABLE ROW LEVEL SECURITY;

-- RLS policies: mirror work_items access pattern
CREATE POLICY "Org members can manage hyperlinks"
  ON public.work_item_hyperlinks
  FOR ALL
  TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
  )
  WITH CHECK (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
  );

-- Grant access to users who can see the parent work item via shared trees
CREATE POLICY "Shared tree members can read hyperlinks"
  ON public.work_item_hyperlinks
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.work_items wi
      WHERE wi.id = work_item_id
        AND has_accessible_tree_assignment(auth.uid(), wi.backlog_assignments)
    )
  );
