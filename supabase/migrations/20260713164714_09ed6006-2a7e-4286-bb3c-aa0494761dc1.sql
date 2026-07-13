
CREATE TABLE public.work_item_board_ranks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  work_item_id text NOT NULL,
  backlog_id text NOT NULL,
  rank integer NOT NULL DEFAULT 0,
  organization_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, backlog_id)
);

CREATE INDEX work_item_board_ranks_backlog_idx ON public.work_item_board_ranks(backlog_id);
CREATE INDEX work_item_board_ranks_org_idx ON public.work_item_board_ranks(organization_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_board_ranks TO authenticated;
GRANT ALL ON public.work_item_board_ranks TO service_role;

ALTER TABLE public.work_item_board_ranks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members and shared can read board ranks"
  ON public.work_item_board_ranks FOR SELECT
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()) OR is_work_item_accessible(auth.uid(), work_item_id));

CREATE POLICY "Org members can insert board ranks"
  ON public.work_item_board_ranks FOR INSERT
  WITH CHECK (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

CREATE POLICY "Org members and shared can update board ranks"
  ON public.work_item_board_ranks FOR UPDATE
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()) OR is_work_item_accessible(auth.uid(), work_item_id));

CREATE POLICY "Org members and shared can delete board ranks"
  ON public.work_item_board_ranks FOR DELETE
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()) OR is_work_item_accessible(auth.uid(), work_item_id));

ALTER PUBLICATION supabase_realtime ADD TABLE public.work_item_board_ranks;

INSERT INTO public.work_item_board_ranks (work_item_id, backlog_id, organization_id, rank)
SELECT
  r.work_item_id,
  r.backlog_id,
  r.organization_id,
  (ROW_NUMBER() OVER (
     PARTITION BY r.backlog_id, wi.status
     ORDER BY r.rank, r.work_item_id
   ))::int - 1
FROM public.work_item_backlog_ranks r
JOIN public.work_items wi ON wi.id = r.work_item_id
ON CONFLICT (work_item_id, backlog_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.build_organization_snapshot(_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid;
BEGIN
  _caller := auth.uid();
  IF _caller IS NOT NULL AND NOT (
    is_member_of(_caller, _org_id) OR is_superuser(_caller)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN jsonb_build_object(
    'version', 3,
    'generated_at', now(),
    'organization_id', _org_id,
    'backlog_trees', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM backlog_trees t WHERE t.organization_id = _org_id), '[]'::jsonb),
    'backlogs', COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM backlogs b WHERE b.organization_id = _org_id), '[]'::jsonb),
    'work_items', COALESCE((SELECT jsonb_agg(to_jsonb(w)) FROM work_items w WHERE w.organization_id = _org_id), '[]'::jsonb),
    'work_item_backlog_ranks', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM work_item_backlog_ranks r WHERE r.organization_id = _org_id), '[]'::jsonb),
    'work_item_board_ranks', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM work_item_board_ranks r WHERE r.organization_id = _org_id), '[]'::jsonb),
    'work_item_hyperlinks', COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM work_item_hyperlinks h WHERE h.organization_id = _org_id), '[]'::jsonb),
    'work_item_team_assignments', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM work_item_team_assignments a WHERE a.organization_id = _org_id), '[]'::jsonb),
    'labels', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM labels l WHERE l.organization_id = _org_id), '[]'::jsonb),
    'label_assignments', COALESCE((SELECT jsonb_agg(to_jsonb(la)) FROM label_assignments la WHERE la.organization_id = _org_id), '[]'::jsonb),
    'backlog_statuses', COALESCE((
      SELECT jsonb_agg(to_jsonb(bs))
      FROM backlog_statuses bs
      JOIN backlogs b ON b.id = bs.backlog_id
      WHERE b.organization_id = _org_id
    ), '[]'::jsonb)
  );
END;
$function$;
