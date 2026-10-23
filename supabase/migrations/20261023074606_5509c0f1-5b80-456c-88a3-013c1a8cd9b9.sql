INSERT INTO public.jira_sync_queue (organization_id, kind, ref)
SELECT l.organization_id, 'item', l.work_item_id
FROM public.jira_issue_links l
JOIN public.work_items w ON w.id = l.work_item_id
JOIN public.jira_connections c ON c.organization_id = l.organization_id AND c.enabled
WHERE l.organization_id = '227ff1d1-36df-4f46-b97e-483ada92ccfb'
  AND l.jira_key = 'AF-20'
  AND l.last_error LIKE '%INVALID_INPUT%'
  AND COALESCE(w.description, '') IS DISTINCT FROM COALESCE(l.agreed->>'description', '')
  AND NOT EXISTS (SELECT 1 FROM public.jira_sync_queue q WHERE q.organization_id = l.organization_id AND q.kind = 'item' AND q.ref = l.work_item_id AND q.done_at IS NULL);