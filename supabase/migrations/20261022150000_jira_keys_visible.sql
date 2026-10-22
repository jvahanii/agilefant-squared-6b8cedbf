-- Which Jira issue an item stands for, shown in the app: its key and type
-- ("INT-8 · Subtask") beside the item's name, linking to the issue.
--
-- The sync's tables were for the edge function alone. Members may now read
-- just enough of them: a pair's key and type, and the Jira address to link
-- to. The rest — the agreed state, the webhook secret, errors — stays with the
-- service role, by column grants.

CREATE POLICY "Members can see which Jira issue an item is"
  ON public.jira_issue_links
  FOR SELECT
  TO authenticated
  USING (public.is_work_item_accessible(public.current_user_id(), work_item_id));

GRANT SELECT (work_item_id, organization_id, jira_issue_id, jira_key, jira_type)
  ON public.jira_issue_links TO authenticated;

CREATE POLICY "Members can see where their Jira is"
  ON public.jira_connections
  FOR SELECT
  TO authenticated
  USING (public.is_member_of(public.current_user_id(), organization_id));

GRANT SELECT (organization_id, base_url, project_key)
  ON public.jira_connections TO authenticated;

-- A sync that makes an item a subtask changes only its link, not the item:
-- the app hears of it here.
ALTER PUBLICATION supabase_realtime ADD TABLE public.jira_issue_links;
