-- Signed-out callers can no longer change data.
--
-- Supabase's security check (2026-11-12) found 50 SECURITY DEFINER functions
-- that the anon role, anyone holding the public key, could call. Most refuse a
-- caller who is not signed in, or are trigger functions that do nothing when
-- called directly. Two did not:
--
-- * rename_work_items_org_prefix checked its caller only when there was one.
--   Signed out, it moved any items it was given into any organization, and
--   get_published_backlog hands out item ids to whoever holds a public link.
-- * create_organization_with_owner made whatever user id it was given the
--   owner of a new organization, for anyone.
--
-- Both now require the signed-in caller, as the app always is when it calls
-- them, unless the call comes from the server itself (the service role key or
-- a direct database session). And signed-out callers lose EXECUTE on every
-- SECURITY DEFINER function except the two a public link page needs, now and
-- for functions made later.

-- The server itself: the service role key, or a session that did not come in
-- through the Data API (migrations, cron, the SQL editor). Inlined in each
-- function rather than shared, so as not to add one more function to grant.
--   session_user <> 'authenticator' OR auth.role() = 'service_role'

CREATE OR REPLACE FUNCTION public.create_organization_with_owner(_name text, _slug text, _user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org_id uuid;
  _caller uuid := public.current_user_id();
BEGIN
  -- The owner is the caller. The parameter stays for the app's call, which
  -- always names the caller; any other id is refused.
  IF (_caller IS NULL OR _caller IS DISTINCT FROM _user_id)
     AND session_user = 'authenticator' AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Permission denied: an organization can only be created for yourself'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.organizations (name, slug)
  VALUES (_name, _slug)
  RETURNING id INTO _org_id;

  INSERT INTO public.memberships (user_id, organization_id, role)
  VALUES (_user_id, _org_id, 'owner');

  RETURN _org_id;
END;
$function$;

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

  -- Nobody signed in: only the server itself may go on. This used to skip
  -- every check below, so anyone could move any items into any organization.
  IF public.current_user_id() IS NULL
     AND session_user = 'authenticator' AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Permission denied: sign in first' USING ERRCODE = '42501';
  END IF;

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

-- The four policies of each of two tables were written for every role (TO public),
-- so a signed-out query on them runs their checks. Signed out, they never let
-- anything through; for signed-in users nothing changes. Given to signed-in
-- users only, a signed-out query finds nothing, as before, instead of being
-- refused the functions the checks call.
ALTER POLICY delete_backlog_statuses ON public.backlog_statuses TO authenticated;
ALTER POLICY insert_backlog_statuses ON public.backlog_statuses TO authenticated;
ALTER POLICY select_backlog_statuses ON public.backlog_statuses TO authenticated;
ALTER POLICY update_backlog_statuses ON public.backlog_statuses TO authenticated;
ALTER POLICY "Org members and shared can delete board ranks" ON public.work_item_board_ranks TO authenticated;
ALTER POLICY "Org members and shared can read board ranks" ON public.work_item_board_ranks TO authenticated;
ALTER POLICY "Org members and shared can update board ranks" ON public.work_item_board_ranks TO authenticated;
ALTER POLICY "Org members can insert board ranks" ON public.work_item_board_ranks TO authenticated;

-- Every SECURITY DEFINER function: no longer for everyone (PUBLIC) or for the
-- signed-out (anon). Signed-in users and the service role keep exactly what
-- they could call before: what they had through PUBLIC alone is granted to
-- them directly before PUBLIC goes. Trigger
-- functions need no grant to fire.
DO $grants$
DECLARE
  f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure::text AS sig,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS for_users,
           has_function_privilege('service_role', p.oid, 'EXECUTE') AS for_server
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.prosecdef
  LOOP
    IF f.for_users THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f.sig); END IF;
    IF f.for_server THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig); END IF;
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f.sig);
  END LOOP;
END
$grants$;

-- What a public link page calls, signed out: see AUTH.md, "Public links".
GRANT EXECUTE ON FUNCTION public.get_published_backlog(text) TO anon;
GRANT EXECUTE ON FUNCTION public.get_published_link_features(text) TO anon;

-- Functions made from now on: not for everyone, and not for the signed-out.
-- Signed-in users and the service role still get them by default in public,
-- as they always have; a function meant for the signed-out says so with its
-- own GRANT ... TO anon, as tables have had to since 2026-10-30.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;
