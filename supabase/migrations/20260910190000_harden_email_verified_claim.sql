-- Parse the email_verified claim without a cast that can raise.
--
-- Clerk renders session-token shortcodes into JSON, and how {{user.email_verified}}
-- arrives depends on how the template is written: a real boolean, the string
-- "true", or -- for a user with no primary email address -- an empty string.
-- The first two survived `::boolean`; the third raised
-- "invalid input syntax for type boolean", which would reach the user as a raw
-- Postgres error instead of the deliberate message below it.
--
-- Only the parse changes; the logic is identical to 20260910181000.

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
