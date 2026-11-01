-- A failed hierarchy check no longer blocks the ones after it.
--
-- A space gets a new check only while it has none waiting. A check that used up
-- its three attempts — a passing network error — is never run again, but it
-- stayed "waiting" for good, so that space was never checked again: Space D Jira
-- from 26 October, Space A from 29 October. A failed check says nothing the next
-- one will not, so it is closed, keeping its error, and the next is queued.

CREATE OR REPLACE FUNCTION public.jira_queue_levels_check()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.jira_sync_queue
     SET done_at = now()
   WHERE kind = 'levels' AND done_at IS NULL AND attempts >= 3;

  INSERT INTO public.jira_sync_queue (organization_id, connection_id, kind)
  SELECT c.organization_id, c.id, 'levels'
    FROM public.jira_connections c
   WHERE c.enabled
     AND NOT EXISTS (SELECT 1 FROM public.jira_sync_queue q
                      WHERE q.connection_id = c.id AND q.kind = 'levels' AND q.done_at IS NULL);
$function$;

-- The two stuck spaces, and the rest, checked now rather than at the next hour.
SELECT public.jira_queue_levels_check();
SELECT public.jira_kick();
