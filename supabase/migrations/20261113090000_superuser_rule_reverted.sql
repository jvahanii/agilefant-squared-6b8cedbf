-- Undo the second-factor rule in is_superuser (20261112150000). It read
-- Clerk's fva claim, which on this instance says the opposite of what the
-- rule assumed: a password-only session showed fva [n, n] and passed, and a
-- Google sign-in did not, so the superuser lost their rights after signing in
-- with Google. Back to the profile flag until a claim that can be trusted
-- (two-factor enabled, set in Clerk's session token) exists.
--
-- my_superuser_status() stays: the app and edge functions keep asking the
-- database rather than reading the profile, so the rule can be changed in this
-- one function again. needs_second_factor is now always false.

CREATE OR REPLACE FUNCTION public.is_superuser(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(
    (SELECT is_superuser FROM public.profiles WHERE id = _user_id),
    false
  )
$function$;
