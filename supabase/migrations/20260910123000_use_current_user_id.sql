-- Replace auth.uid() with public.current_user_id() across every policy and
-- function that uses it, so identity resolves for Clerk as well as Supabase.
--
-- Generated from the live catalog rather than written by hand: reproducing 124
-- policies by hand is how a USING clause quietly becomes a WITH CHECK, or a
-- policy loses its role restriction. The only edit is the function name — see
-- the verification note in the Clerk mapping migration.
--
-- Policies rewritten: 124 of 124. Functions rewritten: 11.

DROP POLICY IF EXISTS "delete_backlog_statuses" ON "public"."backlog_statuses";
CREATE POLICY "delete_backlog_statuses" ON "public"."backlog_statuses"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM backlogs b
  WHERE ((b.id = backlog_statuses.backlog_id) AND is_tree_accessible(public.current_user_id(), b.tree_id)))));

DROP POLICY IF EXISTS "insert_backlog_statuses" ON "public"."backlog_statuses";
CREATE POLICY "insert_backlog_statuses" ON "public"."backlog_statuses"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((EXISTS ( SELECT 1
   FROM backlogs b
  WHERE ((b.id = backlog_statuses.backlog_id) AND is_tree_accessible(public.current_user_id(), b.tree_id)))));

DROP POLICY IF EXISTS "select_backlog_statuses" ON "public"."backlog_statuses";
CREATE POLICY "select_backlog_statuses" ON "public"."backlog_statuses"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM backlogs b
  WHERE ((b.id = backlog_statuses.backlog_id) AND is_tree_accessible(public.current_user_id(), b.tree_id)))));

DROP POLICY IF EXISTS "update_backlog_statuses" ON "public"."backlog_statuses";
CREATE POLICY "update_backlog_statuses" ON "public"."backlog_statuses"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((EXISTS ( SELECT 1
   FROM backlogs b
  WHERE ((b.id = backlog_statuses.backlog_id) AND is_tree_accessible(public.current_user_id(), b.tree_id)))));

DROP POLICY IF EXISTS "Owner and shared org members can read shares" ON "public"."backlog_tree_shares";
CREATE POLICY "Owner and shared org members can read shares" ON "public"."backlog_tree_shares"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_tree_owner_member(public.current_user_id(), tree_id) OR is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Owner org admins can delete shares" ON "public"."backlog_tree_shares";
CREATE POLICY "Owner org admins can delete shares" ON "public"."backlog_tree_shares"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((is_tree_admin(public.current_user_id(), tree_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Owner org admins can insert shares" ON "public"."backlog_tree_shares";
CREATE POLICY "Owner org admins can insert shares" ON "public"."backlog_tree_shares"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_tree_admin(public.current_user_id(), tree_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members and shared can read" ON "public"."backlog_trees";
CREATE POLICY "Org members and shared can read" ON "public"."backlog_trees"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_tree_shared_with_user(public.current_user_id(), id)));

DROP POLICY IF EXISTS "Org members and shared can update" ON "public"."backlog_trees";
CREATE POLICY "Org members and shared can update" ON "public"."backlog_trees"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_tree_shared_with_user(public.current_user_id(), id)));

DROP POLICY IF EXISTS "Org members can delete" ON "public"."backlog_trees";
CREATE POLICY "Org members can delete" ON "public"."backlog_trees"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members can insert" ON "public"."backlog_trees";
CREATE POLICY "Org members can insert" ON "public"."backlog_trees"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members and shared can delete" ON "public"."backlogs";
CREATE POLICY "Org members and shared can delete" ON "public"."backlogs"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_tree_accessible(public.current_user_id(), tree_id)));

DROP POLICY IF EXISTS "Org members and shared can insert" ON "public"."backlogs";
CREATE POLICY "Org members and shared can insert" ON "public"."backlogs"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members and shared can read" ON "public"."backlogs";
CREATE POLICY "Org members and shared can read" ON "public"."backlogs"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_tree_accessible(public.current_user_id(), tree_id)));

DROP POLICY IF EXISTS "Org members and shared can update" ON "public"."backlogs";
CREATE POLICY "Org members and shared can update" ON "public"."backlogs"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_tree_accessible(public.current_user_id(), tree_id)));

DROP POLICY IF EXISTS "Org members can insert change log" ON "public"."change_log";
CREATE POLICY "Org members can insert change log" ON "public"."change_log"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((user_id = public.current_user_id()) AND (is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()))));

DROP POLICY IF EXISTS "Org members can read change log" ON "public"."change_log";
CREATE POLICY "Org members can read change log" ON "public"."change_log"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can delete integrations" ON "public"."github_repo_integrations";
CREATE POLICY "Admins can delete integrations" ON "public"."github_repo_integrations"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can insert integrations" ON "public"."github_repo_integrations";
CREATE POLICY "Admins can insert integrations" ON "public"."github_repo_integrations"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can read integrations" ON "public"."github_repo_integrations";
CREATE POLICY "Admins can read integrations" ON "public"."github_repo_integrations"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can update integrations" ON "public"."github_repo_integrations";
CREATE POLICY "Admins can update integrations" ON "public"."github_repo_integrations"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can delete targets" ON "public"."github_repo_targets";
CREATE POLICY "Admins can delete targets" ON "public"."github_repo_targets"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can insert targets" ON "public"."github_repo_targets";
CREATE POLICY "Admins can insert targets" ON "public"."github_repo_targets"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Members can read targets" ON "public"."github_repo_targets";
CREATE POLICY "Members can read targets" ON "public"."github_repo_targets"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Users can delete their own gmail connection" ON "public"."gmail_connections";
CREATE POLICY "Users can delete their own gmail connection" ON "public"."gmail_connections"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((user_id = public.current_user_id()));

DROP POLICY IF EXISTS "Users can view their own gmail connection" ON "public"."gmail_connections";
CREATE POLICY "Users can view their own gmail connection" ON "public"."gmail_connections"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((user_id = public.current_user_id()));

DROP POLICY IF EXISTS "Org members can create their own gmail import queries" ON "public"."gmail_import_queries";
CREATE POLICY "Org members can create their own gmail import queries" ON "public"."gmail_import_queries"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((user_id = public.current_user_id()) AND is_member_of(public.current_user_id(), organization_id)));

DROP POLICY IF EXISTS "Org members can view gmail import queries" ON "public"."gmail_import_queries";
CREATE POLICY "Org members can view gmail import queries" ON "public"."gmail_import_queries"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_member_of(public.current_user_id(), organization_id));

DROP POLICY IF EXISTS "Owners of a gmail import query can delete it" ON "public"."gmail_import_queries";
CREATE POLICY "Owners of a gmail import query can delete it" ON "public"."gmail_import_queries"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) AND ((user_id = public.current_user_id()) OR has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role))));

DROP POLICY IF EXISTS "Owners of a gmail import query can update it" ON "public"."gmail_import_queries";
CREATE POLICY "Owners of a gmail import query can update it" ON "public"."gmail_import_queries"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) AND ((user_id = public.current_user_id()) OR has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role))))
  WITH CHECK (is_member_of(public.current_user_id(), organization_id));

DROP POLICY IF EXISTS "Org members can clear imported gmail links" ON "public"."gmail_imported_links";
CREATE POLICY "Org members can clear imported gmail links" ON "public"."gmail_imported_links"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_member_of(public.current_user_id(), organization_id));

DROP POLICY IF EXISTS "Org members can record imported gmail links" ON "public"."gmail_imported_links";
CREATE POLICY "Org members can record imported gmail links" ON "public"."gmail_imported_links"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (is_member_of(public.current_user_id(), organization_id));

