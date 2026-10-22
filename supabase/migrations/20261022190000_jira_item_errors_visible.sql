-- Why the sync could not send an item's last change to Jira, shown on the
-- item itself: the error was only in the Jira card in Settings, easy to miss
-- ("Jira has 5 levels … and this would make 6"). Members may read the pair's
-- error alongside its key and type (20261022150000_jira_keys_visible.sql).

GRANT SELECT (last_error) ON public.jira_issue_links TO authenticated;
