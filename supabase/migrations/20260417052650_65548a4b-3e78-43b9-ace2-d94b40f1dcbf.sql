-- Labels catalog (per-organization)
CREATE TABLE public.labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#94a3b8',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX idx_labels_org ON public.labels(organization_id);

ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;

-- Helper: can the user see labels of a given org? Either a member, superuser,
-- or shares any tree with that org (needed so partner orgs can render labels
-- attached to items in shared trees).
CREATE OR REPLACE FUNCTION public.can_view_org_labels(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT is_member_of(_user_id, _org_id)
    OR is_superuser(_user_id)
    OR has_shared_tree_with_org(_user_id, _org_id)
$$;

CREATE POLICY "Members and shared-org users can read labels"
ON public.labels FOR SELECT TO authenticated
USING (can_view_org_labels(auth.uid(), organization_id));

CREATE POLICY "Org members can insert labels"
ON public.labels FOR INSERT TO authenticated
WITH CHECK (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

CREATE POLICY "Org members can update labels"
ON public.labels FOR UPDATE TO authenticated
USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

CREATE POLICY "Org members can delete labels"
ON public.labels FOR DELETE TO authenticated
USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

-- Touch updated_at
CREATE OR REPLACE FUNCTION public.touch_labels_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
CREATE TRIGGER trg_labels_updated_at
BEFORE UPDATE ON public.labels
FOR EACH ROW EXECUTE FUNCTION public.touch_labels_updated_at();

-- Polymorphic assignments to work_items or backlogs
CREATE TABLE public.label_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_id uuid NOT NULL REFERENCES public.labels(id) ON DELETE CASCADE,
  entity_type text NOT NULL CHECK (entity_type IN ('work_item','backlog')),
  entity_id text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (label_id, entity_type, entity_id)
);

CREATE INDEX idx_label_assignments_label ON public.label_assignments(label_id);
CREATE INDEX idx_label_assignments_entity ON public.label_assignments(entity_type, entity_id);
CREATE INDEX idx_label_assignments_org ON public.label_assignments(organization_id);

ALTER TABLE public.label_assignments ENABLE ROW LEVEL SECURITY;

-- Helper: can user access the entity referenced by an assignment?
CREATE OR REPLACE FUNCTION public.is_label_entity_accessible(_user_id uuid, _entity_type text, _entity_id text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT CASE
    WHEN _entity_type = 'work_item' THEN is_work_item_accessible(_user_id, _entity_id)
    WHEN _entity_type = 'backlog' THEN EXISTS (
      SELECT 1 FROM backlogs b
      WHERE b.id = _entity_id
        AND (
          is_member_of(_user_id, b.organization_id)
          OR is_superuser(_user_id)
          OR is_tree_accessible(_user_id, b.tree_id)
        )
    )
    ELSE false
  END
$$;

CREATE POLICY "Members and shared can read assignments"
ON public.label_assignments FOR SELECT TO authenticated
USING (
  is_member_of(auth.uid(), organization_id)
  OR is_superuser(auth.uid())
  OR is_label_entity_accessible(auth.uid(), entity_type, entity_id)
);

CREATE POLICY "Members and shared can insert assignments"
ON public.label_assignments FOR INSERT TO authenticated
WITH CHECK (
  is_member_of(auth.uid(), organization_id)
  OR is_superuser(auth.uid())
  OR is_label_entity_accessible(auth.uid(), entity_type, entity_id)
);

CREATE POLICY "Members and shared can delete assignments"
ON public.label_assignments FOR DELETE TO authenticated
USING (
  is_member_of(auth.uid(), organization_id)
  OR is_superuser(auth.uid())
  OR is_label_entity_accessible(auth.uid(), entity_type, entity_id)
);

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.labels;
ALTER PUBLICATION supabase_realtime ADD TABLE public.label_assignments;
ALTER TABLE public.labels REPLICA IDENTITY FULL;
ALTER TABLE public.label_assignments REPLICA IDENTITY FULL;