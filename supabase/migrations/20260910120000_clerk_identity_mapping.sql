-- Identity mapping for the move to Clerk authentication.
--
-- auth.uid() cannot be used with Clerk: it casts the JWT's sub claim to uuid,
-- and Clerk user ids ("user_2abc...") are not uuids, so it throws. The usual
-- advice is to convert every user_id column to text and key off the Clerk id
-- directly. We deliberately don't: this database has 124 RLS policies and 11
-- functions built on uuid identities, and the existing rows must keep working.
--
-- Instead a Clerk user is mapped to the profile row that already exists, so the
-- uuid stays the identity everywhere downstream and no data moves.
--
-- current_user_id() resolves both auth systems, which is what makes the cutover
-- reversible: while Supabase Auth is still live it returns exactly what
-- auth.uid() returned, so replacing auth.uid() with it is a no-op until a Clerk
-- token actually arrives.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS clerk_id text;

-- One Clerk account per profile. Partial, so the 30-odd rows with no Clerk
-- identity yet don't collide on NULL.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_clerk_id_key
  ON public.profiles (clerk_id)
  WHERE clerk_id IS NOT NULL;

-- SECURITY DEFINER for the same reason as is_member_of/is_superuser: policies on
-- profiles call this, and reading profiles under RLS from inside a policy on
-- profiles would recurse. It only ever returns the caller's own id, so it
-- exposes nothing.
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    -- Clerk: sub is a Clerk user id, mapped to the profile it belongs to.
    (
      SELECT p.id
      FROM public.profiles p
      WHERE p.clerk_id IS NOT NULL
        AND p.clerk_id = (auth.jwt() ->> 'sub')
    ),
    -- Supabase: sub is already the uuid. Guarded rather than delegating to
    -- auth.uid(), which raises on a non-uuid sub instead of returning NULL —
    -- that would surface as an error rather than "not signed in" whenever a
    -- Clerk token has no matching profile.
    CASE
      WHEN (auth.jwt() ->> 'sub') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN (auth.jwt() ->> 'sub')::uuid
    END
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_user_id() TO authenticated, anon, service_role;

COMMENT ON FUNCTION public.current_user_id() IS
  'The signed-in user''s profile id, resolved from either a Clerk or a Supabase JWT. Use instead of auth.uid(), which cannot parse Clerk subject claims.';
COMMENT ON COLUMN public.profiles.clerk_id IS
  'Clerk user id (sub claim) for this profile. NULL until the account is linked.';
