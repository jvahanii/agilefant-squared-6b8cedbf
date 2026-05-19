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
  _caller := auth.uid();

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