
-- 1. Restrict get_user_memberships to caller or superuser
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
    AND (_user_id = auth.uid() OR public.is_superuser(auth.uid()))
$function$;

-- 2. Tighten create_organization_backup: reject null callers from anon role
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
  -- Require an authenticated user OR service-role context (no auth.uid + service role bypass via REVOKE below)
  IF _caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT (is_member_of(_caller, _org_id) OR is_superuser(_caller)) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  _snap := build_organization_snapshot(_org_id);

  INSERT INTO public.organization_backups (organization_id, created_by, kind, note, size_bytes, snapshot)
  VALUES (_org_id, _caller, COALESCE(_kind, 'auto'), _note, octet_length(_snap::text), _snap)
  RETURNING id INTO _id;

  RETURN _id;
END;
$function$;

-- Revoke EXECUTE from anon (service role still works as it bypasses)
REVOKE EXECUTE ON FUNCTION public.create_organization_backup(uuid, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organization_backup(uuid, text, text) TO authenticated, service_role;

-- 3. Drop the redundant realtime policy with LIKE pattern (topic spoofing risk)
DROP POLICY IF EXISTS "Org members can read org messages" ON realtime.messages;
