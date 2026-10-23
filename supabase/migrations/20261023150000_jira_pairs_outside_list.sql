-- A Jira-synced item moved out of the synced list keeps syncing.
--
-- Leaving the list used to count as deleting: the item's Jira issue was
-- deleted. Now a pair lasts wherever the item goes in Agilefant; only deleting
-- the item deletes its issue. So the sync's view of a space's list takes in
-- the items paired with it that are elsewhere now, marked as not in the list,
-- and a change to such an item's hyperlinks is queued as one in the list is.

DROP FUNCTION IF EXISTS public.jira_list_items_for(uuid);
CREATE FUNCTION public.jira_list_items_for(_connection uuid)
RETURNS TABLE (id text, title text, description text, status text, points integer, parent_id text, in_list boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT w.id, w.title, w.description, w.status, w.points,
         coalesce(w.parent_id_overrides ->> c.tree_id, w.parent_id) AS parent_id,
         coalesce((w.backlog_assignments ->> c.tree_id) = c.backlog_id, false) AS in_list
    FROM public.jira_connections c
    JOIN public.work_items w ON w.organization_id = c.organization_id
   WHERE c.id = _connection
     AND ((w.backlog_assignments ->> c.tree_id) = c.backlog_id
          OR EXISTS (SELECT 1 FROM public.jira_issue_links l WHERE l.connection_id = c.id AND l.work_item_id = w.id));
$function$;

REVOKE EXECUTE ON FUNCTION public.jira_list_items_for(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jira_list_items_for(uuid) TO service_role;

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
    -- Each space the item is in the list of, or is paired with from elsewhere.
    FOR _c IN
      SELECT c.id, c.organization_id
        FROM public.work_items w
        JOIN public.jira_connections c ON c.organization_id = w.organization_id AND c.enabled
       WHERE w.id = _id
         AND ((w.backlog_assignments ->> c.tree_id) = c.backlog_id
              OR EXISTS (SELECT 1 FROM public.jira_issue_links l WHERE l.connection_id = c.id AND l.work_item_id = w.id))
    LOOP
      INSERT INTO public.jira_sync_queue (organization_id, connection_id, kind, ref)
      VALUES (_c.organization_id, _c.id, 'item', _id);
    END LOOP;
  END LOOP;
  RETURN NULL;
END;
$function$;