DROP POLICY IF EXISTS "Org members can view imported gmail links" ON "public"."gmail_imported_links";
CREATE POLICY "Org members can view imported gmail links" ON "public"."gmail_imported_links"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_member_of(public.current_user_id(), organization_id));

DROP POLICY IF EXISTS "Members and shared can delete assignments" ON "public"."label_assignments";
CREATE POLICY "Members and shared can delete assignments" ON "public"."label_assignments"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_label_entity_accessible(public.current_user_id(), entity_type, entity_id)));

DROP POLICY IF EXISTS "Members and shared can insert assignments" ON "public"."label_assignments";
CREATE POLICY "Members and shared can insert assignments" ON "public"."label_assignments"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_label_entity_accessible(public.current_user_id(), entity_type, entity_id)));

DROP POLICY IF EXISTS "Members and shared can read assignments" ON "public"."label_assignments";
CREATE POLICY "Members and shared can read assignments" ON "public"."label_assignments"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_label_entity_accessible(public.current_user_id(), entity_type, entity_id)));

DROP POLICY IF EXISTS "Members and shared can update assignments" ON "public"."label_assignments";
CREATE POLICY "Members and shared can update assignments" ON "public"."label_assignments"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_label_entity_accessible(public.current_user_id(), entity_type, entity_id)))
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_label_entity_accessible(public.current_user_id(), entity_type, entity_id)));

DROP POLICY IF EXISTS "Members and shared-org users can read labels" ON "public"."labels";
CREATE POLICY "Members and shared-org users can read labels" ON "public"."labels"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (can_view_org_labels(public.current_user_id(), organization_id));

DROP POLICY IF EXISTS "Org members can delete labels" ON "public"."labels";
CREATE POLICY "Org members can delete labels" ON "public"."labels"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members can insert labels" ON "public"."labels";
CREATE POLICY "Org members can insert labels" ON "public"."labels"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members can update labels" ON "public"."labels";
CREATE POLICY "Org members can update labels" ON "public"."labels"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can delete memberships" ON "public"."memberships";
CREATE POLICY "Admins can delete memberships" ON "public"."memberships"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id()) OR (user_id = public.current_user_id())));

DROP POLICY IF EXISTS "Admins can manage memberships" ON "public"."memberships";
CREATE POLICY "Admins can manage memberships" ON "public"."memberships"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR (has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) AND (role = ANY (ARRAY['member'::app_role, 'admin'::app_role]))) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can update memberships" ON "public"."memberships";
CREATE POLICY "Admins can update memberships" ON "public"."memberships"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Members can read org memberships" ON "public"."memberships";
CREATE POLICY "Members can read org memberships" ON "public"."memberships"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can delete backups" ON "public"."organization_backups";
CREATE POLICY "Admins can delete backups" ON "public"."organization_backups"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can insert backups" ON "public"."organization_backups";
CREATE POLICY "Admins can insert backups" ON "public"."organization_backups"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can read backups" ON "public"."organization_backups";
CREATE POLICY "Admins can read backups" ON "public"."organization_backups"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can update backups" ON "public"."organization_backups";
CREATE POLICY "Admins can update backups" ON "public"."organization_backups"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())))
  WITH CHECK ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can delete invites" ON "public"."organization_invites";
CREATE POLICY "Admins can delete invites" ON "public"."organization_invites"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can insert invites" ON "public"."organization_invites";
CREATE POLICY "Admins can insert invites" ON "public"."organization_invites"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can update invites" ON "public"."organization_invites";
CREATE POLICY "Admins can update invites" ON "public"."organization_invites"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members can read invites" ON "public"."organization_invites";
CREATE POLICY "Org members can read invites" ON "public"."organization_invites"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can insert settings" ON "public"."organization_settings";
CREATE POLICY "Admins can insert settings" ON "public"."organization_settings"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can update settings" ON "public"."organization_settings";
CREATE POLICY "Admins can update settings" ON "public"."organization_settings"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members can read settings" ON "public"."organization_settings";
CREATE POLICY "Org members can read settings" ON "public"."organization_settings"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can update orgs" ON "public"."organizations";
CREATE POLICY "Admins can update orgs" ON "public"."organizations"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), id, 'owner'::app_role) OR has_org_role(public.current_user_id(), id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Authenticated users can create orgs" ON "public"."organizations";
CREATE POLICY "Authenticated users can create orgs" ON "public"."organizations"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((public.current_user_id() IS NOT NULL));

DROP POLICY IF EXISTS "Members can read their orgs" ON "public"."organizations";
CREATE POLICY "Members can read their orgs" ON "public"."organizations"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Owners and admins can delete orgs" ON "public"."organizations";
CREATE POLICY "Owners and admins can delete orgs" ON "public"."organizations"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), id, 'owner'::app_role) OR has_org_role(public.current_user_id(), id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members can read member profiles" ON "public"."profiles";
CREATE POLICY "Org members can read member profiles" ON "public"."profiles"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((EXISTS ( SELECT 1
   FROM (memberships m1
     JOIN memberships m2 ON ((m1.organization_id = m2.organization_id)))
  WHERE ((m1.user_id = public.current_user_id()) AND (m2.user_id = profiles.id)))) OR is_superuser(public.current_user_id()) OR (id = public.current_user_id())));

DROP POLICY IF EXISTS "System can insert profiles" ON "public"."profiles";
CREATE POLICY "System can insert profiles" ON "public"."profiles"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((public.current_user_id() = id) AND (is_superuser IS NOT TRUE)));

DROP POLICY IF EXISTS "Users can read own profile" ON "public"."profiles";
CREATE POLICY "Users can read own profile" ON "public"."profiles"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((id = public.current_user_id()) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Users can update own profile" ON "public"."profiles";
CREATE POLICY "Users can update own profile" ON "public"."profiles"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((id = public.current_user_id()))
  WITH CHECK (((id = public.current_user_id()) AND (is_superuser IS NOT TRUE)));

DROP POLICY IF EXISTS "Admins can delete team members" ON "public"."team_members";
CREATE POLICY "Admins can delete team members" ON "public"."team_members"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM teams t
  WHERE ((t.id = team_members.team_id) AND (has_org_role(public.current_user_id(), t.organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), t.organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id()))))));

DROP POLICY IF EXISTS "Admins can insert team members" ON "public"."team_members";
CREATE POLICY "Admins can insert team members" ON "public"."team_members"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM teams t
  WHERE ((t.id = team_members.team_id) AND (has_org_role(public.current_user_id(), t.organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), t.organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id()))))));

DROP POLICY IF EXISTS "Org members can read team members" ON "public"."team_members";
CREATE POLICY "Org members can read team members" ON "public"."team_members"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM teams t
  WHERE ((t.id = team_members.team_id) AND (is_member_of(public.current_user_id(), t.organization_id) OR is_superuser(public.current_user_id()))))));

DROP POLICY IF EXISTS "Admins can delete teams" ON "public"."teams";
CREATE POLICY "Admins can delete teams" ON "public"."teams"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can update teams" ON "public"."teams";
CREATE POLICY "Admins can update teams" ON "public"."teams"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members can insert teams" ON "public"."teams";
CREATE POLICY "Org members can insert teams" ON "public"."teams"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members can read teams" ON "public"."teams";
CREATE POLICY "Org members can read teams" ON "public"."teams"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR has_shared_tree_with_org(public.current_user_id(), organization_id)));

