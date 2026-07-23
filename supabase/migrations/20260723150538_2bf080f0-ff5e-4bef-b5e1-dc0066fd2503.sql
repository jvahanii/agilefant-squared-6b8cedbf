
-- 1. Labs toggle column
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS burnups_enabled boolean NOT NULL DEFAULT false;

-- 2. work_item_history table
CREATE TABLE IF NOT EXISTS public.work_item_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_item_id text NOT NULL,
  organization_id uuid NOT NULL,
  event text NOT NULL,           -- 'insert' | 'update' | 'delete'
  existed boolean NOT NULL,      -- false only for 'delete' rows
  title text,
  status text,
  points integer,
  parent_id text,
  backlog_assignments jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS work_item_history_org_time_idx
  ON public.work_item_history (organization_id, snapshot_at);
CREATE INDEX IF NOT EXISTS work_item_history_item_time_idx
  ON public.work_item_history (work_item_id, snapshot_at);

GRANT SELECT ON public.work_item_history TO authenticated;
GRANT ALL ON public.work_item_history TO service_role;

ALTER TABLE public.work_item_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view work item history"
  ON public.work_item_history FOR SELECT
  TO authenticated
  USING (
    public.is_member_of(auth.uid(), organization_id)
    OR public.is_superuser(auth.uid())
  );

-- Trigger function that snapshots work_items changes
CREATE OR REPLACE FUNCTION public.snapshot_work_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _event text;
  _src   record;
  _existed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _event := 'insert'; _existed := true;  _src := NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    _event := 'update'; _existed := true;  _src := NEW;
  ELSE
    _event := 'delete'; _existed := false; _src := OLD;
  END IF;

  INSERT INTO public.work_item_history
    (work_item_id, organization_id, event, existed, title, status, points, parent_id, backlog_assignments)
  VALUES
    (_src.id, _src.organization_id, _event, _existed, _src.title, _src.status, _src.points, _src.parent_id,
     COALESCE(_src.backlog_assignments, '{}'::jsonb));

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_items_snapshot ON public.work_items;
CREATE TRIGGER trg_work_items_snapshot
AFTER INSERT OR UPDATE OR DELETE ON public.work_items
FOR EACH ROW EXECUTE FUNCTION public.snapshot_work_item_change();

-- 3. chart preferences
CREATE TABLE IF NOT EXISTS public.work_item_chart_prefs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  scope_kind text NOT NULL,   -- 'tree' | 'backlog' | 'work_item'
  scope_id text NOT NULL,
  metric text NOT NULL,       -- 'count' | 'points'
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope_kind, scope_id)
);

CREATE INDEX IF NOT EXISTS work_item_chart_prefs_user_idx
  ON public.work_item_chart_prefs (user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_chart_prefs TO authenticated;
GRANT ALL ON public.work_item_chart_prefs TO service_role;

ALTER TABLE public.work_item_chart_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own chart prefs"
  ON public.work_item_chart_prefs FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE TRIGGER trg_chart_prefs_updated_at
BEFORE UPDATE ON public.work_item_chart_prefs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Enable realtime for history so charts update live
ALTER PUBLICATION supabase_realtime ADD TABLE public.work_item_history;
