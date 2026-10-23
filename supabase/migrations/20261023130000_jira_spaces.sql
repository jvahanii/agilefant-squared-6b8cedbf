-- Several Jira spaces per organization, each kept in step with a list of its own.
--
-- Until now an organization had one connection: one Jira project, one list,
-- keyed by the organization. Now each Jira space chosen in the app is a
-- connection of its own, with its own list (an existing one, or one made for
-- it), webhook, queue and lock; the Jira site and account are shared. The one
-- connection there is becomes the first space, its pairs and queue with it.
-- Taking a space off stops its sync and forgets its pairs; the list stays.

-- ─── Connections: one per space ──────────────────────────────────────────────

ALTER TABLE public.jira_connections ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE public.jira_connections ADD COLUMN IF NOT EXISTS project_name text;
ALTER TABLE public.jira_connections DROP CONSTRAINT IF EXISTS jira_connections_pkey;
ALTER TABLE public.jira_connections ADD CONSTRAINT jira_connections_pkey PRIMARY KEY (id);
ALTER TABLE public.jira_connections ADD CONSTRAINT jira_connections_org_project_key UNIQUE (organization_id, project_key);
-- A list is kept in step with one space at most.
ALTER TABLE public.jira_connections ADD CONSTRAINT jira_connections_backlog_key UNIQUE (backlog_id);
CREATE INDEX IF NOT EXISTS jira_connections_org_idx ON public.jira_connections (organization_id);

GRANT SELECT (id, project_name) ON public.jira_connections TO authenticated;

-- ─── Pairs belong to a space ─────────────────────────────────────────────────

ALTER TABLE public.jira_issue_links ADD COLUMN IF NOT EXISTS connection_id uuid;
UPDATE public.jira_issue_links l
   SET connection_id = c.id
  FROM public.jira_connections c
 WHERE c.organization_id = l.organization_id AND l.connection_id IS NULL;
DELETE FROM public.jira_issue_links WHERE connection_id IS NULL;
ALTER TABLE public.jira_issue_links ALTER COLUMN connection_id SET NOT NULL;
ALTER TABLE public.jira_issue_links
  ADD CONSTRAINT jira_issue_links_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.jira_connections(id) ON DELETE CASCADE;
ALTER TABLE public.jira_issue_links DROP CONSTRAINT IF EXISTS jira_issue_links_pkey;
ALTER TABLE public.jira_issue_links ADD CONSTRAINT jira_issue_links_pkey PRIMARY KEY (connection_id, work_item_id);
ALTER TABLE public.jira_issue_links DROP CONSTRAINT IF EXISTS jira_issue_links_organization_id_jira_issue_id_key;
ALTER TABLE public.jira_issue_links ADD CONSTRAINT jira_issue_links_connection_issue_key UNIQUE (connection_id, jira_issue_id);
-- Looked up by item: the app's tags, RLS, the trigger.
CREATE INDEX IF NOT EXISTS jira_issue_links_work_item_idx ON public.jira_issue_links (work_item_id);

-- Part of the key now, so Realtime can tell the app which pair changed.
GRANT SELECT (connection_id) ON public.jira_issue_links TO authenticated;

-- ─── The queue belongs to a space ────────────────────────────────────────────

ALTER TABLE public.jira_sync_queue ADD COLUMN IF NOT EXISTS connection_id uuid
  REFERENCES public.jira_connections(id) ON DELETE CASCADE;
UPDATE public.jira_sync_queue q
   SET connection_id = c.id
  FROM public.jira_connections c
 WHERE c.organization_id = q.organization_id AND q.connection_id IS NULL AND q.done_at IS NULL;
CREATE INDEX IF NOT EXISTS jira_sync_queue_connection_pending_idx
  ON public.jira_sync_queue (connection_id, id) WHERE done_at IS NULL;

-- ─── "There is work queued", per space ───────────────────────────────────────

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
    SELECT c.id, c.organization_id, c.function_url
      FROM public.jira_connections c
     WHERE c.enabled AND c.function_url IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.jira_sync_queue q
                    WHERE q.connection_id = c.id AND q.done_at IS NULL AND q.attempts < 3)
  LOOP
    PERFORM net.http_post(
      url := _c.function_url,
      body := jsonb_build_object('action', 'drain', 'organizationId', _c.organization_id, 'connectionId', _c.id),
      headers := jsonb_build_object('Content-Type', 'application/json')
    );
  END LOOP;