DROP POLICY IF EXISTS "Org members can insert time entries" ON "public"."time_entries";
CREATE POLICY "Org members can insert time entries" ON "public"."time_entries"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members can read time entries" ON "public"."time_entries";
CREATE POLICY "Org members can read time entries" ON "public"."time_entries"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Users can delete own or admins can delete any" ON "public"."time_entries";
CREATE POLICY "Users can delete own or admins can delete any" ON "public"."time_entries"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((((user_id = public.current_user_id()) AND is_member_of(public.current_user_id(), organization_id)) OR has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Users can update own or admins can update any" ON "public"."time_entries";
CREATE POLICY "Users can update own or admins can update any" ON "public"."time_entries"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((((user_id = public.current_user_id()) AND is_member_of(public.current_user_id(), organization_id)) OR has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Tree admins can delete targets" ON "public"."tree_financial_targets";
CREATE POLICY "Tree admins can delete targets" ON "public"."tree_financial_targets"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (is_tree_accessible(public.current_user_id(), tree_id));

DROP POLICY IF EXISTS "Tree admins can insert targets" ON "public"."tree_financial_targets";
CREATE POLICY "Tree admins can insert targets" ON "public"."tree_financial_targets"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_tree_accessible(public.current_user_id(), tree_id) AND is_member_of(public.current_user_id(), organization_id)));

DROP POLICY IF EXISTS "Tree admins can update targets" ON "public"."tree_financial_targets";
CREATE POLICY "Tree admins can update targets" ON "public"."tree_financial_targets"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING (is_tree_accessible(public.current_user_id(), tree_id))
  WITH CHECK (is_tree_accessible(public.current_user_id(), tree_id));

DROP POLICY IF EXISTS "Tree members can view targets" ON "public"."tree_financial_targets";
CREATE POLICY "Tree members can view targets" ON "public"."tree_financial_targets"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (is_tree_accessible(public.current_user_id(), tree_id));

DROP POLICY IF EXISTS "Admins can delete whatsapp integrations" ON "public"."whatsapp_integrations";
CREATE POLICY "Admins can delete whatsapp integrations" ON "public"."whatsapp_integrations"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can insert whatsapp integrations" ON "public"."whatsapp_integrations";
CREATE POLICY "Admins can insert whatsapp integrations" ON "public"."whatsapp_integrations"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can read whatsapp integrations" ON "public"."whatsapp_integrations";
CREATE POLICY "Admins can read whatsapp integrations" ON "public"."whatsapp_integrations"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can update whatsapp integrations" ON "public"."whatsapp_integrations";
CREATE POLICY "Admins can update whatsapp integrations" ON "public"."whatsapp_integrations"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members and shared can delete ranks" ON "public"."work_item_backlog_ranks";
CREATE POLICY "Org members and shared can delete ranks" ON "public"."work_item_backlog_ranks"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members and shared can read ranks" ON "public"."work_item_backlog_ranks";
CREATE POLICY "Org members and shared can read ranks" ON "public"."work_item_backlog_ranks"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members and shared can update ranks" ON "public"."work_item_backlog_ranks";
CREATE POLICY "Org members and shared can update ranks" ON "public"."work_item_backlog_ranks"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members can insert ranks" ON "public"."work_item_backlog_ranks";
CREATE POLICY "Org members can insert ranks" ON "public"."work_item_backlog_ranks"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members and shared can delete board ranks" ON "public"."work_item_board_ranks";
CREATE POLICY "Org members and shared can delete board ranks" ON "public"."work_item_board_ranks"
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members and shared can read board ranks" ON "public"."work_item_board_ranks";
CREATE POLICY "Org members and shared can read board ranks" ON "public"."work_item_board_ranks"
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members and shared can update board ranks" ON "public"."work_item_board_ranks";
CREATE POLICY "Org members and shared can update board ranks" ON "public"."work_item_board_ranks"
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members can insert board ranks" ON "public"."work_item_board_ranks";
CREATE POLICY "Org members can insert board ranks" ON "public"."work_item_board_ranks"
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Users manage own chart prefs" ON "public"."work_item_chart_prefs";
CREATE POLICY "Users manage own chart prefs" ON "public"."work_item_chart_prefs"
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((user_id = public.current_user_id()))
  WITH CHECK ((user_id = public.current_user_id()));

DROP POLICY IF EXISTS "Org members and shared can delete financials" ON "public"."work_item_financials";
CREATE POLICY "Org members and shared can delete financials" ON "public"."work_item_financials"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members and shared can insert financials" ON "public"."work_item_financials";
CREATE POLICY "Org members and shared can insert financials" ON "public"."work_item_financials"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members and shared can read financials" ON "public"."work_item_financials";
CREATE POLICY "Org members and shared can read financials" ON "public"."work_item_financials"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members and shared can update financials" ON "public"."work_item_financials";
CREATE POLICY "Org members and shared can update financials" ON "public"."work_item_financials"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Members can view work item history" ON "public"."work_item_history";
CREATE POLICY "Members can view work item history" ON "public"."work_item_history"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members and shared can delete hyperlinks" ON "public"."work_item_hyperlinks";
CREATE POLICY "Org members and shared can delete hyperlinks" ON "public"."work_item_hyperlinks"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members and shared can read hyperlinks" ON "public"."work_item_hyperlinks";
CREATE POLICY "Org members and shared can read hyperlinks" ON "public"."work_item_hyperlinks"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members and shared can update hyperlinks" ON "public"."work_item_hyperlinks";
CREATE POLICY "Org members and shared can update hyperlinks" ON "public"."work_item_hyperlinks"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members can insert hyperlinks" ON "public"."work_item_hyperlinks";
CREATE POLICY "Org members can insert hyperlinks" ON "public"."work_item_hyperlinks"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Users can delete own snoozes" ON "public"."work_item_snoozes";
CREATE POLICY "Users can delete own snoozes" ON "public"."work_item_snoozes"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (((user_id = public.current_user_id()) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Users can insert own snoozes" ON "public"."work_item_snoozes";
CREATE POLICY "Users can insert own snoozes" ON "public"."work_item_snoozes"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (((user_id = public.current_user_id()) AND (is_member_of(public.current_user_id(), organization_id) OR is_work_item_accessible(public.current_user_id(), work_item_id))));

DROP POLICY IF EXISTS "Users can read own snoozes" ON "public"."work_item_snoozes";
CREATE POLICY "Users can read own snoozes" ON "public"."work_item_snoozes"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((user_id = public.current_user_id()) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Users can update own snoozes" ON "public"."work_item_snoozes";
CREATE POLICY "Users can update own snoozes" ON "public"."work_item_snoozes"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((user_id = public.current_user_id()))
  WITH CHECK ((user_id = public.current_user_id()));

DROP POLICY IF EXISTS "Org members and shared can read assignments" ON "public"."work_item_team_assignments";
CREATE POLICY "Org members and shared can read assignments" ON "public"."work_item_team_assignments"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members can delete assignments" ON "public"."work_item_team_assignments";
CREATE POLICY "Org members can delete assignments" ON "public"."work_item_team_assignments"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members can insert assignments" ON "public"."work_item_team_assignments";
CREATE POLICY "Org members can insert assignments" ON "public"."work_item_team_assignments"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR is_work_item_accessible(public.current_user_id(), work_item_id)));

DROP POLICY IF EXISTS "Org members and shared can delete" ON "public"."work_items";
CREATE POLICY "Org members and shared can delete" ON "public"."work_items"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR has_accessible_tree_assignment(public.current_user_id(), backlog_assignments)));

DROP POLICY IF EXISTS "Org members and shared can insert" ON "public"."work_items";
CREATE POLICY "Org members and shared can insert" ON "public"."work_items"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Org members and shared can read" ON "public"."work_items";
CREATE POLICY "Org members and shared can read" ON "public"."work_items"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR has_accessible_tree_assignment(public.current_user_id(), backlog_assignments)));

