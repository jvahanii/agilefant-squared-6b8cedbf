-- The Manager Screen's organizations with their member and change-log counts,
-- in one request.
--
-- The screen used to read every organization and every membership, and then
-- count each organization's change log with a request of its own: with 70
-- organizations, 72 requests before anything was shown. Each count also ran
-- the change log's access check on every row it counted — 0.67 s of database
-- time for the 70 at best, and many seconds on an instance that stalls under a
-- burst of requests. Counted here, grouped, it is one query.
--
-- A superuser sees every organization and membership under RLS already, so
-- this returns what the screen showed before.

CREATE OR REPLACE FUNCTION public.superuser_org_overview()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  created_at timestamptz,
  member_count bigint,
  action_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- SECURITY DEFINER bypasses RLS, so the guard is the only thing standing
  -- between this and every organization in the database.
  IF NOT public.is_superuser(public.current_user_id()) THEN
    RAISE EXCEPTION 'Permission denied: superusers only';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.name,
    o.slug,
    o.created_at,
    coalesce(m.n, 0) AS member_count,
    coalesce(c.n, 0) AS action_count
  FROM public.organizations o
  LEFT JOIN (
    SELECT mm.organization_id, count(*) AS n FROM public.memberships mm GROUP BY mm.organization_id
  ) m ON m.organization_id = o.id
  LEFT JOIN (
    SELECT cl.organization_id, count(*) AS n FROM public.change_log cl GROUP BY cl.organization_id
  ) c ON c.organization_id = o.id
  ORDER BY o.created_at;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.superuser_org_overview() TO authenticated;
