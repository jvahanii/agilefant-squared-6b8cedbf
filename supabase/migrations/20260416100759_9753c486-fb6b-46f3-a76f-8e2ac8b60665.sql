
CREATE TABLE public.organization_settings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL UNIQUE,
  time_logging_enabled boolean NOT NULL DEFAULT false,
  points_enabled boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read settings"
  ON public.organization_settings FOR SELECT
  TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

CREATE POLICY "Admins can insert settings"
  ON public.organization_settings FOR INSERT
  TO authenticated
  WITH CHECK (
    has_org_role(auth.uid(), organization_id, 'owner') OR
    has_org_role(auth.uid(), organization_id, 'admin') OR
    is_superuser(auth.uid())
  );

CREATE POLICY "Admins can update settings"
  ON public.organization_settings FOR UPDATE
  TO authenticated
  USING (
    has_org_role(auth.uid(), organization_id, 'owner') OR
    has_org_role(auth.uid(), organization_id, 'admin') OR
    is_superuser(auth.uid())
  );
