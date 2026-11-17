-- The nightly backup skips organisations that have not changed (2026-11-17).
--
-- daily-backup snapshotted every organisation every night, changed or not:
-- most of the people who signed up are not active, so most of the 45 MB of
-- backups were the same snapshot again, each one a read of the whole
-- organisation and a write of all of it, on an instance short of disk
-- budget. apply_retention() already keeps an unchanged organisation's newest
-- backup ("An organization that stopped changing is backed up no more");
-- now that is what happens. "Back up now" in Team settings still always backs up.

-- Whether anything a snapshot holds may have changed since then. Leans
-- towards yes: a change it cannot see is caught by the next one it can.
CREATE OR REPLACE FUNCTION public.organization_changed_since(_org_id uuid, _since timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.change_log c WHERE c.organization_id = _org_id AND c.created_at > _since)
      OR EXISTS (SELECT 1 FROM public.work_items w WHERE w.organization_id = _org_id AND w.changed_at > _since)
      OR EXISTS (SELECT 1 FROM public.work_item_hyperlinks h WHERE h.organization_id = _org_id AND h.changed_at > _since)
      OR EXISTS (SELECT 1 FROM public.work_item_backlog_ranks r WHERE r.organization_id = _org_id AND r.changed_at > _since)
      OR EXISTS (SELECT 1 FROM public.work_item_board_ranks r WHERE r.organization_id = _org_id AND r.changed_at > _since)
      OR EXISTS (SELECT 1 FROM public.row_deletions d WHERE d.organization_id = _org_id AND d.deleted_at > _since)
      OR EXISTS (SELECT 1 FROM public.time_entries t WHERE t.organization_id = _org_id AND t.created_at > _since)
      OR EXISTS (SELECT 1 FROM public.labels l WHERE l.organization_id = _org_id AND l.updated_at > _since)
      OR EXISTS (SELECT 1 FROM public.backlog_statuses s JOIN public.backlogs b ON b.id = s.backlog_id
                  WHERE b.organization_id = _org_id AND s.updated_at > _since)
$function$;

-- The nightly backup of one organisation: a new one only when it has none,
-- or something changed since its newest. Gives the backup's id, or null when
-- none was needed.
CREATE OR REPLACE FUNCTION public.create_organization_backup_if_changed(_org_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _last timestamptz;
BEGIN
  SELECT max(b.created_at) INTO _last FROM public.organization_backups b WHERE b.organization_id = _org_id;
  -- An hour's margin: a change whose transaction began before the backup's
  -- and committed after it carries a time from before the backup but is not
  -- in it. Such an organisation is simply backed up once more.
  IF _last IS NOT NULL AND NOT public.organization_changed_since(_org_id, _last - interval '1 hour') THEN
    RETURN NULL;
  END IF;
  RETURN public.create_organization_backup(_org_id, 'auto', NULL);
END;
$function$;

-- For the nightly job only, which calls with the service role.
REVOKE EXECUTE ON FUNCTION public.organization_changed_since(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_organization_backup_if_changed(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_organization_backup_if_changed(uuid) TO service_role;
