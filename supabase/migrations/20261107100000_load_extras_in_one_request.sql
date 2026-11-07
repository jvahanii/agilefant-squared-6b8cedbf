-- A load's small reads in one request.
--
-- Besides items, ranks and links (get_org_changes), a load read some twenty
-- small tables — labels, settings, teams, statuses, snoozes and the rest —
-- each its own request, and asked each tree in turn who it is shared with.
-- On a database that answers a burst slowly, every one of them waited its
-- turn: three to four seconds each at the start of a load.
--
-- get_load_extras returns them together, read as the caller, so each part is
-- exactly what the part's own query returns; the app hands each part to the
-- store that would have read it (loadExtras.ts). get_trees_sharing_info does
-- for every tree at once what get_tree_sharing_info did for one.

-- The organizations a load reads labels, statuses and financials for: this
-- one and those whose trees are shared with it, as the page works them out
-- from the trees it shows. Teams are read for those whose trees this one
-- shares as well, as teamStore works them out.
CREATE OR REPLACE FUNCTION public.get_load_extras(_org_id uuid)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH own_trees AS (
    SELECT id FROM backlog_trees WHERE organization_id = _org_id
  ),
  orgs AS (
    SELECT _org_id AS oid
    UNION
    SELECT bt.organization_id FROM backlog_tree_shares s JOIN backlog_trees bt ON bt.id = s.tree_id
    WHERE s.organization_id = _org_id
  ),
  team_orgs AS (
    SELECT oid FROM orgs
    UNION
    SELECT s.organization_id FROM backlog_tree_shares s JOIN own_trees t ON t.id = s.tree_id
  ),
  org_teams AS (
    SELECT * FROM teams WHERE organization_id IN (SELECT oid FROM team_orgs)
  )
  SELECT json_build_object(
    'orgIds', (SELECT json_agg(oid) FROM orgs WHERE oid IS NOT NULL),
    'labels', (SELECT coalesce(json_agg(l ORDER BY l.id), '[]') FROM labels l WHERE l.organization_id IN (SELECT oid FROM orgs)),
    'labelAssignments', (SELECT coalesce(json_agg(a ORDER BY a.id), '[]') FROM label_assignments a WHERE a.organization_id IN (SELECT oid FROM orgs)),
    'publishedLinks', (SELECT coalesce(json_agg(json_build_object('tree_id', p.tree_id, 'backlog_id', p.backlog_id)), '[]') FROM published_links p),
    'itemScrambles', (SELECT coalesce(json_agg(json_build_object('work_item_id', s.work_item_id, 'scrambled_by', s.scrambled_by, 'with_backlog_id', s.with_backlog_id)), '[]') FROM work_item_scrambles s),
    'listScrambles', (SELECT coalesce(json_agg(json_build_object('backlog_id', s.backlog_id, 'scrambled_by', s.scrambled_by, 'with_backlog_id', s.with_backlog_id)), '[]') FROM backlog_scrambles s),
    'jiraLinks', (SELECT coalesce(json_agg(json_build_object('work_item_id', j.work_item_id, 'organization_id', j.organization_id, 'connection_id', j.connection_id, 'jira_key', j.jira_key, 'jira_type', j.jira_type, 'last_error', j.last_error, 'stopped', j.stopped)), '[]') FROM jira_issue_links j),
    'jiraConnections', (SELECT coalesce(json_agg(json_build_object('id', c.id, 'organization_id', c.organization_id, 'base_url', c.base_url, 'project_key', c.project_key, 'backlog_id', c.backlog_id, 'tree_id', c.tree_id, 'enabled', c.enabled, 'issue_types', c.issue_types)), '[]') FROM jira_connections c),
    'teams', (SELECT coalesce(json_agg(t), '[]') FROM org_teams t),
    'teamMembers', (SELECT coalesce(json_agg(m), '[]') FROM team_members m WHERE m.team_id IN (SELECT id FROM org_teams)),
    'teamAssignments', (SELECT coalesce(json_agg(json_build_object('work_item_id', x.work_item_id, 'team_id', x.team_id) ORDER BY x.work_item_id), '[]') FROM work_item_team_assignments x),
    'settings', (SELECT json_build_object(
        'organization_id', s.organization_id, 'time_logging_enabled', s.time_logging_enabled, 'points_enabled', s.points_enabled,
        'labels_enabled', s.labels_enabled, 'custom_statuses_enabled', s.custom_statuses_enabled, 'savings_income_enabled', s.savings_income_enabled,
        'boards_enabled', s.boards_enabled, 'burnups_enabled', s.burnups_enabled, 'persist_notifications_enabled', s.persist_notifications_enabled,
        'public_links_enabled', s.public_links_enabled, 'ratings_enabled', s.ratings_enabled, 'deadlines_enabled', s.deadlines_enabled,
        'created_dates_enabled', s.created_dates_enabled, 'start_end_dates_enabled', s.start_end_dates_enabled, 'scrambling_enabled', s.scrambling_enabled)
      FROM organization_settings s WHERE s.organization_id = _org_id),
    'statuses', (SELECT coalesce(json_agg(to_jsonb(s) || jsonb_build_object('backlogs', jsonb_build_object('organization_id', b.organization_id)) ORDER BY s.id), '[]')
      FROM backlog_statuses s JOIN backlogs b ON b.id = s.backlog_id WHERE b.organization_id IN (SELECT oid FROM orgs)),
    'snoozes', (SELECT coalesce(json_agg(z ORDER BY z.id), '[]') FROM work_item_snoozes z WHERE z.user_id = public.current_user_id()),
    'targets', (SELECT coalesce(json_agg(t ORDER BY t.id), '[]') FROM tree_financial_targets t WHERE t.organization_id IN (SELECT oid FROM orgs)),
    'financials', (SELECT coalesce(json_agg(f ORDER BY f.id), '[]') FROM work_item_financials f WHERE f.organization_id IN (SELECT oid FROM orgs))
  );
$$;

REVOKE ALL ON FUNCTION public.get_load_extras(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_load_extras(uuid) TO authenticated, service_role;

-- Who each of several trees is shared with: get_tree_sharing_info for many at once.
CREATE OR REPLACE FUNCTION public.get_trees_sharing_info(_tree_ids text[], _exclude_org_id uuid)
RETURNS TABLE(tree_id text, org_id uuid, org_name text, is_owner boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT bt.id, o.id, o.name, (o.id = bt.organization_id)
  FROM backlog_trees bt
  CROSS JOIN LATERAL (
    SELECT bt.organization_id AS oid
    UNION
    SELECT bts.organization_id FROM backlog_tree_shares bts WHERE bts.tree_id = bt.id
  ) orgs
  JOIN organizations o ON o.id = orgs.oid
  WHERE bt.id = ANY(_tree_ids)
    AND orgs.oid IS NOT NULL
    AND orgs.oid != _exclude_org_id
    AND is_tree_accessible(public.current_user_id(), bt.id)
$$;

REVOKE ALL ON FUNCTION public.get_trees_sharing_info(text[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trees_sharing_info(text[], uuid) TO authenticated, service_role;
