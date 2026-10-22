-- Keeping an Agilefant list and a Jira project in step, both ways.
--
-- One organization connects one list to one Jira Cloud project. Every change
-- to an item on the list is queued here by a trigger and sent to Jira by the
-- jira-sync edge function at once; every change in the project comes in by
-- Jira's webhook and is queued the same way. What both sides agreed on at the
-- last sync is kept with each pair, which is how each side tells its own new
-- changes from the ones it has just been given (see _shared/jiraMapping.ts).
--
-- Nothing here is read by the app directly: the edge function does all of it
-- with the service role. The Jira API token is not here either — it is the
-- functions' JIRA_API_TOKEN secret.

-- ─── The connection ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.jira_connections (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- https://<site>.atlassian.net
  base_url        text NOT NULL,
  -- The Atlassian account the API token belongs to.
  email           text NOT NULL,
  project_key     text NOT NULL,
  project_id      text,
  tree_id         text NOT NULL REFERENCES public.backlog_trees(id) ON DELETE CASCADE,
  backlog_id      text NOT NULL REFERENCES public.backlogs(id) ON DELETE CASCADE,
  -- The custom field holding story points, e.g. customfield_10016.
  points_field    text,
  enabled         boolean NOT NULL DEFAULT true,
  -- Proves a webhook call came from the webhook this connection registered.
  webhook_secret  text NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  -- Jira's address for that webhook, to remove it by.
  webhook_url     text,
  -- Where the trigger and the minute job send "there is work queued".
  function_url    text,
  -- Held while one call works through the queue, so two never do the same item.
  drain_until     timestamptz,
  last_synced_at  timestamptz,
  last_error      text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- ─── Which item is which issue ───────────────────────────────────────────────

-- No foreign key to work_items: when an item is deleted, its row here is what
-- says which Jira issue to delete.
CREATE TABLE IF NOT EXISTS public.jira_issue_links (
  work_item_id    text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  jira_issue_id   text NOT NULL,
  jira_key        text NOT NULL,
  jira_type       text NOT NULL,
  -- {title, description, status, points, parent} as both sides last agreed.
  agreed          jsonb,
  last_error      text,
  synced_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, jira_issue_id)
);

-- ─── What is waiting to be sent ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.jira_sync_queue (
  id              bigserial PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- item: an Agilefant item changed; issue: a Jira issue changed; full: everything.
  kind            text NOT NULL CHECK (kind IN ('item', 'issue', 'full')),
  ref             text,
  queued_at       timestamptz NOT NULL DEFAULT now(),
  done_at         timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  error           text
);
CREATE INDEX IF NOT EXISTS jira_sync_queue_pending_idx
  ON public.jira_sync_queue (organization_id, id) WHERE done_at IS NULL;

-- Only the edge function reaches these. RLS on with no policies, and grants to
-- the service role alone (written out, as Supabase stops adding them itself
-- on 2026-10-30).
ALTER TABLE public.jira_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_issue_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jira_sync_queue  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.jira_connections, public.jira_issue_links, public.jira_sync_queue FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.jira_sync_queue_id_seq FROM anon, authenticated;
GRANT ALL ON public.jira_connections, public.jira_issue_links, public.jira_sync_queue TO service_role;
GRANT ALL ON SEQUENCE public.jira_sync_queue_id_seq TO service_role;

-- ─── Calling the edge function ───────────────────────────────────────────────

