-- A superuser's rights hold only in a session whose sign-in had a second
-- factor. A superuser can read and change every organisation, so a password
-- alone — leaked, guessed or reused — must not be enough.
--
-- Clerk records it in the session token: fva = [minutes since the first
-- factor, minutes since the second], the second -1 when none was verified.
-- Signing in with Google counts as both (Google does its own checking); a
-- password counts as both only together with an authenticator-app code.
--
-- The rule applies to the caller's own rights only. Asked about someone else
-- — "is the account I am about to remove a superuser?" — is_superuser answers
-- from the profile as before, and so do calls with no signed-in user (cron,
-- service role), whose token has no Clerk subject.

CREATE OR REPLACE FUNCTION public.is_superuser(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((
    SELECT p.is_superuser
       AND (
         p.clerk_id IS DISTINCT FROM (auth.jwt() ->> 'sub')
         OR (
           jsonb_typeof(auth.jwt() -> 'fva' -> 1) = 'number'
           AND (auth.jwt() -> 'fva' ->> 1)::numeric >= 0
         )
       )
    FROM public.profiles p
    WHERE p.id = _user_id
  ), false)
$function$;

-- What the app shows: whether the caller is a superuser in this session, and
-- whether they would be with a second factor.
CREATE OR REPLACE FUNCTION public.my_superuser_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'is_superuser', public.is_superuser(p.id),
    'needs_second_factor', p.is_superuser AND NOT public.is_superuser(p.id)
  )
  FROM public.profiles p
  WHERE p.id = public.current_user_id()
$function$;

REVOKE EXECUTE ON FUNCTION public.my_superuser_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_superuser_status() TO authenticated, service_role;

-- delete_my_account refuses to delete a superuser. That protects the account,
-- so it reads the profile itself: through is_superuser, a password-only
-- session would no longer count as a superuser and could delete it.
DO $do$
DECLARE
  _def text := pg_get_functiondef('public.delete_my_account()'::regprocedure);
  _old text := 'IF public.is_superuser(_me) THEN';
  _new text := 'IF coalesce((SELECT p.is_superuser FROM public.profiles p WHERE p.id = _me), false) THEN';
BEGIN
  IF (length(_def) - length(replace(_def, _old, ''))) / length(_old) <> 1 THEN
    RAISE EXCEPTION 'delete_my_account: expected exactly one superuser check to replace';
  END IF;
  EXECUTE replace(_def, _old, _new);
END
$do$;
