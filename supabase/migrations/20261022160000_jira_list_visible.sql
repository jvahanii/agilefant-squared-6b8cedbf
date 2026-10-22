-- Which list is kept in step with Jira, for the marker beside it in the
-- sidebar. Members could already read their organization's Jira address and
-- project key (20261022150000_jira_keys_visible.sql); now also the list and
-- whether the sync is on.

GRANT SELECT (backlog_id, enabled) ON public.jira_connections TO authenticated;
