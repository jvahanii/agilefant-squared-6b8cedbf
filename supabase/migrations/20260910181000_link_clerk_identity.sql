-- Give a Clerk session a profile: link it to an existing one, or create it.
--
-- current_user_id() answers "which profile is this?" and returns NULL when
-- nothing claims the Clerk subject. That is the right answer for a read, but it
-- leaves a genuinely new user with nowhere to go -- no profile means no
-- membership, so onboarding never runs. This is the one place allowed to make
-- that claim, called once when a Clerk session first appears.
--
-- Claiming a profile by email means anyone who can prove control of an address
-- inherits the profile using it. That is the same trust model as password reset
-- by email, which is why email_verified is mandatory here rather than
-- advisory -- and it is what lets the remaining Supabase users migrate
-- themselves later, one sign-in at a time, without an import.
--
-- The clerk_id IS NULL guard is what stops an already-linked profile being
-- taken over. A second Clerk account using an address that is already claimed
-- gets its own empty profile instead, which is the safe outcome rather than the
-- tidy one.

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
  _verified boolean := coalesce((_claims ->> 'email_verified')::boolean, false);
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

  -- A Supabase session reaching this point already has a profile keyed on its
  -- own uuid, so there is nothing to link and nothing to create.
  IF _sub ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN _sub::uuid;
  END IF;

  IF _email IS NULL OR NOT _verified THEN
    RAISE EXCEPTION 'A verified email address is required to link this account';
  END IF;

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
    -- Another call inserted first; the partial unique index on clerk_id caught
    -- it. Take whichever row won.
    SELECT id INTO _id FROM public.profiles WHERE clerk_id = _sub;
  END;

  RETURN _id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.link_clerk_identity() TO authenticated;

-- redeem_invite seeded a missing profile by reading auth.users, a table a
-- Clerk-native user never appears in -- it would have inserted a profile with a
-- NULL email. link_clerk_identity() now guarantees the profile exists before
-- any RPC runs, so say so plainly instead of half-creating one.
CREATE OR REPLACE FUNCTION public.redeem_invite(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _invite record;
  _user_id uuid;
BEGIN
  _user_id := public.current_user_id();
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO _invite FROM public.organization_invites WHERE token = _token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite link';
  END IF;

  IF _invite.expires_at IS NOT NULL AND _invite.expires_at < now() THEN
    RAISE EXCEPTION 'Invite has expired';
  END IF;

  IF _invite.max_uses IS NOT NULL AND _invite.use_count >= _invite.max_uses THEN
    RAISE EXCEPTION 'Invite has reached maximum uses';
  END IF;

  -- Check if already a member
  IF EXISTS (SELECT 1 FROM public.memberships WHERE user_id = _user_id AND organization_id = _invite.organization_id) THEN
    RAISE EXCEPTION 'You are already a member of this organization';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    RAISE EXCEPTION 'Your profile is not set up yet. Please sign out and sign in again.';
  END IF;

  -- Create membership
  INSERT INTO public.memberships (user_id, organization_id, role)
  VALUES (_user_id, _invite.organization_id, _invite.role);

  -- Increment use count
  UPDATE public.organization_invites SET use_count = use_count + 1 WHERE id = _invite.id;

  RETURN jsonb_build_object(
    'organization_id', _invite.organization_id,
    'role', _invite.role
  );
END;
$function$;
