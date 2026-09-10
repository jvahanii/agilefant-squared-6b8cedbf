-- A superuser's view of who exists and whether they actually use the app.
--
-- The Manager Screen used to show "recent sign-ins" from a localStorage log,
-- which could only ever record sign-ins that happened in the viewing browser --
-- and then filtered out the one account that signs in there. It was structurally
-- incapable of showing anything.
--
-- This answers the same question from the only place that knows: the database.
-- Counting client-side would mean shipping every time_entries row to the browser
-- purely to take its length, so the counts are aggregated here.
--
-- Note last_activity is the most recent *time entry*, not a sign-in. Sign-in
-- times moved to Clerk with the migration and are no longer visible from here;
-- auth.users.last_sign_in_at is frozen at the cutover.

CREATE OR REPLACE FUNCTION public.superuser_user_overview()
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  is_superuser boolean,
  created_at timestamptz,
  clerk_linked boolean,
  organizations bigint,
  time_entries bigint,
  last_activity timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- SECURITY DEFINER bypasses RLS, so the guard is the only thing standing
  -- between this and every profile in the database.
  IF NOT public.is_superuser(public.current_user_id()) THEN
    RAISE EXCEPTION 'Permission denied: superusers only';
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.is_superuser,
    p.created_at,
    (p.clerk_id IS NOT NULL) AS clerk_linked,
    (SELECT count(*) FROM public.memberships m WHERE m.user_id = p.id) AS organizations,
    (SELECT count(*) FROM public.time_entries t WHERE t.user_id = p.id) AS time_entries,
    (SELECT max(t.created_at) FROM public.time_entries t WHERE t.user_id = p.id) AS last_activity
  FROM public.profiles p
  ORDER BY p.created_at DESC;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.superuser_user_overview() TO authenticated;
