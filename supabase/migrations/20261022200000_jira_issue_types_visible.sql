-- The Jira project's issue types and their hierarchy levels, kept with the
-- connection, so the app can show the type a move in Agilefant will give an
-- item the moment it is made, before Jira has made it. The sync writes them
-- as it reads them from Jira; members may read them with the rest they see of
-- the connection (20261022160000_jira_list_visible.sql).

ALTER TABLE public.jira_connections ADD COLUMN IF NOT EXISTS issue_types jsonb;

GRANT SELECT (issue_types, tree_id) ON public.jira_connections TO authenticated;
