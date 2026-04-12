
CREATE TABLE public.work_item_backlog_ranks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_item_id text NOT NULL,
  backlog_id text NOT NULL,
  rank integer NOT NULL DEFAULT 0,
  organization_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, backlog_id)
);

ALTER TABLE public.work_item_backlog_ranks ENABLE ROW LEVEL SECURITY;

ALTER PUBLICATION supabase_realtime ADD TABLE public.work_item_backlog_ranks;
ALTER TABLE public.work_item_backlog_ranks REPLICA IDENTITY FULL;

CREATE POLICY "Org members and shared can read ranks"
  ON public.work_item_backlog_ranks FOR SELECT TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()) OR is_work_item_accessible(auth.uid(), work_item_id));

CREATE POLICY "Org members can insert ranks"
  ON public.work_item_backlog_ranks FOR INSERT TO authenticated
  WITH CHECK (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

CREATE POLICY "Org members and shared can update ranks"
  ON public.work_item_backlog_ranks FOR UPDATE TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()) OR is_work_item_accessible(auth.uid(), work_item_id));

CREATE POLICY "Org members and shared can delete ranks"
  ON public.work_item_backlog_ranks FOR DELETE TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()) OR is_work_item_accessible(auth.uid(), work_item_id));
