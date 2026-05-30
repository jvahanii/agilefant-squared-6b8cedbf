ALTER TABLE public.work_item_financials
  ADD COLUMN IF NOT EXISTS actual_savings_by_month jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS actual_income_by_month  jsonb NOT NULL DEFAULT '{}'::jsonb;