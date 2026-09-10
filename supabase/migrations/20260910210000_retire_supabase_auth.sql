-- Retire Supabase Auth from the database.
--
-- Clerk is the only way in: the sign-in page, the legacy form and the password
-- recovery route are gone from the frontend, and Supabase sign-ups are disabled
-- in the project settings. What is left here is the machinery that still
-- assumed a Supabase session could exist.
--
-- 1. current_user_id() accepted a raw uuid subject, because a Supabase JWT's
--    `sub` *is* the profiles.id. No token like that can be issued any more, and
--    keeping the branch would mean anything that could mint one still resolved
--    to a real user.
-- 2. handle_new_user() created a profile whenever a row appeared in auth.users.
--    No row ever will again -- link_clerk_identity() is the only path that
--    creates a profile now.
-- 3. cleanup_orphaned_users() deleted from auth.users, which no longer removes
--    anyone's ability to sign in. The Clerk account is what matters, and that
--    has to be deleted through Clerk.
--
-- The auth.users rows themselves are deliberately left alone: they are the only
-- record of which email address owned which profile before the migration, they
-- cost nothing, and nothing reads them.

-- 1 ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT p.id
    FROM public.profiles p
   WHERE p.clerk_id IS NOT NULL
     AND p.clerk_id = (auth.jwt() ->> 'sub')
$function$;

-- link_clerk_identity() had the same shortcut, for the same reason.
CREATE OR REPLACE FUNCTION public.link_clerk_identity()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _claims jsonb := auth.jwt();
  _sub text := _claims ->> 'sub';
  _email text := lower(nullif(_claims ->> 'email', ''));
  _verified boolean := lower(coalesce(_claims ->> 'email_verified', '')) IN ('true', 't', 'yes', '1');
  _id uuid;
BEGIN
  IF _sub IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- Already linked, including the case where two tabs raced to call this.
  SELECT id INTO _id FROM public.profiles WHERE clerk_id = _sub;
  IF _id IS NOT NULL THEN
    RETURN _id;
  END IF;

  IF _email IS NULL OR NOT _verified THEN
    RAISE EXCEPTION 'A verified email address is required to link this account';
  END IF;

  -- Claiming by verified email is what lets a user who has never signed in
  -- through Clerk pick up the profile they already had. The clerk_id IS NULL
  -- guard is what stops a second account taking over one already claimed.
  UPDATE public.profiles
     SET clerk_id = _sub
   WHERE lower(email) = _email
     AND clerk_id IS NULL
  RETURNING id INTO _id;
  IF _id IS NOT NULL THEN
    RETURN _id;
  END IF;

  BEGIN
    INSERT INTO public.profiles (id, email, full_name, avatar_url, clerk_id)
    VALUES (
      gen_random_uuid(),
      _email,
      coalesce(nullif(_claims ->> 'name', ''), nullif(_claims ->> 'full_name', ''), ''),
      coalesce(nullif(_claims ->> 'picture', ''), nullif(_claims ->> 'image_url', ''), ''),
      _sub
    )
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO _id FROM public.profiles WHERE clerk_id = _sub;
  END;

  RETURN _id;
END;
$function$;

-- 2 ────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user();

-- 3 ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_users(p_user_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid;
BEGIN
  -- Only superusers may invoke this function for arbitrary users
  IF NOT is_superuser(public.current_user_id()) THEN
    -- Non-superusers can only clean up their own account
    IF NOT (public.current_user_id() = ANY(p_user_ids)) THEN
      RAISE EXCEPTION 'Permission denied: only superusers can clean up orphaned users';
    END IF;
    -- Narrow the array to just the caller's own UID
    p_user_ids := ARRAY[public.current_user_id()];
  END IF;

  FOREACH _uid IN ARRAY p_user_ids
  LOOP
    -- Skip superusers
    IF is_superuser(_uid) THEN
      CONTINUE;
    END IF;

    -- Skip users who still have memberships
    IF EXISTS (SELECT 1 FROM public.memberships WHERE user_id = _uid) THEN
      CONTINUE;
    END IF;

    -- Deleting the profile is what removes the account: every table keys on
    -- profiles.id, and the Clerk account it was linked to can only be deleted
    -- through Clerk. This used to delete from auth.users too, which no longer
    -- takes anyone's access away.
    DELETE FROM public.profiles WHERE id = _uid;
  END LOOP;
END;
$function$;