DROP POLICY IF EXISTS "Org members and shared can update" ON "public"."work_items";
CREATE POLICY "Org members and shared can update" ON "public"."work_items"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id()) OR has_accessible_tree_assignment(public.current_user_id(), backlog_assignments)));

DROP POLICY IF EXISTS "Admins can delete youtube channels" ON "public"."youtube_channels";
CREATE POLICY "Admins can delete youtube channels" ON "public"."youtube_channels"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can insert youtube channels" ON "public"."youtube_channels";
CREATE POLICY "Admins can insert youtube channels" ON "public"."youtube_channels"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can update youtube channels" ON "public"."youtube_channels";
CREATE POLICY "Admins can update youtube channels" ON "public"."youtube_channels"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Members can read youtube channels" ON "public"."youtube_channels";
CREATE POLICY "Members can read youtube channels" ON "public"."youtube_channels"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can delete youtube search channels" ON "public"."youtube_search_channels";
CREATE POLICY "Admins can delete youtube search channels" ON "public"."youtube_search_channels"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can insert youtube search channels" ON "public"."youtube_search_channels";
CREATE POLICY "Admins can insert youtube search channels" ON "public"."youtube_search_channels"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can update youtube search channels" ON "public"."youtube_search_channels";
CREATE POLICY "Admins can update youtube search channels" ON "public"."youtube_search_channels"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Members can read youtube search channels" ON "public"."youtube_search_channels";
CREATE POLICY "Members can read youtube search channels" ON "public"."youtube_search_channels"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can delete youtube video links" ON "public"."youtube_video_links";
CREATE POLICY "Admins can delete youtube video links" ON "public"."youtube_video_links"
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can insert youtube video links" ON "public"."youtube_video_links";
CREATE POLICY "Admins can insert youtube video links" ON "public"."youtube_video_links"
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Admins can update youtube video links" ON "public"."youtube_video_links";
CREATE POLICY "Admins can update youtube video links" ON "public"."youtube_video_links"
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((has_org_role(public.current_user_id(), organization_id, 'owner'::app_role) OR has_org_role(public.current_user_id(), organization_id, 'admin'::app_role) OR is_superuser(public.current_user_id())));

DROP POLICY IF EXISTS "Members can read youtube video links" ON "public"."youtube_video_links";
CREATE POLICY "Members can read youtube video links" ON "public"."youtube_video_links"
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((is_member_of(public.current_user_id(), organization_id) OR is_superuser(public.current_user_id())));

-- build_organization_snapshot(uuid)
CREATE OR REPLACE FUNCTION public.build_organization_snapshot(_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid;
BEGIN
  _caller := public.current_user_id();
  IF _caller IS NOT NULL AND NOT (
    is_member_of(_caller, _org_id) OR is_superuser(_caller)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN jsonb_build_object(
    'version', 3,
    'generated_at', now(),
    'organization_id', _org_id,
    'backlog_trees', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM backlog_trees t WHERE t.organization_id = _org_id), '[]'::jsonb),
    'backlogs', COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM backlogs b WHERE b.organization_id = _org_id), '[]'::jsonb),
    'work_items', COALESCE((SELECT jsonb_agg(to_jsonb(w)) FROM work_items w WHERE w.organization_id = _org_id), '[]'::jsonb),
    'work_item_backlog_ranks', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM work_item_backlog_ranks r WHERE r.organization_id = _org_id), '[]'::jsonb),
    'work_item_board_ranks', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM work_item_board_ranks r WHERE r.organization_id = _org_id), '[]'::jsonb),
    'work_item_hyperlinks', COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM work_item_hyperlinks h WHERE h.organization_id = _org_id), '[]'::jsonb),
    'work_item_team_assignments', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM work_item_team_assignments a WHERE a.organization_id = _org_id), '[]'::jsonb),
    'labels', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM labels l WHERE l.organization_id = _org_id), '[]'::jsonb),
    'label_assignments', COALESCE((SELECT jsonb_agg(to_jsonb(la)) FROM label_assignments la WHERE la.organization_id = _org_id), '[]'::jsonb),
    'backlog_statuses', COALESCE((
      SELECT jsonb_agg(to_jsonb(bs))
      FROM backlog_statuses bs
      JOIN backlogs b ON b.id = bs.backlog_id
      WHERE b.organization_id = _org_id
    ), '[]'::jsonb)
  );
END;
$function$;

