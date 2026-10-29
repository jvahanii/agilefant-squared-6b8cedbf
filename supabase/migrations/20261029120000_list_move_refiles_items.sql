-- A list moved to another tree takes its items with it, in the database.
--
-- An item is in a list by its assignment in the list's tree: { tree: list }.
-- Moving a list to another tree, the app re-filed the items it had loaded
-- under the new tree. The page is usable before its items have loaded, and
-- the re-filing is one more save that can fail; either way, items it did not
-- re-file stayed under the old tree, where the list no longer is, and the
-- list in its new tree looked empty. So it went for the Agilefant-Jira
-- integration list on 24 October: moved with its 44 items, Jira's AF space
-- following it, the items left behind.
--
-- Now the move of the list re-files its items here, whatever the page holds.
-- As the app does: the old tree's assignment becomes the new tree's, taking
-- the place of any the item had there. Lists under a moved list are saved
-- with their new tree too, each moving its own items.

CREATE OR REPLACE FUNCTION public.refile_items_of_moved_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.work_items
     SET backlog_assignments = (backlog_assignments - OLD.tree_id) || jsonb_build_object(NEW.tree_id, NEW.id)
   WHERE backlog_assignments ->> OLD.tree_id = NEW.id;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.refile_items_of_moved_list() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refile_items_of_moved_list() TO service_role;

DROP TRIGGER IF EXISTS trg_backlogs_refile_items ON public.backlogs;
CREATE TRIGGER trg_backlogs_refile_items
  AFTER UPDATE OF tree_id ON public.backlogs
  FOR EACH ROW
  WHEN (NEW.tree_id IS DISTINCT FROM OLD.tree_id)
  EXECUTE FUNCTION public.refile_items_of_moved_list();

-- Items a list moved before this left behind: filed under a tree their list
-- is not in, and in no list of the list's own tree. On 29 October these were
-- the 44 of the Agilefant-Jira integration list, and no others.
UPDATE public.work_items w
   SET backlog_assignments = (w.backlog_assignments - stray.old_tree) || jsonb_build_object(stray.new_tree, stray.list_id)
  FROM (
    SELECT w2.id AS item_id, a.key AS old_tree, b.tree_id AS new_tree, b.id AS list_id
      FROM public.work_items w2
      CROSS JOIN LATERAL jsonb_each_text(w2.backlog_assignments) a
      JOIN public.backlogs b ON b.id = a.value
     WHERE a.key <> b.tree_id
       AND NOT (w2.backlog_assignments ? b.tree_id)
  ) stray
 WHERE w.id = stray.item_id;
