ALTER TABLE public.work_item_financials
  ADD COLUMN IF NOT EXISTS savings_by_month jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS income_by_month  jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill: if a legacy monthly amount exists, seed the current month so users
-- don't lose data. Uses UTC to match the app's month-key convention.
UPDATE public.work_item_financials
SET savings_by_month = jsonb_build_object(to_char((now() at time zone 'utc')::date, 'YYYY-MM'), monthly_savings)
WHERE monthly_savings IS NOT NULL
  AND monthly_savings <> 0
  AND (savings_by_month = '{}'::jsonb OR savings_by_month IS NULL);

UPDATE public.work_item_financials
SET income_by_month = jsonb_build_object(to_char((now() at time zone 'utc')::date, 'YYYY-MM'), monthly_income)
WHERE monthly_income IS NOT NULL
  AND monthly_income <> 0
  AND (income_by_month = '{}'::jsonb OR income_by_month IS NULL);