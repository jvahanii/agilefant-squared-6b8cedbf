-- A new item under a synced item is synced too, whichever list it is in.
--
-- A synced item moved out of its list keeps syncing; an item put under it
-- went to the list it is in now, which no space keeps, so Jira never had it.
-- Now an item is the space's when an item above it in the space's tree — its
-- parent, or one further up — is paired with the space: the change trigger
-- queues it, and the full sync lists it, to be made in Jira under its parent.

-- Whether an item above this parent — the parent itself, or one further up in
-- the tree — is paired with the space. Up to twenty levels, as the sync goes.
CREATE OR REPLACE FUNCTION public.jira_synced_ancestor(_parent text, _tree text, _connection uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH RECURSIVE up(id, depth) AS (
    SELECT _parent, 1 WHERE _parent IS NOT NULL
    UNION ALL
    SELECT coalesce(w.parent_id_overrides ->> _tree, w.parent_id), up.depth + 1
      FROM up
      JOIN public.work_items w ON w.id = up.id
     WHERE up.depth < 20
       AND coalesce(w.parent_id_overrides ->> _tree, w.parent_id) IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.jira_issue_links l WHERE l.connection_id = _connection AND l.work_item_id = up.id)
  )
  SELECT EXISTS (
    SELECT 1 FROM up JOIN public.jira_issue_links l ON l.connection_id = _connection AND l.work_item_id = up.id
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.jira_synced_ancestor(text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jira_synced_ancestor(text, text, uuid) TO service_role;

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

  -- Every space, of any organization, whose list the item is or was in,
  -- which it is paired with, or with which an item above it is paired.
  FOR _c IN
    SELECT c.id, c.organization_id, c.tree_id, c.backlog_id
      FROM public.jira_connections c
     WHERE c.enabled
       AND ((TG_OP <> 'DELETE' AND (_row.backlog_assignments ->> c.tree_id) = c.backlog_id)
            OR (TG_OP <> 'INSERT' AND (OLD.backlog_assignments ->> c.tree_id) = c.backlog_id)
            OR EXISTS (SELECT 1 FROM public.jira_issue_links l WHERE l.connection_id = c.id AND l.work_item_id = _row.id)
            OR (TG_OP <> 'DELETE' AND _row.backlog_assignments ? c.tree_id
                AND public.jira_synced_ancestor(coalesce(_row.parent_id_overrides ->> c.tree_id, _row.parent_id), c.tree_id, c.id)))
  LOOP
    INSERT INTO public.jira_sync_queue (organization_id, connection_id, kind, ref)
    VALUES (_c.organization_id, _c.id, 'item', _row.id);
  END LOOP;
  RETURN NULL;
END;
$function$;

-- The space's items: its list's, those paired with it wherever they are, and
-- those under a paired item, down to twenty levels. An item under one is
-- found by its parent: a parent named for one tree only is left to the
-- change trigger, which reads it, rather than scanning every item here.
CREATE OR REPLACE FUNCTION public.jira_list_items_for(_connection uuid)
RETURNS TABLE(id text, title text, description text, status text, points integer, parent_id text, in_list boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH RECURSIVE conn AS (
    SELECT c.id, c.tree_id, c.backlog_id FROM public.jira_connections c WHERE c.id = _connection
  ),
  under(id, depth) AS (
    SELECT w.id, 1
      FROM conn
      JOIN public.jira_issue_links l ON l.connection_id = conn.id
      JOIN public.work_items w ON w.parent_id = l.work_item_id
     WHERE w.backlog_assignments ? conn.tree_id
       AND coalesce(w.parent_id_overrides ->> conn.tree_id, w.parent_id) = w.parent_id
    UNION
    SELECT w.id, under.depth + 1
      FROM under
      CROSS JOIN conn
      JOIN public.work_items w ON w.parent_id = under.id
     WHERE under.depth < 20
       AND w.backlog_assignments ? conn.tree_id
       AND coalesce(w.parent_id_overrides ->> conn.tree_id, w.parent_id) = w.parent_id
  )
  SELECT w.id, w.title, w.description, w.status, w.points,
         coalesce(w.parent_id_overrides ->> c.tree_id, w.parent_id) AS parent_id,
         coalesce((w.backlog_assignments ->> c.tree_id) = c.backlog_id, false) AS in_list
    FROM conn c
    -- Whoever's the item is: a partner's, added to a shared list, is the list's all the same.
    JOIN public.work_items w
      ON (w.backlog_assignments ->> c.tree_id) = c.backlog_id
      OR EXISTS (SELECT 1 FROM public.jira_issue_links l WHERE l.connection_id = c.id AND l.work_item_id = w.id)
      OR w.id IN (SELECT under.id FROM under);
$function$;
