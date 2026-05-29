
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS savings_income_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.work_item_financials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  work_item_id text NOT NULL UNIQUE,
  monthly_savings numeric(14,2) NOT NULL DEFAULT 0,
  monthly_income numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'EUR',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_item_financials TO authenticated;
GRANT ALL ON public.work_item_financials TO service_role;

ALTER TABLE public.work_item_financials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members and shared can read financials"
  ON public.work_item_financials FOR SELECT TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()) OR is_work_item_accessible(auth.uid(), work_item_id));

CREATE POLICY "Org members and shared can insert financials"
  ON public.work_item_financials FOR INSERT TO authenticated
  WITH CHECK (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()) OR is_work_item_accessible(auth.uid(), work_item_id));

CREATE POLICY "Org members and shared can update financials"
  ON public.work_item_financials FOR UPDATE TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()) OR is_work_item_accessible(auth.uid(), work_item_id));

CREATE POLICY "Org members and shared can delete financials"
  ON public.work_item_financials FOR DELETE TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()) OR is_work_item_accessible(auth.uid(), work_item_id));

CREATE INDEX IF NOT EXISTS idx_work_item_financials_org ON public.work_item_financials(organization_id);

ALTER PUBLICATION supabase_realtime ADD TABLE public.work_item_financials;
