
-- Time tracking entries for work items and/or backlogs
CREATE TABLE public.time_entries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  work_item_id text,
  backlog_id text,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  spent_date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),

  -- At least one target must be set
  CONSTRAINT time_entry_target_check CHECK (work_item_id IS NOT NULL OR backlog_id IS NOT NULL)
);

-- Indexes for common queries
CREATE INDEX idx_time_entries_org ON public.time_entries (organization_id);
CREATE INDEX idx_time_entries_work_item ON public.time_entries (work_item_id) WHERE work_item_id IS NOT NULL;
CREATE INDEX idx_time_entries_backlog ON public.time_entries (backlog_id) WHERE backlog_id IS NOT NULL;
CREATE INDEX idx_time_entries_user ON public.time_entries (user_id);

-- RLS
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

-- Read: org members + superusers
CREATE POLICY "Org members can read time entries"
  ON public.time_entries FOR SELECT TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

-- Insert: org members + superusers (user_id must match caller)
CREATE POLICY "Org members can insert own time entries"
  ON public.time_entries FOR INSERT TO authenticated
  WITH CHECK (
    (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()))
    AND user_id = auth.uid()
  );

-- Update: own entries OR admin/owner/superuser
CREATE POLICY "Users can update own or admins can update any"
  ON public.time_entries FOR UPDATE TO authenticated
  USING (
    (user_id = auth.uid() AND is_member_of(auth.uid(), organization_id))
    OR has_org_role(auth.uid(), organization_id, 'owner')
    OR has_org_role(auth.uid(), organization_id, 'admin')
    OR is_superuser(auth.uid())
  );

-- Delete: own entries OR admin/owner/superuser
CREATE POLICY "Users can delete own or admins can delete any"
  ON public.time_entries FOR DELETE TO authenticated
  USING (
    (user_id = auth.uid() AND is_member_of(auth.uid(), organization_id))
    OR has_org_role(auth.uid(), organization_id, 'owner')
    OR has_org_role(auth.uid(), organization_id, 'admin')
    OR is_superuser(auth.uid())
  );
