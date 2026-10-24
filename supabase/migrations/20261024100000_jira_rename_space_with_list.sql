-- A list kept in step with Jira, renamed: its Jira space is renamed to match.
--
-- The rename is queued for the space, not made here: the sync reads the
-- list's name as it is when it gets to it, so a name typed and retyped is
-- one rename in Jira, and Jira's refusal — the account not allowed to
-- administer Jira, say — is the space's error to show, not the rename's.

ALTER TABLE public.jira_sync_queue DROP CONSTRAINT IF EXISTS jira_sync_queue_kind_check;
ALTER TABLE public.jira_sync_queue ADD CONSTRAINT jira_sync_queue_kind_check
  CHECK (kind IN ('item', 'issue', 'full', 'levels', 'links', 'rename'));

CREATE OR REPLACE FUNCTION public.jira_queue_list_rename()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.jira_sync_queue (organization_id, connection_id, kind, ref)
  SELECT c.organization_id, c.id, 'rename', NULL
    FROM public.jira_connections c
   WHERE c.backlog_id = NEW.id AND c.enabled;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.jira_queue_list_rename() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jira_queue_list_rename() TO service_role;

DROP TRIGGER IF EXISTS trg_backlogs_jira_rename ON public.backlogs;
CREATE TRIGGER trg_backlogs_jira_rename
  AFTER UPDATE OF name ON public.backlogs
  FOR EACH ROW
  WHEN (NEW.name IS DISTINCT FROM OLD.name)
  EXECUTE FUNCTION public.jira_queue_list_rename();

-- What is queued, a rename or a move to another tree, starts at once.
DROP TRIGGER IF EXISTS trg_backlogs_jira_kick ON public.backlogs;
CREATE TRIGGER trg_backlogs_jira_kick
  AFTER UPDATE OF tree_id, name ON public.backlogs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.jira_kick_after_statement();