END;
$function$;

-- ─── Queueing Agilefant's changes, for each space the item is in ─────────────

CREATE OR REPLACE FUNCTION public.jira_queue_item_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row public.work_items%ROWTYPE;
  _c record;
BEGIN
  IF TG_OP = 'DELETE' THEN _row := OLD; ELSE _row := NEW; END IF;

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

  FOR _c IN
    SELECT c.id, c.tree_id, c.backlog_id
      FROM public.jira_connections c
     WHERE c.organization_id = _row.organization_id AND c.enabled
  LOOP
    IF (TG_OP <> 'DELETE' AND (_row.backlog_assignments ->> _c.tree_id) = _c.backlog_id)
       OR (TG_OP <> 'INSERT' AND (OLD.backlog_assignments ->> _c.tree_id) = _c.backlog_id)
       OR EXISTS (SELECT 1 FROM public.jira_issue_links l WHERE l.connection_id = _c.id AND l.work_item_id = _row.id) THEN
      INSERT INTO public.jira_sync_queue (organization_id, connection_id, kind, ref)
      VALUES (_row.organization_id, _c.id, 'item', _row.id);
    END IF;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- A hyperlink added, changed or removed is a change to its item, in each space the item is in.
CREATE OR REPLACE FUNCTION public.jira_queue_hyperlink_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _ids text[] := ARRAY[]::text[];
  _id text;
  _c record;
BEGIN
  IF TG_OP <> 'INSERT' THEN _ids := array_append(_ids, OLD.work_item_id); END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_OP = 'UPDATE' AND NEW.work_item_id IS NOT DISTINCT FROM OLD.work_item_id
       AND NEW.url IS NOT DISTINCT FROM OLD.url AND NEW.alt_text IS NOT DISTINCT FROM OLD.alt_text THEN
      RETURN NULL;
    END IF;
    _ids := array_append(_ids, NEW.work_item_id);
  END IF;
  FOR _id IN SELECT DISTINCT unnest(_ids) LOOP
    FOR _c IN
      SELECT c.id, c.organization_id
        FROM public.work_items w
        JOIN public.jira_connections c ON c.organization_id = w.organization_id AND c.enabled
       WHERE w.id = _id AND (w.backlog_assignments ->> c.tree_id) = c.backlog_id
    LOOP
      INSERT INTO public.jira_sync_queue (organization_id, connection_id, kind, ref)
      VALUES (_c.organization_id, _c.id, 'item', _id);
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$function$;

-- ─── The checks run by the clock, per space ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.jira_queue_levels_check()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.jira_sync_queue (organization_id, connection_id, kind)
  SELECT c.organization_id, c.id, 'levels'
    FROM public.jira_connections c
   WHERE c.enabled
     AND NOT EXISTS (SELECT 1 FROM public.jira_sync_queue q
                      WHERE q.connection_id = c.id AND q.kind = 'levels' AND q.done_at IS NULL);
$function$;

CREATE OR REPLACE FUNCTION public.jira_queue_links_check()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  INSERT INTO public.jira_sync_queue (organization_id, connection_id, kind)
  SELECT c.organization_id, c.id, 'links'
    FROM public.jira_connections c
   WHERE c.enabled
     AND NOT EXISTS (SELECT 1 FROM public.jira_sync_queue q
                      WHERE q.connection_id = c.id AND q.kind = 'links' AND q.done_at IS NULL);
$function$;

-- ─── A space's list, and its lock ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.jira_list_items_for(_connection uuid)
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
   WHERE c.id = _connection;
$function$;

CREATE OR REPLACE FUNCTION public.jira_try_lock_connection(_connection uuid, _seconds integer DEFAULT 120)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.jira_connections
     SET drain_until = now() + make_interval(secs => _seconds)
   WHERE id = _connection AND (drain_until IS NULL OR drain_until < now());
  RETURN FOUND;
END;
$function$;

CREATE OR REPLACE FUNCTION public.jira_unlock_connection(_connection uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.jira_connections SET drain_until = NULL WHERE id = _connection;
$function$;

REVOKE EXECUTE ON FUNCTION public.jira_list_items_for(uuid), public.jira_try_lock_connection(uuid, integer),
  public.jira_unlock_connection(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jira_list_items_for(uuid), public.jira_try_lock_connection(uuid, integer),
  public.jira_unlock_connection(uuid) TO service_role;
