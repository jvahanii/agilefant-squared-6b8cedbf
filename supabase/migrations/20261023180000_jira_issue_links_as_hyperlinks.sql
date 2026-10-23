-- Jira's links between issues — "blocks INT-12", "relates to INT-7" — kept as
-- the paired item's hyperlinks in Agilefant, the link type and the other
-- issue's key as the text, the other issue in Jira as the address.
--
-- They come from Jira one way. Such a hyperlink carries the id of the Jira
-- link it stands for, so the sync can tell it from the item's own web links:
-- those go to Jira as web links, and these must not, or every "blocks" would
-- come back to Jira as a web link beside the real one. For the same reason a
-- change to one does not queue the item for Jira.

ALTER TABLE public.work_item_hyperlinks ADD COLUMN IF NOT EXISTS jira_issue_link text;

CREATE UNIQUE INDEX IF NOT EXISTS work_item_hyperlinks_jira_issue_link
  ON public.work_item_hyperlinks (work_item_id, jira_issue_link)
  WHERE jira_issue_link IS NOT NULL;

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
  -- A Jira issue link's hyperlink is Jira's: nothing of it goes back.
  IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.jira_issue_link ELSE NEW.jira_issue_link END) IS NOT NULL THEN
    RETURN NULL;
  END IF;
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
