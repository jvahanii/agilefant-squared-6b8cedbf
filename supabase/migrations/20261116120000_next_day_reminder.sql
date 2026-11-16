-- A reminder email the day after someone first signs in.
--
-- Of the 34 people who first signed in from August to mid-November 2026, 15
-- never changed anything and only 4 were back after their first day. Each new
-- person now gets one email about a day after their first sign-in: how to add
-- a first item if they have none, otherwise a pointer back to what they made.
--
-- The onboarding-reminder function sends it, called hourly below. It sends
-- nothing until the RESEND_API_KEY secret is set.

-- One row per person emailed, so nobody is emailed twice. Gone with the
-- profile when an account is deleted.
CREATE TABLE IF NOT EXISTS public.onboarding_emails (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  had_items boolean,
  error text
);
ALTER TABLE public.onboarding_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.onboarding_emails FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_emails TO service_role;

-- People who asked for no more of these emails.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS product_emails_off boolean NOT NULL DEFAULT false;

-- Who is due a reminder: first signed in 24 to 48 hours ago, not yet emailed,
-- not opted out, with an address. Claims them by inserting their row, so two
-- overlapping runs never email the same person, and gives what the email
-- needs. A claimed row whose send failed keeps its error and is not retried.
CREATE OR REPLACE FUNCTION public.claim_onboarding_reminders(_limit integer DEFAULT 50)
 RETURNS TABLE(user_id uuid, email text, full_name text, items_added integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- user_id below is the table's column, not the result column of that name.
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT p.id, p.email, p.full_name
      FROM profiles p
     WHERE p.created_at <= now() - interval '24 hours'
       AND p.created_at >  now() - interval '48 hours'
       AND NOT p.is_superuser
       AND NOT p.product_emails_off
       AND coalesce(p.email, '') LIKE '%_@_%'
       AND NOT EXISTS (SELECT 1 FROM onboarding_emails o WHERE o.user_id = p.id)
     ORDER BY p.created_at
     LIMIT greatest(_limit, 0)
  ), claimed AS (
    INSERT INTO onboarding_emails (user_id)
    SELECT id FROM due
    ON CONFLICT (user_id) DO NOTHING
    RETURNING onboarding_emails.user_id
  )
  SELECT d.id, d.email, d.full_name,
         (SELECT count(*)::integer FROM change_log cl
           WHERE cl.user_id = d.id AND cl.entity_type = 'work_item' AND cl.action IN ('Add', 'Bulk Add'))
    FROM due d
    JOIN claimed k ON k.user_id = d.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_onboarding_reminders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_onboarding_reminders(integer) TO service_role;

-- Hourly, at 25 past.
DO $$
BEGIN
  PERFORM cron.unschedule('onboarding-reminder');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'onboarding-reminder',
  '25 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://hwwjwkdbautfkhpxuord.supabase.co/functions/v1/onboarding-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1
      )
    ),
    body := '{}'::jsonb
  );
  $job$
);
