
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TABLE public.github_repo_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  repo_full_name text NOT NULL,
  webhook_secret text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, repo_full_name)
);
CREATE INDEX idx_github_repo_integrations_repo ON public.github_repo_integrations (lower(repo_full_name));
ALTER TABLE public.github_repo_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read integrations" ON public.github_repo_integrations FOR SELECT TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));
CREATE POLICY "Admins can insert integrations" ON public.github_repo_integrations FOR INSERT TO authenticated
  WITH CHECK (has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR has_org_role(auth.uid(), organization_id, 'admin'::app_role) OR is_superuser(auth.uid()));
CREATE POLICY "Admins can update integrations" ON public.github_repo_integrations FOR UPDATE TO authenticated
  USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR has_org_role(auth.uid(), organization_id, 'admin'::app_role) OR is_superuser(auth.uid()));
CREATE POLICY "Admins can delete integrations" ON public.github_repo_integrations FOR DELETE TO authenticated
  USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR has_org_role(auth.uid(), organization_id, 'admin'::app_role) OR is_superuser(auth.uid()));

CREATE TRIGGER trg_touch_github_repo_integrations
  BEFORE UPDATE ON public.github_repo_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.github_repo_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id uuid NOT NULL REFERENCES public.github_repo_integrations(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  tree_id text NOT NULL,
  backlog_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (integration_id, backlog_id)
);
CREATE INDEX idx_github_repo_targets_integration ON public.github_repo_targets (integration_id);
ALTER TABLE public.github_repo_targets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read targets" ON public.github_repo_targets FOR SELECT TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));
CREATE POLICY "Admins can insert targets" ON public.github_repo_targets FOR INSERT TO authenticated
  WITH CHECK (has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR has_org_role(auth.uid(), organization_id, 'admin'::app_role) OR is_superuser(auth.uid()));
CREATE POLICY "Admins can delete targets" ON public.github_repo_targets FOR DELETE TO authenticated
  USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role) OR has_org_role(auth.uid(), organization_id, 'admin'::app_role) OR is_superuser(auth.uid()));

-- Seed existing Agilefant mapping
INSERT INTO public.github_repo_integrations (organization_id, repo_full_name, webhook_secret, enabled)
SELECT '227ff1d1-36df-4f46-b97e-483ada92ccfb'::uuid, 'jvahanii/agilefant-squared-6b8cedbf', encode(gen_random_bytes(24), 'hex'), true
WHERE NOT EXISTS (
  SELECT 1 FROM public.github_repo_integrations
  WHERE organization_id = '227ff1d1-36df-4f46-b97e-483ada92ccfb'::uuid AND repo_full_name = 'jvahanii/agilefant-squared-6b8cedbf'
);

INSERT INTO public.github_repo_targets (integration_id, organization_id, tree_id, backlog_id)
SELECT i.id, i.organization_id, '227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-a414aa6c', '227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-ef7b2521'
FROM public.github_repo_integrations i
WHERE i.organization_id = '227ff1d1-36df-4f46-b97e-483ada92ccfb'::uuid AND i.repo_full_name = 'jvahanii/agilefant-squared-6b8cedbf'
  AND NOT EXISTS (
    SELECT 1 FROM public.github_repo_targets t WHERE t.integration_id = i.id AND t.backlog_id = '227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-ef7b2521'
  );
