-- Grants on every existing table, written down.
--
-- Until 2026-10-30 Supabase granted the Data API roles access to each new
-- table in the public schema by itself. From that day it does not: a table
-- created without its own GRANT answers "permission denied" to supabase-js.
-- Tables that exist already keep their grants, so production is unaffected —
-- but a database built from these migrations after that date (a new project,
-- a preview branch, `supabase db reset`) would get none of the grants the
-- earlier migrations relied on Supabase to add, and the app would see nothing.
--
-- So here are the grants production holds, as read from it on 2026-10-20,
-- for every table and sequence there. Run against production they change
-- nothing. Most tables are open to all three roles, with row-level security
-- deciding what each request may touch; the ones closed to visitors or kept
-- for the server alone are kept so here too, exactly as they are.
--
-- A table some environment does not have is skipped, not an error:
-- organization_invites exists in production but no migration creates it.
--
-- Every migration that creates a table from now on grants its own access.

DO $catch_up$
DECLARE
  _g record;
BEGIN
  FOR _g IN
    SELECT * FROM (VALUES
    ('table', 'backlog_scrambles',                    'ALL', 'service_role'),
    ('table', 'backlog_statuses',                     'ALL', 'anon, authenticated, service_role'),
    ('table', 'backlog_tree_shares',                  'ALL', 'anon, authenticated, service_role'),
    ('table', 'backlog_trees',                        'ALL', 'anon, authenticated, service_role'),
    ('table', 'backlogs',                             'ALL', 'anon, authenticated, service_role'),
    ('table', 'career_page_seen_postings',            'ALL', 'service_role'),
    ('table', 'change_log',                           'ALL', 'anon, authenticated, service_role'),
    ('table', 'deleted_work_items',                   'ALL', 'service_role'),
    ('table', 'github_repo_integrations',             'ALL', 'anon, authenticated, service_role'),
    ('table', 'github_repo_targets',                  'ALL', 'anon, authenticated, service_role'),
    ('table', 'gmail_connections',                    'ALL', 'anon, authenticated, service_role'),
    ('table', 'gmail_import_queries',                 'ALL', 'anon, authenticated, service_role'),
    ('table', 'gmail_imported_links',                 'ALL', 'anon, authenticated, service_role'),
    ('table', 'gmail_shared_connector_organizations', 'ALL', 'service_role'),
    ('table', 'label_assignments',                    'ALL', 'anon, authenticated, service_role'),
    ('table', 'labels',                               'ALL', 'anon, authenticated, service_role'),
    ('table', 'memberships',                          'ALL', 'anon, authenticated, service_role'),
    ('table', 'organization_backups',                 'ALL', 'anon, authenticated, service_role'),
    ('table', 'organization_google_oauth_clients',    'ALL', 'service_role'),
    ('table', 'organization_invites',                 'ALL', 'anon, authenticated, service_role'),
    ('table', 'organization_settings',                'ALL', 'anon, authenticated, service_role'),
    ('table', 'organizations',                        'ALL', 'anon, authenticated, service_role'),
    ('table', 'posting_checks',                       'ALL', 'anon, authenticated, service_role'),
    ('table', 'posting_language',                     'ALL', 'anon, authenticated, service_role'),
    ('table', 'profiles',                             'ALL', 'anon, authenticated, service_role'),
    ('table', 'published_link_settings',              'ALL', 'authenticated, service_role'),
    ('table', 'published_links',                      'ALL', 'anon, authenticated, service_role'),
    ('table', 'scramble_pins',                        'ALL', 'service_role'),
    ('table', 'team_members',                         'ALL', 'anon, authenticated, service_role'),
    ('table', 'teams',                                'ALL', 'anon, authenticated, service_role'),
    ('table', 'time_entries',                         'ALL', 'anon, authenticated, service_role'),
    ('table', 'tree_financial_targets',               'ALL', 'anon, authenticated, service_role'),
    ('table', 'whatsapp_integrations',                'ALL', 'anon, authenticated, service_role'),
    ('table', 'work_item_backlog_ranks',              'ALL', 'anon, authenticated, service_role'),
    ('table', 'work_item_board_ranks',                'ALL', 'anon, authenticated, service_role'),
    ('table', 'work_item_chart_prefs',                'ALL', 'anon, authenticated, service_role'),
    ('table', 'work_item_financials',                 'ALL', 'anon, authenticated, service_role'),
    ('table', 'work_item_history',                    'ALL', 'anon, authenticated, service_role'),
    ('table', 'work_item_hyperlinks',                 'ALL', 'anon, authenticated, service_role'),
    ('table', 'work_item_scrambles',                  'ALL', 'service_role'),
    ('table', 'work_item_snoozes',                    'ALL', 'anon, authenticated, service_role'),
    ('table', 'work_item_team_assignments',           'ALL', 'anon, authenticated, service_role'),
    ('table', 'work_items',                           'ALL', 'anon, authenticated, service_role'),
    ('sequence', 'deleted_work_items_id_seq',            'SELECT, UPDATE, USAGE', 'anon, authenticated, service_role')
    ) AS g(kind, name, privileges, roles)
  LOOP
    IF to_regclass(format('public.%I', _g.name)) IS NULL THEN
      RAISE NOTICE 'catch-up grants: public.% does not exist here; skipped', _g.name;
      CONTINUE;
    END IF;
    EXECUTE format('GRANT %s ON %s public.%I TO %s', _g.privileges, upper(_g.kind), _g.name, _g.roles);
  END LOOP;
END
$catch_up$;
