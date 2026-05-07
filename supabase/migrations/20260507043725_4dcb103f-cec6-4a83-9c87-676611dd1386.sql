-- Remove any prior schedule of the same name (idempotent)
DO $$
BEGIN
  PERFORM cron.unschedule('daily-organization-backup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'daily-organization-backup',
  '15 3 * * *',
  $job$
  SELECT net.http_post(
    url := 'https://hwwjwkdbautfkhpxuord.supabase.co/functions/v1/daily-backup',
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