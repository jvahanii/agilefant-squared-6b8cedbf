-- Deleting your own account, and keeping data no longer than the terms say.
--
-- Until now only a superuser could delete an account, and nothing removed
-- what deleted organizations left behind: sixteen tables carry an
-- organization_id with no foreign key to organizations, so deleting an
-- organization left their rows — logged time, item history, the change log —
-- and every backup of it, a full snapshot, in place for good. On 2026-11-12,
-- three organizations deleted by June still had 36 backups. The change log's
-- 90 days and the backups' 14 days were enforced only when an organization
-- added to them, so an idle organization kept both indefinitely.
--
-- What the terms of service now promise, and what this enforces daily:
--   change log (who changed what)            90 days
--   deleted items, kept for undo              7 days
--   backups                                  14 days, except an organization's
--                                            newest, while it exists
--   a deleted organization's remaining data  with its last backup, 14 days on
--   deletion markers for sync                30 days (row-deletions-prune, as before)

-- Everything of one organization in the tables not tied to it by a foreign
-- key, or, given no organization, of every organization that no longer
-- exists. Found from the catalog, so a table added later is covered without
-- touching this. Backups are left to apply_retention. For the server only.
CREATE OR REPLACE FUNCTION public.delete_organization_leftovers(_org_id uuid DEFAULT NULL)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  t record;
  n integer;
  total integer := 0;
BEGIN
  -- Deleted rows need no burnup snapshots of their own.
  PERFORM set_config('burnups.skip_history', 'on', true);
  FOR t IN
    SELECT c.relname
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
     WHERE c.relnamespace = 'public'::regnamespace
       AND c.relkind = 'r'
       AND a.attname = 'organization_id'
       AND NOT a.attisdropped
       AND c.relname NOT IN ('organizations', 'organization_backups')
       AND NOT EXISTS (SELECT 1 FROM pg_constraint k
                        WHERE k.contype = 'f' AND k.conrelid = c.oid
                          AND k.confrelid = 'public.organizations'::regclass)
     ORDER BY c.relname
  LOOP
    IF _org_id IS NULL THEN
      EXECUTE format(
        'DELETE FROM public.%I x
          WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = x.organization_id)
            AND NOT EXISTS (SELECT 1 FROM public.organization_backups b WHERE b.organization_id = x.organization_id)',
        t.relname);
    ELSE
      EXECUTE format('DELETE FROM public.%I WHERE organization_id = $1', t.relname) USING _org_id;
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    total := total + n;
  END LOOP;
  RETURN total;
END;
$function$;

-- Run daily by pg_cron. For the server only.
CREATE OR REPLACE FUNCTION public.apply_retention()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _change_log integer;
  _deleted_items integer;
  _backups integer;
  _leftovers integer;
BEGIN
  DELETE FROM change_log WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS _change_log = ROW_COUNT;

  DELETE FROM deleted_work_items WHERE deleted_at < now() - interval '7 days';
  GET DIAGNOSTICS _deleted_items = ROW_COUNT;

  -- An organization that stopped changing is backed up no more, and keeps its
  -- newest backup while it exists. A deleted one keeps none past 14 days.
  DELETE FROM organization_backups b
   WHERE b.created_at < now() - interval '14 days'
     AND (NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = b.organization_id)
          OR b.id <> (SELECT b2.id FROM organization_backups b2
                       WHERE b2.organization_id = b.organization_id
                       ORDER BY b2.created_at DESC, b2.id DESC LIMIT 1));
  GET DIAGNOSTICS _backups = ROW_COUNT;

  -- A deleted organization's other data goes with its last backup.
  _leftovers := public.delete_organization_leftovers(NULL);

  RETURN jsonb_build_object('change_log', _change_log, 'deleted_items', _deleted_items,
                            'backups', _backups, 'leftovers', _leftovers);
END;
$function$;

-- Called by a signed-in user, from Team settings, to delete their own account.
--
-- Organizations no one else is in go with the account, all their data at once
-- (backups follow within 14 days). In organizations that carry on, what the
-- person did stays the organization's — the items they made, the time they
-- logged — but no longer tied to a name: the profile goes, and with it the
-- name, email, memberships and team places; the change log forgets their
-- email; their snoozes go.
--
-- Refused, with nothing deleted, when an organization would be left with
-- members but no owner, or when one about to go owns a tree shared with
-- another organization (deleting it there takes the tree from them too — a
-- superuser's organization deletion hands such trees over first).
--
-- The Clerk sign-in is deleted by the app afterwards: only Clerk can.
CREATE OR REPLACE FUNCTION public.delete_my_account()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := public.current_user_id();
  _blocking text;
  _orgs uuid[];
  _org uuid;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  IF public.is_superuser(_me) THEN
    RAISE EXCEPTION 'A superuser account is not deleted from here. Ask another superuser to remove the superuser right first.';
  END IF;

  SELECT o.name INTO _blocking
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
   WHERE m.user_id = _me
     AND m.role = 'owner'
     AND EXISTS (SELECT 1 FROM memberships x WHERE x.organization_id = m.organization_id AND x.user_id <> _me)
     AND NOT EXISTS (SELECT 1 FROM memberships x WHERE x.organization_id = m.organization_id AND x.user_id <> _me AND x.role = 'owner')
   ORDER BY o.name
   LIMIT 1;
  IF _blocking IS NOT NULL THEN
    RAISE EXCEPTION 'You are the only owner of "%". Make another member an owner first.', _blocking;
  END IF;

  SELECT coalesce(array_agg(m.organization_id), '{}') INTO _orgs
    FROM memberships m
   WHERE m.user_id = _me
     AND NOT EXISTS (SELECT 1 FROM memberships x WHERE x.organization_id = m.organization_id AND x.user_id <> _me);

  SELECT o.name INTO _blocking
    FROM organizations o
    JOIN backlog_trees t ON t.organization_id = o.id
    JOIN backlog_tree_shares s ON s.tree_id = t.id
   WHERE o.id = ANY(_orgs) AND s.organization_id <> o.id
   ORDER BY o.name
   LIMIT 1;
  IF _blocking IS NOT NULL THEN
    RAISE EXCEPTION '"%" shares a tree with another organization. Stop sharing it first, or ask for the organization to be deleted.', _blocking;
  END IF;

  PERFORM set_config('burnups.skip_history', 'on', true);
  FOREACH _org IN ARRAY _orgs LOOP
    DELETE FROM organizations WHERE id = _org;
    PERFORM public.delete_organization_leftovers(_org);
  END LOOP;

  UPDATE change_log SET user_email = NULL WHERE user_id = _me AND user_email IS NOT NULL;
  DELETE FROM work_item_snoozes WHERE user_id = _me;
  UPDATE jira_connections SET created_by = NULL WHERE created_by = _me;
  UPDATE deleted_work_items SET deleted_by = NULL WHERE deleted_by = _me;
  UPDATE organization_backups SET created_by = NULL WHERE created_by = _me;
  -- Memberships, team places, Gmail connections and the rest go with it.
  DELETE FROM profiles WHERE id = _me;

  RETURN jsonb_build_object('deleted_organizations', to_jsonb(_orgs));
END;
$function$;

-- New functions are callable by signed-in users by default (20261112090000).
REVOKE EXECUTE ON FUNCTION public.delete_organization_leftovers(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_retention() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.delete_my_account() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;

-- Daily, after the backups (03:15) and the deletion markers (03:40).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'apply-retention';
SELECT cron.schedule('apply-retention', '50 3 * * *', 'SELECT public.apply_retention()');
