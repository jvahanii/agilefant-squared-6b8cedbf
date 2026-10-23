-- lovable-cron-fallback-reviewed: Jira Cloud does not document remote web-link change webhooks; two-minute reconciliation detects changes without relying on issue timestamps. User informed of 720 checks/day and recurring resource cost.
CREATE OR REPLACE FUNCTION public.jira_queue_hyperlink_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE _ids text[] := ARRAY[]::text[]; _id text; _org uuid;
BEGIN
  IF TG_OP <> 'INSERT' THEN _ids := array_append(_ids, OLD.work_item_id); END IF;
  IF TG_OP <> 'DELETE' THEN
    IF TG_OP = 'UPDATE' AND NEW.work_item_id IS NOT DISTINCT FROM OLD.work_item_id AND NEW.url IS NOT DISTINCT FROM OLD.url AND NEW.alt_text IS NOT DISTINCT FROM OLD.alt_text THEN RETURN NULL; END IF;
    _ids := array_append(_ids, NEW.work_item_id);
  END IF;
  FOR _id IN SELECT DISTINCT unnest(_ids) LOOP
    SELECT w.organization_id INTO _org FROM public.work_items w JOIN public.jira_connections c ON c.organization_id = w.organization_id AND c.enabled WHERE w.id = _id AND (w.backlog_assignments ->> c.tree_id) = c.backlog_id;
    IF FOUND THEN INSERT INTO public.jira_sync_queue (organization_id, kind, ref) VALUES (_org, 'item', _id); END IF;
  END LOOP;
  RETURN NULL;
END; $fn$;
REVOKE EXECUTE ON FUNCTION public.jira_queue_hyperlink_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jira_queue_hyperlink_change() TO service_role;
CREATE TRIGGER trg_hyperlinks_jira_queue AFTER INSERT OR UPDATE OR DELETE ON public.work_item_hyperlinks FOR EACH ROW EXECUTE FUNCTION public.jira_queue_hyperlink_change();
CREATE TRIGGER trg_hyperlinks_jira_kick AFTER INSERT OR UPDATE OR DELETE ON public.work_item_hyperlinks FOR EACH STATEMENT EXECUTE FUNCTION public.jira_kick_after_statement();
ALTER TABLE public.jira_sync_queue DROP CONSTRAINT IF EXISTS jira_sync_queue_kind_check;
ALTER TABLE public.jira_sync_queue ADD CONSTRAINT jira_sync_queue_kind_check CHECK (kind IN ('item', 'issue', 'full', 'levels', 'links'));
CREATE OR REPLACE FUNCTION public.jira_queue_links_check() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $fn$
 INSERT INTO public.jira_sync_queue (organization_id, kind)
 SELECT c.organization_id, 'links' FROM public.jira_connections c WHERE c.enabled AND NOT EXISTS (SELECT 1 FROM public.jira_sync_queue q WHERE q.organization_id = c.organization_id AND q.kind = 'links' AND q.done_at IS NULL);
$fn$;
REVOKE EXECUTE ON FUNCTION public.jira_queue_links_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.jira_queue_links_check() TO service_role;
SELECT cron.schedule('jira-external-links-check', '*/2 * * * *', 'SELECT public.jira_queue_links_check(); SELECT public.jira_kick();');