-- bulk_delete_work_items(text[])
CREATE OR REPLACE FUNCTION public.bulk_delete_work_items(_ids text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid;
  _deleted integer;
BEGIN
  _caller := public.current_user_id();
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF _caller IS NOT NULL AND NOT is_superuser(_caller) THEN
    IF EXISTS (
      SELECT 1 FROM work_items wi
      WHERE wi.id = ANY(_ids)
        AND NOT is_member_of(_caller, wi.organization_id)
    ) THEN
      RAISE EXCEPTION 'Permission denied: not a member of one or more item organizations';
    END IF;
  END IF;

  PERFORM set_config('burnups.skip_history', 'on', true);
  DELETE FROM work_items WHERE id = ANY(_ids);
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$function$;

-- cleanup_orphaned_users(uuid[])
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_users(p_user_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid;
BEGIN
  -- Only superusers may invoke this function for arbitrary users
  IF NOT is_superuser(public.current_user_id()) THEN
    -- Non-superusers can only clean up their own account
    IF NOT (public.current_user_id() = ANY(p_user_ids)) THEN
      RAISE EXCEPTION 'Permission denied: only superusers can clean up orphaned users';
    END IF;
    -- Narrow the array to just the caller's own UID
    p_user_ids := ARRAY[public.current_user_id()];
  END IF;

  FOREACH _uid IN ARRAY p_user_ids
  LOOP
    -- Skip superusers
    IF is_superuser(_uid) THEN
      CONTINUE;
    END IF;

    -- Skip users who still have memberships
    IF EXISTS (SELECT 1 FROM public.memberships WHERE user_id = _uid) THEN
      CONTINUE;
    END IF;

    -- Delete profile
    DELETE FROM public.profiles WHERE id = _uid;

    -- Delete auth user (requires SECURITY DEFINER)
    DELETE FROM auth.users WHERE id = _uid;
  END LOOP;
END;
$function$;

-- create_organization_backup(uuid,text,text)
CREATE OR REPLACE FUNCTION public.create_organization_backup(_org_id uuid, _kind text DEFAULT 'auto'::text, _note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _snap jsonb;
  _id uuid;
  _caller uuid;
BEGIN
  _caller := public.current_user_id();

  -- Allow internal/service-role invocations (no JWT user) to proceed.
  -- For authenticated callers, require org owner/admin or superuser.
  IF _caller IS NOT NULL AND NOT (
    has_org_role(_caller, _org_id, 'owner'::app_role)
    OR has_org_role(_caller, _org_id, 'admin'::app_role)
    OR is_superuser(_caller)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  _snap := build_organization_snapshot(_org_id);

  INSERT INTO public.organization_backups (organization_id, created_by, kind, note, size_bytes, snapshot)
  VALUES (_org_id, _caller, COALESCE(_kind, 'auto'), _note, octet_length(_snap::text), _snap)
  RETURNING id INTO _id;

  RETURN _id;
END;
$function$;

-- get_tree_sharing_info(text,uuid)
CREATE OR REPLACE FUNCTION public.get_tree_sharing_info(_tree_id text, _exclude_org_id uuid)
 RETURNS TABLE(org_id uuid, org_name text, is_owner boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT o.id, o.name, (o.id = bt.organization_id) AS is_owner
  FROM backlog_trees bt
  CROSS JOIN LATERAL (
    SELECT bt.organization_id AS oid
    UNION
    SELECT bts.organization_id AS oid
    FROM backlog_tree_shares bts
    WHERE bts.tree_id = _tree_id
  ) orgs
  JOIN organizations o ON o.id = orgs.oid
  WHERE bt.id = _tree_id
    AND orgs.oid IS NOT NULL
    AND orgs.oid != _exclude_org_id
    AND is_tree_accessible(public.current_user_id(), _tree_id)
$function$;

-- get_user_memberships(uuid)
CREATE OR REPLACE FUNCTION public.get_user_memberships(_user_id uuid)
 RETURNS TABLE(organization_id uuid, organization_name text, organization_slug text, role app_role)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.organization_id, o.name, o.slug, m.role
  FROM public.memberships m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = _user_id
    AND (_user_id = public.current_user_id() OR public.is_superuser(public.current_user_id()))
$function$;

-- move_time_entries(uuid[],text,text)
CREATE OR REPLACE FUNCTION public.move_time_entries(_entry_ids uuid[], _target_kind text, _target_id text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid;
  _target_org uuid;
  _updated integer;
BEGIN
  _caller := public.current_user_id();
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF _target_kind NOT IN ('work_item','backlog','tree') THEN
    RAISE EXCEPTION 'Invalid target kind: %', _target_kind;
  END IF;

  IF _entry_ids IS NULL OR array_length(_entry_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Resolve destination org
  IF _target_kind = 'work_item' THEN
    SELECT organization_id INTO _target_org FROM work_items WHERE id = _target_id;
  ELSIF _target_kind = 'backlog' THEN
    SELECT organization_id INTO _target_org FROM backlogs WHERE id = _target_id;
  ELSE
    SELECT organization_id INTO _target_org FROM backlog_trees WHERE id = _target_id;
  END IF;

  IF _target_org IS NULL THEN
    RAISE EXCEPTION 'Target % % not found', _target_kind, _target_id;
  END IF;

  IF NOT (is_member_of(_caller, _target_org) OR is_superuser(_caller)) THEN
    RAISE EXCEPTION 'Permission denied: not a member of the target organization';
  END IF;

  -- Caller must be a member of every source org referenced by these entries
  IF NOT is_superuser(_caller) AND EXISTS (
    SELECT 1 FROM time_entries te
    WHERE te.id = ANY(_entry_ids)
      AND NOT is_member_of(_caller, te.organization_id)
  ) THEN
    RAISE EXCEPTION 'Permission denied: not a member of one or more source organizations';
  END IF;

  UPDATE time_entries
  SET
    work_item_id = CASE WHEN _target_kind = 'work_item' THEN _target_id ELSE NULL END,
    backlog_id   = CASE WHEN _target_kind = 'backlog'   THEN _target_id ELSE NULL END,
    tree_id      = CASE WHEN _target_kind = 'tree'      THEN _target_id ELSE NULL END,
    organization_id = _target_org
  WHERE id = ANY(_entry_ids);

  GET DIAGNOSTICS _updated = ROW_COUNT;
  RETURN _updated;
END;
$function$;

-- redeem_invite(text)
CREATE OR REPLACE FUNCTION public.redeem_invite(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _invite record;
  _user_id uuid;
BEGIN
  _user_id := public.current_user_id();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO _invite FROM public.organization_invites WHERE token = _token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite link';
  END IF;

  IF _invite.expires_at IS NOT NULL AND _invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invite has expired';
  END IF;

  IF _invite.max_uses IS NOT NULL AND _invite.use_count >= _invite.max_uses THEN
    RAISE EXCEPTION 'Invite has reached maximum uses';
  END IF;

  -- Check if already a member
  IF EXISTS (SELECT 1 FROM public.memberships WHERE user_id = _user_id AND organization_id = _invite.organization_id) THEN
    RAISE EXCEPTION 'You are already a member of this organization';
  END IF;

  -- Ensure profile exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    INSERT INTO public.profiles (id, email)
    SELECT _user_id, u.email FROM auth.users u WHERE u.id = _user_id;
  END IF;

  -- Create membership
  INSERT INTO public.memberships (user_id, organization_id, role)
  VALUES (_user_id, _invite.organization_id, _invite.role);

  -- Increment use count
  UPDATE public.organization_invites SET use_count = use_count + 1 WHERE id = _invite.id;

  RETURN jsonb_build_object(
    'organization_id', _invite.organization_id,
    'role', _invite.role
  );
END;
$function$;

-- remove_tree_share_with_copy(uuid)
CREATE OR REPLACE FUNCTION public.remove_tree_share_with_copy(_share_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tree_id text;
  _org_id uuid;
  _new_tree_id text;
  _new_backlog_id text;
  _new_wi_id text;
  _rec record;
BEGIN
  PERFORM set_config('burnups.skip_history', 'on', true);

  SELECT tree_id, organization_id INTO _tree_id, _org_id
  FROM backlog_tree_shares
  WHERE id = _share_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share not found';
  END IF;

  IF NOT is_tree_admin(public.current_user_id(), _tree_id) AND NOT is_superuser(public.current_user_id()) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  _new_tree_id := _org_id::text || '::' || gen_random_uuid()::text;

  INSERT INTO backlog_trees (id, name, organization_id, rank)
  SELECT _new_tree_id, name, _org_id, rank
  FROM backlog_trees
  WHERE id = _tree_id;

  CREATE TEMP TABLE _backlog_id_map (old_id text, new_id text) ON COMMIT DROP;

  FOR _rec IN
    SELECT id, name, parent_id, rank
    FROM backlogs
    WHERE tree_id = _tree_id
    ORDER BY rank
  LOOP
    _new_backlog_id := _org_id::text || '::' || gen_random_uuid()::text;
    INSERT INTO _backlog_id_map (old_id, new_id) VALUES (_rec.id, _new_backlog_id);

    INSERT INTO backlogs (id, name, tree_id, parent_id, rank, organization_id)
    VALUES (
      _new_backlog_id,
      _rec.name,
      _new_tree_id,
      NULL,
      _rec.rank,
      _org_id
    );
  END LOOP;

  UPDATE backlogs b
  SET parent_id = pm.new_id
  FROM _backlog_id_map bm
  JOIN backlogs orig ON orig.id = bm.old_id
  JOIN _backlog_id_map pm ON pm.old_id = orig.parent_id
  WHERE b.id = bm.new_id
    AND orig.parent_id IS NOT NULL;

  CREATE TEMP TABLE _wi_id_map (old_id text, new_id text) ON COMMIT DROP;

  FOR _rec IN
    SELECT id, title, description, points, status, parent_id, backlog_assignments, rank,
           respawn_enabled, respawn_interval_days, respawn_hour, respawn_minute, respawn_last_triggered_at
    FROM work_items
    WHERE backlog_assignments ? _tree_id
    ORDER BY rank
  LOOP
    _new_wi_id := _org_id::text || '::' || gen_random_uuid()::text;
    INSERT INTO _wi_id_map (old_id, new_id) VALUES (_rec.id, _new_wi_id);

    INSERT INTO work_items (id, title, description, points, status, parent_id,
                            backlog_assignments, rank, organization_id,
                            respawn_enabled, respawn_interval_days, respawn_hour, respawn_minute, respawn_last_triggered_at)
    VALUES (
      _new_wi_id,
      _rec.title,
      _rec.description,
      _rec.points,
      _rec.status,
      NULL,
      jsonb_build_object(
        _new_tree_id,
        COALESCE(
          (SELECT new_id FROM _backlog_id_map WHERE old_id = (_rec.backlog_assignments ->> _tree_id)),
          _rec.backlog_assignments ->> _tree_id
        )
      ),
      _rec.rank,
      _org_id,
      _rec.respawn_enabled,
      _rec.respawn_interval_days,
      _rec.respawn_hour,
      _rec.respawn_minute,
      _rec.respawn_last_triggered_at
    );
  END LOOP;

  UPDATE work_items wi
  SET parent_id = wm.new_id
  FROM _wi_id_map wm_child
  JOIN work_items orig ON orig.id = wm_child.old_id
  JOIN _wi_id_map wm ON wm.old_id = orig.parent_id
  WHERE wi.id = wm_child.new_id
    AND orig.parent_id IS NOT NULL;

  DELETE FROM backlog_tree_shares WHERE id = _share_id;
END;
$function$;

-- rename_work_items_org_prefix(text[],uuid)
CREATE OR REPLACE FUNCTION public.rename_work_items_org_prefix(_item_ids text[], _new_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _old_ids  text[]  := '{}';
  _new_ids  text[]  := '{}';
  _id_map   jsonb   := '{}';
  rec       RECORD;
  _old_id   text;
  _new_id   text;
BEGIN
  PERFORM set_config('burnups.skip_history', 'on', true);

  IF public.current_user_id() IS NOT NULL AND NOT is_superuser(public.current_user_id()) THEN
    IF NOT is_member_of(public.current_user_id(), _new_org_id) THEN
      RAISE EXCEPTION 'Permission denied: not a member of target org';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM work_items wi
      WHERE wi.id = ANY(_item_ids)
        AND NOT is_member_of(public.current_user_id(), wi.organization_id)
    ) THEN
      RAISE EXCEPTION 'Permission denied: not a member of the item-owner org';
    END IF;
  END IF;

  FOR rec IN SELECT id FROM work_items WHERE id = ANY(_item_ids) LOOP
    _old_id := rec.id;
    IF strpos(_old_id, '::') > 0 THEN
      _new_id := _new_org_id::text || '::' || split_part(_old_id, '::', 2);
    ELSE
      _new_id := _new_org_id::text || '::' || _old_id;
    END IF;
    WHILE EXISTS (SELECT 1 FROM work_items WHERE id = _new_id) LOOP
      _new_id := _new_org_id::text || '::wi-' || substring(gen_random_uuid()::text, 1, 8);
    END LOOP;
    _old_ids := _old_ids || _old_id;
    _new_ids := _new_ids || _new_id;
    _id_map  := _id_map  || jsonb_build_object(_old_id, _new_id);
  END LOOP;

  IF array_length(_old_ids, 1) IS NULL THEN
    RETURN _id_map;
  END IF;

  INSERT INTO work_items (
    id, title, description, points, status,
    parent_id, backlog_assignments, rank, organization_id,
    respawn_enabled, respawn_interval_days, respawn_hour, respawn_last_triggered_at
  )
  SELECT
    _id_map ->> wi.id,
    wi.title, wi.description, wi.points, wi.status,
    NULL,
    wi.backlog_assignments, wi.rank, _new_org_id,
    wi.respawn_enabled, wi.respawn_interval_days, wi.respawn_hour, wi.respawn_last_triggered_at
  FROM work_items wi
  WHERE wi.id = ANY(_old_ids);

  UPDATE work_items child
  SET parent_id = _id_map ->> child.parent_id
  WHERE child.id = ANY(_new_ids)
    AND (SELECT parent_id FROM work_items orig WHERE orig.id = (
      SELECT key FROM jsonb_each_text(_id_map) WHERE value = child.id
    )) IS NOT NULL;

  UPDATE work_item_hyperlinks h
  SET work_item_id = _id_map ->> h.work_item_id
  WHERE h.work_item_id = ANY(_old_ids);

  UPDATE work_item_backlog_ranks r
  SET work_item_id = _id_map ->> r.work_item_id
  WHERE r.work_item_id = ANY(_old_ids);

  UPDATE work_item_team_assignments a
  SET work_item_id = _id_map ->> a.work_item_id
  WHERE a.work_item_id = ANY(_old_ids);

  UPDATE label_assignments la
  SET entity_id = _id_map ->> la.entity_id
  WHERE la.entity_type = 'work_item' AND la.entity_id = ANY(_old_ids);

  DELETE FROM work_items WHERE id = ANY(_old_ids);

  RETURN _id_map;
END;
$function$;

-- restore_organization_backup(uuid,jsonb,text)
CREATE OR REPLACE FUNCTION public.restore_organization_backup(_backup_id uuid, _scope jsonb DEFAULT '{"type": "all"}'::jsonb, _mode text DEFAULT 'merge'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org_id uuid;
  _snap jsonb;
  _caller uuid;
  _scope_type text;
  _scope_ids text[];
  _tree_ids text[];
  _backlog_ids text[];
  _work_item_ids text[];
  _counts jsonb := '{}'::jsonb;
  _new_tree_id text;
  _new_backlog_id text;
  _new_wi_id text;
  _rec record;
BEGIN
  PERFORM set_config('burnups.skip_history', 'on', true);
  _caller := public.current_user_id();

  SELECT organization_id, snapshot INTO _org_id, _snap
  FROM public.organization_backups
  WHERE id = _backup_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup not found';
  END IF;

  IF _caller IS NULL OR NOT (
    has_org_role(_caller, _org_id, 'owner'::app_role)
    OR has_org_role(_caller, _org_id, 'admin'::app_role)
    OR is_superuser(_caller)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF _mode NOT IN ('overwrite','merge','copy') THEN
    RAISE EXCEPTION 'Invalid mode: %', _mode;
  END IF;

  _scope_type := COALESCE(_scope->>'type', 'all');
  IF _scope_type NOT IN ('all','trees','backlogs') THEN
    RAISE EXCEPTION 'Invalid scope type: %', _scope_type;
  END IF;

  IF _scope_type IN ('trees','backlogs') THEN
    SELECT array_agg(x) INTO _scope_ids FROM jsonb_array_elements_text(COALESCE(_scope->'ids','[]'::jsonb)) x;
    IF _scope_ids IS NULL OR array_length(_scope_ids,1) = 0 THEN
      RAISE EXCEPTION 'Scope ids required for scope type %', _scope_type;
    END IF;
  END IF;

  IF _scope_type = 'all' THEN
    SELECT array_agg(t->>'id') INTO _tree_ids FROM jsonb_array_elements(_snap->'backlog_trees') t;
    SELECT array_agg(b->>'id') INTO _backlog_ids FROM jsonb_array_elements(_snap->'backlogs') b;
    SELECT array_agg(w->>'id') INTO _work_item_ids FROM jsonb_array_elements(_snap->'work_items') w;
  ELSIF _scope_type = 'trees' THEN
    _tree_ids := _scope_ids;
    SELECT array_agg(b->>'id') INTO _backlog_ids
    FROM jsonb_array_elements(_snap->'backlogs') b
    WHERE (b->>'tree_id') = ANY(_tree_ids);
    SELECT array_agg(w->>'id') INTO _work_item_ids
    FROM jsonb_array_elements(_snap->'work_items') w
    WHERE EXISTS (SELECT 1 FROM unnest(_tree_ids) tid WHERE (w->'backlog_assignments') ? tid);
  ELSE
    _backlog_ids := _scope_ids;
    SELECT array_agg(DISTINCT b->>'tree_id') INTO _tree_ids
    FROM jsonb_array_elements(_snap->'backlogs') b
    WHERE (b->>'id') = ANY(_backlog_ids);
    SELECT array_agg(w->>'id') INTO _work_item_ids
    FROM jsonb_array_elements(_snap->'work_items') w
    WHERE EXISTS (
      SELECT 1 FROM jsonb_each_text(w->'backlog_assignments') kv
      WHERE kv.value = ANY(_backlog_ids)
    );
  END IF;

  _tree_ids := COALESCE(_tree_ids, ARRAY[]::text[]);
  _backlog_ids := COALESCE(_backlog_ids, ARRAY[]::text[]);
  _work_item_ids := COALESCE(_work_item_ids, ARRAY[]::text[]);

  IF _mode = 'overwrite' THEN
    IF array_length(_work_item_ids,1) > 0 THEN
      DELETE FROM label_assignments WHERE organization_id = _org_id AND entity_type = 'work_item' AND entity_id = ANY(_work_item_ids);
      DELETE FROM work_item_hyperlinks WHERE organization_id = _org_id AND work_item_id = ANY(_work_item_ids);
      DELETE FROM work_item_team_assignments WHERE organization_id = _org_id AND work_item_id = ANY(_work_item_ids);
      DELETE FROM work_item_backlog_ranks WHERE organization_id = _org_id AND work_item_id = ANY(_work_item_ids);
      DELETE FROM work_items WHERE organization_id = _org_id AND id = ANY(_work_item_ids);
    END IF;
    IF array_length(_backlog_ids,1) > 0 THEN
      DELETE FROM work_item_backlog_ranks WHERE organization_id = _org_id AND backlog_id = ANY(_backlog_ids);
      DELETE FROM label_assignments WHERE organization_id = _org_id AND entity_type = 'backlog' AND entity_id = ANY(_backlog_ids);
      DELETE FROM backlog_statuses WHERE backlog_id = ANY(_backlog_ids);
      DELETE FROM backlogs WHERE organization_id = _org_id AND id = ANY(_backlog_ids);
    END IF;
    IF _scope_type IN ('all','trees') AND array_length(_tree_ids,1) > 0 THEN
      DELETE FROM backlog_tree_shares WHERE tree_id = ANY(_tree_ids);
      DELETE FROM backlog_trees WHERE organization_id = _org_id AND id = ANY(_tree_ids);
    END IF;
  END IF;

  IF _mode IN ('overwrite','merge') THEN
    IF _scope_type IN ('all','trees') THEN
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlog_trees') t WHERE (t->>'id') = ANY(_tree_ids)
      LOOP
        INSERT INTO backlog_trees (id, name, organization_id, rank)
        VALUES (
          _rec.value->>'id',
          _rec.value->>'name',
          _org_id,
          COALESCE((_rec.value->>'rank')::int, 0)
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          rank = EXCLUDED.rank;
      END LOOP;
    END IF;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlogs') b WHERE (b->>'id') = ANY(_backlog_ids)
    LOOP
      INSERT INTO backlogs (id, name, tree_id, parent_id, rank, organization_id)
      VALUES (
        _rec.value->>'id',
        _rec.value->>'name',
        _rec.value->>'tree_id',
        NULL,
        COALESCE((_rec.value->>'rank')::int, 0),
        _org_id
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        tree_id = EXCLUDED.tree_id,
        rank = EXCLUDED.rank;
    END LOOP;
    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlogs') b WHERE (b->>'id') = ANY(_backlog_ids) AND (b->>'parent_id') IS NOT NULL
    LOOP
      UPDATE backlogs SET parent_id = _rec.value->>'parent_id' WHERE id = _rec.value->>'id';
    END LOOP;

    IF _snap ? 'backlog_statuses' THEN
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlog_statuses') bs WHERE (bs->>'backlog_id') = ANY(_backlog_ids)
      LOOP
        INSERT INTO backlog_statuses (id, backlog_id, key, label, color, rank)
        VALUES (
          (_rec.value->>'id')::uuid,
          _rec.value->>'backlog_id',
          _rec.value->>'key',
          _rec.value->>'label',
          _rec.value->>'color',
          COALESCE((_rec.value->>'rank')::int, 0)
        )
        ON CONFLICT (backlog_id, key) DO UPDATE SET
          label = EXCLUDED.label,
          color = EXCLUDED.color,
          rank = EXCLUDED.rank;
      END LOOP;
    END IF;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids)
    LOOP
      INSERT INTO work_items (id, title, description, points, status, parent_id, backlog_assignments, rank, organization_id,
                              respawn_enabled, respawn_interval_days, respawn_hour, respawn_minute, respawn_last_triggered_at)
      VALUES (
        _rec.value->>'id',
        _rec.value->>'title',
        _rec.value->>'description',
        NULLIF(_rec.value->>'points','')::int,
        COALESCE(_rec.value->>'status','not_started'),
        NULL,
        COALESCE(_rec.value->'backlog_assignments','{}'::jsonb),
        COALESCE((_rec.value->>'rank')::int, 0),
        _org_id,
        COALESCE((_rec.value->>'respawn_enabled')::boolean, false),
        NULLIF(_rec.value->>'respawn_interval_days','')::int,
        NULLIF(_rec.value->>'respawn_hour','')::int,
        NULLIF(_rec.value->>'respawn_minute','')::int,
        NULLIF(_rec.value->>'respawn_last_triggered_at','')::timestamptz
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        points = EXCLUDED.points,
        status = EXCLUDED.status,
        backlog_assignments = EXCLUDED.backlog_assignments,
        rank = EXCLUDED.rank,
        respawn_enabled = EXCLUDED.respawn_enabled,
        respawn_interval_days = EXCLUDED.respawn_interval_days,
        respawn_hour = EXCLUDED.respawn_hour,
        respawn_minute = EXCLUDED.respawn_minute,
        respawn_last_triggered_at = EXCLUDED.respawn_last_triggered_at;
    END LOOP;
    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids) AND (w->>'parent_id') IS NOT NULL
    LOOP
      UPDATE work_items SET parent_id = _rec.value->>'parent_id' WHERE id = _rec.value->>'id';
    END LOOP;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_item_backlog_ranks') r
      WHERE (r->>'work_item_id') = ANY(_work_item_ids) AND (r->>'backlog_id') = ANY(_backlog_ids)
    LOOP
      INSERT INTO work_item_backlog_ranks (id, work_item_id, backlog_id, rank, organization_id)
      VALUES ((_rec.value->>'id')::uuid, _rec.value->>'work_item_id', _rec.value->>'backlog_id',
              COALESCE((_rec.value->>'rank')::int, 0), _org_id)
      ON CONFLICT (id) DO UPDATE SET rank = EXCLUDED.rank;
    END LOOP;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_item_hyperlinks') h WHERE (h->>'work_item_id') = ANY(_work_item_ids)
    LOOP
      INSERT INTO work_item_hyperlinks (id, work_item_id, url, alt_text, rank, organization_id)
      VALUES ((_rec.value->>'id')::uuid, _rec.value->>'work_item_id', _rec.value->>'url',
              COALESCE(_rec.value->>'alt_text',''), COALESCE((_rec.value->>'rank')::int,0), _org_id)
      ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, alt_text = EXCLUDED.alt_text, rank = EXCLUDED.rank;
    END LOOP;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_item_team_assignments') a WHERE (a->>'work_item_id') = ANY(_work_item_ids)
    LOOP
      INSERT INTO work_item_team_assignments (id, work_item_id, team_id, organization_id)
      VALUES ((_rec.value->>'id')::uuid, _rec.value->>'work_item_id', (_rec.value->>'team_id')::uuid, _org_id)
      ON CONFLICT (id) DO NOTHING;
    END LOOP;

    IF _scope_type = 'all' THEN
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'labels')
      LOOP
        INSERT INTO labels (id, name, color, organization_id)
        VALUES ((_rec.value->>'id')::uuid, _rec.value->>'name', COALESCE(_rec.value->>'color','#94a3b8'), _org_id)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color;
      END LOOP;
    END IF;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'label_assignments') la
      WHERE ((la->>'entity_type') = 'work_item' AND (la->>'entity_id') = ANY(_work_item_ids))
         OR ((la->>'entity_type') = 'backlog'   AND (la->>'entity_id') = ANY(_backlog_ids))
    LOOP
      INSERT INTO label_assignments (id, label_id, entity_type, entity_id, organization_id)
      VALUES ((_rec.value->>'id')::uuid, (_rec.value->>'label_id')::uuid,
              _rec.value->>'entity_type', _rec.value->>'entity_id', _org_id)
      ON CONFLICT (id) DO NOTHING;
    END LOOP;

  ELSE
    DECLARE
      _tree_map jsonb := '{}'::jsonb;
      _backlog_map jsonb := '{}'::jsonb;
      _wi_map jsonb := '{}'::jsonb;
      _suffix text := ' (restored ' || to_char(now(),'YYYY-MM-DD HH24:MI') || ')';
      _create_new_trees boolean := (_scope_type IN ('all','trees'));
    BEGIN
      IF _create_new_trees THEN
        FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlog_trees') t WHERE (t->>'id') = ANY(_tree_ids)
        LOOP
          _new_tree_id := _org_id::text || '::' || gen_random_uuid()::text;
          _tree_map := _tree_map || jsonb_build_object(_rec.value->>'id', _new_tree_id);
          INSERT INTO backlog_trees (id, name, organization_id, rank)
          VALUES (_new_tree_id,
                  (_rec.value->>'name') || _suffix,
                  _org_id,
                  COALESCE((_rec.value->>'rank')::int, 0));
        END LOOP;
      END IF;

      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlogs') b WHERE (b->>'id') = ANY(_backlog_ids)
      LOOP
        _new_backlog_id := _org_id::text || '::' || gen_random_uuid()::text;
        _backlog_map := _backlog_map || jsonb_build_object(_rec.value->>'id', _new_backlog_id);
        INSERT INTO backlogs (id, name, tree_id, parent_id, rank, organization_id)
        VALUES (_new_backlog_id,
                (_rec.value->>'name') || (CASE WHEN _scope_type = 'backlogs' THEN _suffix ELSE '' END),
                COALESCE(_tree_map->>(_rec.value->>'tree_id'), _rec.value->>'tree_id'),
                NULL,
                COALESCE((_rec.value->>'rank')::int, 0),
                _org_id);
      END LOOP;
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlogs') b WHERE (b->>'id') = ANY(_backlog_ids) AND (b->>'parent_id') IS NOT NULL
      LOOP
        UPDATE backlogs SET parent_id = COALESCE(_backlog_map->>(_rec.value->>'parent_id'), _rec.value->>'parent_id')
        WHERE id = _backlog_map->>(_rec.value->>'id');
      END LOOP;

      IF _snap ? 'backlog_statuses' THEN
        FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlog_statuses') bs WHERE (bs->>'backlog_id') = ANY(_backlog_ids)
        LOOP
          INSERT INTO backlog_statuses (backlog_id, key, label, color, rank)
          VALUES (
            _backlog_map->>(_rec.value->>'backlog_id'),
            _rec.value->>'key',
            _rec.value->>'label',
            _rec.value->>'color',
            COALESCE((_rec.value->>'rank')::int, 0)
          )
          ON CONFLICT (backlog_id, key) DO UPDATE SET
            label = EXCLUDED.label,
            color = EXCLUDED.color,
            rank = EXCLUDED.rank;
        END LOOP;
      END IF;

      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids)
      LOOP
        _new_wi_id := _org_id::text || '::' || gen_random_uuid()::text;
        _wi_map := _wi_map || jsonb_build_object(_rec.value->>'id', _new_wi_id);

        INSERT INTO work_items (id, title, description, points, status, parent_id, backlog_assignments, rank, organization_id,
                                respawn_enabled, respawn_interval_days, respawn_hour, respawn_minute, respawn_last_triggered_at)
        SELECT
          _new_wi_id,
          _rec.value->>'title',
          _rec.value->>'description',
          NULLIF(_rec.value->>'points','')::int,
          COALESCE(_rec.value->>'status','not_started'),
          NULL,
          COALESCE((
            SELECT jsonb_object_agg(
              COALESCE(_tree_map->>kv.key, kv.key),
              COALESCE(_backlog_map->>kv.value, kv.value)
            )
            FROM jsonb_each_text(_rec.value->'backlog_assignments') kv
          ), '{}'::jsonb),
          COALESCE((_rec.value->>'rank')::int, 0),
          _org_id,
          COALESCE((_rec.value->>'respawn_enabled')::boolean, false),
          NULLIF(_rec.value->>'respawn_interval_days','')::int,
          NULLIF(_rec.value->>'respawn_hour','')::int,
          NULLIF(_rec.value->>'respawn_minute','')::int,
          NULLIF(_rec.value->>'respawn_last_triggered_at','')::timestamptz;
      END LOOP;
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids) AND (w->>'parent_id') IS NOT NULL
      LOOP
        UPDATE work_items SET parent_id = COALESCE(_wi_map->>(_rec.value->>'parent_id'), _rec.value->>'parent_id')
        WHERE id = _wi_map->>(_rec.value->>'id');
      END LOOP;

      INSERT INTO work_item_backlog_ranks (work_item_id, backlog_id, rank, organization_id)
      SELECT
        _wi_map->>(r->>'work_item_id'),
        COALESCE(_backlog_map->>(r->>'backlog_id'), r->>'backlog_id'),
        COALESCE((r->>'rank')::int, 0),
        _org_id
      FROM jsonb_array_elements(_snap->'work_item_backlog_ranks') r
      WHERE (r->>'work_item_id') = ANY(_work_item_ids)
        AND (r->>'backlog_id') = ANY(_backlog_ids);

      INSERT INTO work_item_hyperlinks (work_item_id, url, alt_text, rank, organization_id)
      SELECT _wi_map->>(h->>'work_item_id'),
             h->>'url',
             COALESCE(h->>'alt_text',''),
             COALESCE((h->>'rank')::int,0),
             _org_id
      FROM jsonb_array_elements(_snap->'work_item_hyperlinks') h
      WHERE (h->>'work_item_id') = ANY(_work_item_ids);

      INSERT INTO work_item_team_assignments (work_item_id, team_id, organization_id)
      SELECT _wi_map->>(a->>'work_item_id'), (a->>'team_id')::uuid, _org_id
      FROM jsonb_array_elements(_snap->'work_item_team_assignments') a
      WHERE (a->>'work_item_id') = ANY(_work_item_ids);

      INSERT INTO label_assignments (label_id, entity_type, entity_id, organization_id)
      SELECT
        (la->>'label_id')::uuid,
        la->>'entity_type',
        CASE la->>'entity_type'
          WHEN 'work_item' THEN _wi_map->>(la->>'entity_id')
          WHEN 'backlog'   THEN COALESCE(_backlog_map->>(la->>'entity_id'), la->>'entity_id')
        END,
        _org_id
      FROM jsonb_array_elements(_snap->'label_assignments') la
      WHERE EXISTS (SELECT 1 FROM labels l WHERE l.id = (la->>'label_id')::uuid AND l.organization_id = _org_id)
        AND (
             ((la->>'entity_type') = 'work_item' AND (la->>'entity_id') = ANY(_work_item_ids))
          OR ((la->>'entity_type') = 'backlog'   AND (la->>'entity_id') = ANY(_backlog_ids))
        );
    END;
  END IF;

  _counts := jsonb_build_object(
    'trees', array_length(_tree_ids,1),
    'backlogs', array_length(_backlog_ids,1),
    'work_items', array_length(_work_item_ids,1),
    'mode', _mode,
    'scope', _scope_type
  );

  RETURN _counts;
END;
$function$;
