-- Fix automatic org data backups.
--
-- Root cause 1: create_organization_backup raised 'Authentication required'
-- whenever auth.uid() was NULL.  The edge function (daily-backup) invokes this
-- RPC via an admin/service-role client, which always produces a NULL auth.uid().
-- The original intent (see migration 20260502065339 comment) was to allow
-- service-role / pg-cron calls; the implementation never matched that intent.
--
-- Root cause 2: The cron job fetched the service_role_key from
-- vault.decrypted_secrets.  If that secret was not seeded in the project vault
-- the Authorization header was NULL, causing the edge function to return 401
-- before the RPC was ever called.
--
-- Fix: (a) Allow NULL auth.uid() in create_organization_backup – role checks
-- only apply when a real user session is present.  (b) Reschedule the cron job
-- to call create_organization_backup directly in SQL, removing the vault
-- dependency and the edge-function round-trip entirely.

-- (a) Fix create_organization_backup ----------------------------------------
CREATE OR REPLACE FUNCTION public.create_organization_backup(
  _org_id uuid,
  _kind   text DEFAULT 'auto'::text,
  _note   text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _snap   jsonb;
  _id     uuid;
  _caller uuid;
BEGIN
  _caller := auth.uid();

  -- For authenticated user sessions, verify the caller has owner/admin rights.
  -- NULL uid means a system/service-role call (pg_cron or edge-function admin
  -- client); those are trusted and skip the per-user role check.
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

-- (b) Reschedule cron job to call the function directly ---------------------
-- The previous job called the daily-backup edge function over HTTP using a
-- service_role_key read from vault.  Calling the SQL function directly is more
-- reliable: no vault secret required, no network round-trip, no 401 risk.
DO $$
BEGIN
  PERFORM cron.unschedule('daily-organization-backup');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'daily-organization-backup',
  '15 3 * * *',
  $$
    SELECT public.create_organization_backup(id, 'auto', NULL)
    FROM public.organizations;
  $$
);
