-- Following a change to Jira's work type hierarchy — a level added above the
-- epic, or taken away — which Jira announces to no webhook.
--
-- Every ten minutes a "levels" check is queued for each connection. The sync
-- reads the project's types; if their levels are not the ones it last kept,
-- it keeps the new ones and runs a full sync, which levels every tree to the
-- hierarchy as Jira has it now. The app hears of the new levels through
-- Realtime, so the types it shows ahead of Jira follow at once.

ALTER TABLE public.jira_sync_queue DROP CONSTRAINT IF EXISTS jira_sync_queue_kind_check;
ALTER TABLE public.jira_sync_queue
  ADD CONSTRAINT jira_sync_queue_kind_check CHECK (kind IN ('item', 'issue', 'full', 'levels'));

CREATE OR REPLACE FUNCTION public.jira_queue_levels_check()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.jira_sync_queue (organization_id, kind)
  SELECT c.organization_id, 'levels'
    FROM public.jira_connections c
   WHERE c.enabled
     AND NOT EXISTS (SELECT 1 FROM public.jira_sync_queue q
                      WHERE q.organization_id = c.organization_id AND q.kind = 'levels' AND q.done_at IS NULL);
$function$;

REVOKE EXECUTE ON FUNCTION public.jira_queue_levels_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jira_queue_levels_check() TO service_role;

-- The minute job (jira-sync-kick) starts the drain that takes it.
DO $cron$
BEGIN
  PERFORM cron.unschedule('jira-hierarchy-check') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jira-hierarchy-check');
  PERFORM cron.schedule('jira-hierarchy-check', '*/10 * * * *', 'SELECT public.jira_queue_levels_check()');
END
$cron$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.jira_connections;