-- "There is work queued": one call per connected organization with something
-- new waiting. Rows that have failed three times are left for "Sync now".
CREATE OR REPLACE FUNCTION public.jira_kick()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _c record;
BEGIN
  FOR _c IN
    SELECT c.organization_id, c.function_url
      FROM public.jira_connections c
     WHERE c.enabled AND c.function_url IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.jira_sync_queue q
                    WHERE q.organization_id = c.organization_id AND q.done_at IS NULL AND q.attempts < 3)
  LOOP
    PERFORM net.http_post(
      url := _c.function_url,
      body := jsonb_build_object('action', 'drain', 'organizationId', _c.organization_id),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  END LOOP;
END;
$function$;

-- ─── Queueing Agilefant's changes ────────────────────────────────────────────

-- An item on the connected list changed, arrived, left, or was deleted. A
-- change to nothing that travels (a rating, a deadline) is not queued.
CREATE OR REPLACE FUNCTION public.jira_queue_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row public.work_items%ROWTYPE;
  _conn public.jira_connections%ROWTYPE;
  _in_list boolean;
  _was_in_list boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN _row := OLD; ELSE _row := NEW; END IF;
  SELECT * INTO _conn FROM public.jira_connections WHERE organization_id = _row.organization_id AND enabled;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.description IS NOT DISTINCT FROM OLD.description
     AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.points IS NOT DISTINCT FROM OLD.points
     AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
     AND NEW.parent_id_overrides IS NOT DISTINCT FROM OLD.parent_id_overrides
     AND NEW.backlog_assignments IS NOT DISTINCT FROM OLD.backlog_assignments THEN
    RETURN NULL;
  END IF;

  _in_list := TG_OP <> 'DELETE' AND (_row.backlog_assignments ->> _conn.tree_id) = _conn.backlog_id;
  _was_in_list := TG_OP <> 'INSERT' AND (OLD.backlog_assignments ->> _conn.tree_id) = _conn.backlog_id;
  IF NOT _in_list AND NOT _was_in_list
     AND NOT EXISTS (SELECT 1 FROM public.jira_issue_links l WHERE l.work_item_id = _row.id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.jira_sync_queue (organization_id, kind, ref) VALUES (_row.organization_id, 'item', _row.id);
  RETURN NULL;
END;
$function$;

-- Once per statement, after its rows are queued: a bulk change makes one call.
CREATE OR REPLACE FUNCTION public.jira_kick_after_statement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.jira_connections WHERE enabled) THEN
    PERFORM public.jira_kick();
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_work_items_jira_queue ON public.work_items;
CREATE TRIGGER trg_work_items_jira_queue
  AFTER INSERT OR UPDATE OR DELETE ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.jira_queue_item_change();

DROP TRIGGER IF EXISTS trg_work_items_jira_kick ON public.work_items;
CREATE TRIGGER trg_work_items_jira_kick
  AFTER INSERT OR UPDATE OR DELETE ON public.work_items
  FOR EACH STATEMENT EXECUTE FUNCTION public.jira_kick_after_statement();

-- ─── For the edge function ───────────────────────────────────────────────────

-- The items on the connected list, with their parent within the tree.
CREATE OR REPLACE FUNCTION public.jira_list_items(_org uuid)
RETURNS TABLE (id text, title text, description text, status text, points integer, parent_id text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT w.id, w.title, w.description, w.status, w.points,
         coalesce(w.parent_id_overrides ->> c.tree_id, w.parent_id) AS parent_id
    FROM public.jira_connections c
    JOIN public.work_items w
      ON w.organization_id = c.organization_id
     AND w.backlog_assignments ->> c.tree_id = c.backlog_id
   WHERE c.organization_id = _org;
$function$;

-- One call at a time works through an organization's queue.
CREATE OR REPLACE FUNCTION public.jira_try_lock(_org uuid, _seconds integer DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.jira_connections
     SET drain_until = now() + make_interval(secs => _seconds)
   WHERE organization_id = _org AND (drain_until IS NULL OR drain_until < now());
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.jira_unlock(_org uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.jira_connections SET drain_until = NULL WHERE organization_id = _org;
$function$;

REVOKE EXECUTE ON FUNCTION public.jira_kick(), public.jira_list_items(uuid), public.jira_try_lock(uuid, integer),
  public.jira_unlock(uuid), public.jira_queue_item_change(), public.jira_kick_after_statement() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jira_kick(), public.jira_list_items(uuid), public.jira_try_lock(uuid, integer),
  public.jira_unlock(uuid) TO service_role;

-- ─── A minute's fallback ─────────────────────────────────────────────────────

-- Should a call from the trigger be lost, the queue is looked at every minute.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jira-sync-kick') THEN
    PERFORM cron.unschedule('jira-sync-kick');
  END IF;
  PERFORM cron.schedule('jira-sync-kick', '* * * * *', 'SELECT public.jira_kick()');
END
$cron$;
