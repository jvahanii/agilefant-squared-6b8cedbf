CREATE TABLE public.whatsapp_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  label text NOT NULL DEFAULT 'WhatsApp',
  tree_id text NOT NULL,
  backlog_id text NOT NULL,
  chat_id text,
  webhook_secret text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.whatsapp_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read whatsapp integrations"
ON public.whatsapp_integrations FOR SELECT TO authenticated
USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
    OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
    OR is_superuser(auth.uid()));

CREATE POLICY "Admins can insert whatsapp integrations"
ON public.whatsapp_integrations FOR INSERT TO authenticated
WITH CHECK (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
    OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
    OR is_superuser(auth.uid()));

CREATE POLICY "Admins can update whatsapp integrations"
ON public.whatsapp_integrations FOR UPDATE TO authenticated
USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
    OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
    OR is_superuser(auth.uid()));

CREATE POLICY "Admins can delete whatsapp integrations"
ON public.whatsapp_integrations FOR DELETE TO authenticated
USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
    OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
    OR is_superuser(auth.uid()));

CREATE TRIGGER touch_whatsapp_integrations_updated_at
BEFORE UPDATE ON public.whatsapp_integrations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX whatsapp_integrations_org_idx ON public.whatsapp_integrations(organization_id);