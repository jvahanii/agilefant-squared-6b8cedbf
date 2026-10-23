-- Stopping one item's sync with Jira, from its right-click menu.
--
-- The pair is kept, marked stopped, rather than dropped: dropped, the next
-- full sync would take the item for a new one and make it an issue again, and
-- the issue for a new one and bring it into Agilefant — two of each. Kept and
-- stopped, the sync passes it by: nothing travels either way, and deleting one
-- side does not delete the other. Resumed, it syncs again from where the two
-- last agreed.

ALTER TABLE public.jira_issue_links ADD COLUMN IF NOT EXISTS stopped boolean NOT NULL DEFAULT false;

GRANT SELECT (stopped) ON public.jira_issue_links TO authenticated;
