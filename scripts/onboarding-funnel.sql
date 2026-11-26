-- The steps into Agilefant, week by week (Monday to Sunday, Helsinki time).
-- Run it through the Management API or psql; it only reads.
--
-- Signed-out steps (onboarding_steps, from 2026-11-26): browsers that opened
-- a public list, the try-out, sign-in, sign-up; each counted once per browser.
-- Then, for the accounts made that week (superusers left out):
--   accounts          profiles made
--   copied_list       of them, signed up to copy a public list
--   added_item        added an item themselves (change_log, kept 90 days)
--   back_later_day    opened the app on a later day: onboarding_steps from
--                     2026-11-26, before that only an edit on a later day shows
--   back_within_7     the same, within 7 days of signing up
WITH weeks AS (
  SELECT generate_series(date_trunc('week', now() AT TIME ZONE 'Europe/Helsinki' - interval '8 weeks'),
                         date_trunc('week', now() AT TIME ZONE 'Europe/Helsinki'), interval '1 week')::date AS week
),
steps AS (
  SELECT date_trunc('week', day)::date AS week,
         count(*) FILTER (WHERE step = 'public_list_opened') AS public_list,
         count(*) FILTER (WHERE step = 'try_opened') AS try_out,
         count(*) FILTER (WHERE step = 'signin_opened') AS sign_in,
         count(*) FILTER (WHERE step = 'signup_opened') AS sign_up
    FROM public.onboarding_steps WHERE user_id IS NULL GROUP BY 1
),
people AS (
  SELECT p.id, p.created_at, (p.created_at AT TIME ZONE 'Europe/Helsinki')::date AS joined_day
    FROM public.profiles p WHERE NOT coalesce(p.is_superuser, false)
),
later_days AS (
  SELECT s.user_id, s.day FROM public.onboarding_steps s WHERE s.step = 'opened'
  UNION
  SELECT c.user_id, (c.created_at AT TIME ZONE 'Europe/Helsinki')::date FROM public.change_log c
),
accounts AS (
  SELECT date_trunc('week', pe.joined_day)::date AS week,
         count(*) AS accounts,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.published_list_copies pc WHERE pc.created_by = pe.id)) AS copied_list,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.change_log c WHERE c.user_id = pe.id AND c.entity_type = 'work_item' AND c.action IN ('Add', 'Bulk Add'))) AS added_item,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM later_days l WHERE l.user_id = pe.id AND l.day > pe.joined_day)) AS back_later_day,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM later_days l WHERE l.user_id = pe.id AND l.day > pe.joined_day AND l.day <= pe.joined_day + 7)) AS back_within_7
    FROM people pe GROUP BY 1
)
SELECT w.week,
       coalesce(s.public_list, 0) AS public_list, coalesce(s.try_out, 0) AS try_out,
       coalesce(s.sign_in, 0) AS sign_in, coalesce(s.sign_up, 0) AS sign_up,
       coalesce(a.accounts, 0) AS accounts, coalesce(a.copied_list, 0) AS copied_list,
       coalesce(a.added_item, 0) AS added_item, coalesce(a.back_later_day, 0) AS back_later_day,
       coalesce(a.back_within_7, 0) AS back_within_7
  FROM weeks w LEFT JOIN steps s USING (week) LEFT JOIN accounts a USING (week)
 ORDER BY w.week;
