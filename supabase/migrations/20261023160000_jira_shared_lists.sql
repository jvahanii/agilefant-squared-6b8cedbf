-- Jira-synced lists shared with other organizations.
--
-- An item a partner organization adds to a shared list belongs to the
-- partner's organization; so does one of theirs moved or mirrored into it.
-- The sync looked for a list's items in the owner's organization only — the
-- trigger by the item's organization, the list's view by joining on it — so
-- such items never reached Jira, silently. A list's items are now its items,
-- whoever's they are: the trigger looks at every space whose list the item is
-- in, or which it is paired with, and the list's view does not ask whose.
--
-- And people a synced tree is shared with may read what an owner's member
-- can of its spaces — the Jira address, key, list and levels — so their tags
-- link to Jira, the sidebar marks the list, and types are shown ahead of Jira.

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

  -- Every space, of any organization, whose list the item is or was in, or which it is paired with.
  FOR _c IN
    SELECT c.id, c.organization_id, c.tree_id, c.backlog_id
      FROM public.jira_connections c
     WHERE c.enabled
       AND ((TG_OP <> 'DELETE' AND (_row.backlog_assignments ->> c.tree_id) = c.backlog_id)
            OR (TG_OP <> 'INSERT' AND (OLD.backlog_assignments ->> c.tree_id) = c.backlog_id)
            OR EXISTS (SELECT 1 FROM public.jira_issue_links l WHERE l.connection_id = c.id AND l.work_item_id = _row.id))
  LOOP
    INSERT INTO public.jira_sync_queue (organization_id, connection_id, kind, ref)
    VALUES (_c.organization_id, _c.id, 'item', _row.id);
  END LOOP;
  RETURN NULL;
END;
$function$;

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
        JOIN public.jira_connections c ON c.enabled
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

CREATE OR REPLACE FUNCTION public.jira_list_items_for(_connection uuid)
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
    -- Whoever's the item is: a partner's, added to a shared list, is the list's all the same.
    JOIN public.work_items w
      ON (w.backlog_assignments ->> c.tree_id) = c.backlog_id
      OR EXISTS (SELECT 1 FROM public.jira_issue_links l WHERE l.connection_id = c.id AND l.work_item_id = w.id)
   WHERE c.id = _connection;
$function$;

CREATE POLICY "Those a synced tree is shared with can see its spaces"
  ON public.jira_connections
  FOR SELECT
  TO authenticated
  USING (public.is_tree_shared_with_user((SELECT public.current_user_id()), tree_id));
