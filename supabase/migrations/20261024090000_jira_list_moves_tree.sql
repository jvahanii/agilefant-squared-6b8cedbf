-- A list kept in step with Jira, moved to another tree — itself, or with a
-- list above it — stays in step, and so do its items.
--
-- A space is kept with its list and the list's tree: an item is the list's
-- where its assignment in that tree is the list. Moved, the list's items are
-- assigned in the new tree instead, so with the space still naming the old
-- one, every item would look moved out of the list: still in step, as moved
-- items are, but the list's new items never sent to Jira, Jira's new issues
-- made in a tree the list is no longer in, and the space dropped altogether —
-- its pairs with it — when the old tree is deleted. So the space follows the
-- list to its new tree, and a full sync goes over it there.

CREATE OR REPLACE FUNCTION public.jira_follow_list_to_tree()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _c record;
BEGIN
  FOR _c IN
    UPDATE public.jira_connections
       SET tree_id = NEW.tree_id
     WHERE backlog_id = NEW.id
       AND tree_id IS DISTINCT FROM NEW.tree_id
    RETURNING id, organization_id
  LOOP
    INSERT INTO public.jira_sync_queue (organization_id, connection_id, kind, ref)
    VALUES (_c.organization_id, _c.id, 'full', NULL);
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.jira_follow_list_to_tree() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jira_follow_list_to_tree() TO service_role;

DROP TRIGGER IF EXISTS trg_backlogs_jira_follow_tree ON public.backlogs;
CREATE TRIGGER trg_backlogs_jira_follow_tree
  AFTER UPDATE OF tree_id ON public.backlogs
  FOR EACH ROW
  WHEN (NEW.tree_id IS DISTINCT FROM OLD.tree_id)
  EXECUTE FUNCTION public.jira_follow_list_to_tree();

-- A list moved before this: its space brought to the tree it is in now.
WITH moved AS (
  UPDATE public.jira_connections c
     SET tree_id = b.tree_id
    FROM public.backlogs b
   WHERE b.id = c.backlog_id
     AND c.tree_id IS DISTINCT FROM b.tree_id
  RETURNING c.id, c.organization_id
)
INSERT INTO public.jira_sync_queue (organization_id, connection_id, kind, ref)
SELECT organization_id, id, 'full', NULL FROM moved;

-- The full sync queued starts at once.
DROP TRIGGER IF EXISTS trg_backlogs_jira_kick ON public.backlogs;
CREATE TRIGGER trg_backlogs_jira_kick
  AFTER UPDATE OF tree_id ON public.backlogs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.jira_kick_after_statement();
