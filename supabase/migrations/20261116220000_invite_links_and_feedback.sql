-- Two things for new users (2026-11-16).
--
-- 1. Invite links. A team's owner could add colleagues only by email, and
--    only once those colleagues had signed up themselves: none of the 34
--    people who signed up from August to mid-November shared an
--    organisation. An owner or admin can now make an invite link in Team
--    settings; whoever opens it and signs up or in becomes a member.
--    A new link replaces the old one; turning it off stops it working.
--
--    Built on the organization_invites table and its row rules that the
--    database already had (from before 20260910123000), unused by the app
--    until now: token, role, expires_at, max_uses, use_count. A link is
--    turned off by setting expires_at; one that has not expired and is not
--    used up works. redeem_invite() stays as it was.
--
-- 2. "What were you hoping Agilefant would do?", asked once when someone
--    closes the getting-started panel. With about three sign-ups a week the
--    counts move slowly; a few sentences say more.

CREATE TABLE public.onboarding_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  answer text NOT NULL CHECK (length(answer) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Read and written only by the functions below.
ALTER TABLE public.onboarding_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.onboarding_feedback FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_feedback TO service_role;

-- Whether an invite still works.
CREATE OR REPLACE FUNCTION public.invite_works(_invite public.organization_invites)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT (_invite.expires_at IS NULL OR _invite.expires_at > now())
     AND (_invite.max_uses IS NULL OR _invite.use_count < _invite.max_uses)
$function$;

-- Whether the caller is an owner or admin of the organisation.
CREATE OR REPLACE FUNCTION public.can_manage_invites(_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships m
     WHERE m.user_id = public.current_user_id()
       AND m.organization_id = _organization_id
       AND m.role IN ('owner', 'admin'))
$function$;
REVOKE EXECUTE ON FUNCTION public.can_manage_invites(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.invite_works(public.organization_invites) FROM PUBLIC, anon;

-- The organisation's working invite link token, or null when it has none.
CREATE OR REPLACE FUNCTION public.get_invite_link(_organization_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_manage_invites(_organization_id) THEN
    RAISE EXCEPTION 'Only an owner or admin can see the invite link' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT i.token FROM public.organization_invites i
           WHERE i.organization_id = _organization_id AND public.invite_works(i)
           ORDER BY i.created_at DESC LIMIT 1);
END;
$function$;

-- A new link, which replaces the old one.
CREATE OR REPLACE FUNCTION public.create_invite_link(_organization_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _token text;
BEGIN
  IF NOT public.can_manage_invites(_organization_id) THEN
    RAISE EXCEPTION 'Only an owner or admin can make an invite link' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organization_invites i SET expires_at = now()
   WHERE i.organization_id = _organization_id AND public.invite_works(i);
  INSERT INTO public.organization_invites (organization_id, created_by, role)
  VALUES (_organization_id, public.current_user_id(), 'member')
  RETURNING token INTO _token;
  RETURN _token;
END;
$function$;

-- Turns the link off.
CREATE OR REPLACE FUNCTION public.revoke_invite_link(_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.can_manage_invites(_organization_id) THEN
    RAISE EXCEPTION 'Only an owner or admin can turn the invite link off' USING ERRCODE = '42501';
  END IF;
  UPDATE public.organization_invites i SET expires_at = now()
   WHERE i.organization_id = _organization_id AND public.invite_works(i);
END;
$function$;

-- What the invite page shows: the organisation's name, or null for a link
-- that does not work. Anyone with the link may ask: the name is what it invites to.
CREATE OR REPLACE FUNCTION public.get_invite(_token text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('organizationName', o.name)
    FROM public.organization_invites i
    JOIN public.organizations o ON o.id = i.organization_id
   WHERE i.token = _token AND public.invite_works(i) AND length(_token) >= 32
$function$;

-- The signed-in caller joins the link's organisation as a member, unless
-- they belong to it already. Gives the organisation, and whether they joined.
CREATE OR REPLACE FUNCTION public.accept_invite(_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _org uuid;
  _name text;
  _joined boolean := false;
  _invite public.organization_invites%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _invite FROM public.organization_invites i WHERE i.token = _token FOR UPDATE;
  IF NOT FOUND OR NOT public.invite_works(_invite) THEN
    RAISE EXCEPTION 'This invite link no longer works' USING ERRCODE = 'P0002';
  END IF;
  _org := _invite.organization_id;
  SELECT o.name INTO _name FROM public.organizations o WHERE o.id = _org;
  IF NOT EXISTS (SELECT 1 FROM public.memberships WHERE user_id = _uid AND organization_id = _org) THEN
    -- A member, whatever role an older invite named: owners and admins are made in Team settings.
    INSERT INTO public.memberships (user_id, organization_id, role) VALUES (_uid, _org, 'member');
    UPDATE public.organization_invites SET use_count = use_count + 1 WHERE id = _invite.id;
    _joined := true;
  END IF;
  RETURN jsonb_build_object('organizationId', _org, 'organizationName', _name, 'joined', _joined);
END;
$function$;

-- One answer to "What were you hoping Agilefant would do?".
CREATE OR REPLACE FUNCTION public.send_onboarding_feedback(_organization_id uuid, _answer text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first' USING ERRCODE = '42501';
  END IF;
  IF _answer IS NULL OR length(btrim(_answer)) = 0 THEN
    RETURN;
  END IF;
  INSERT INTO public.onboarding_feedback (user_id, organization_id, answer)
  VALUES (
    _uid,
    CASE WHEN public.is_member_of(_uid, _organization_id) THEN _organization_id END,
    left(btrim(_answer), 2000));
END;
$function$;

-- Signed-in users only, except the invite page's own question.
REVOKE EXECUTE ON FUNCTION public.get_invite_link(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_invite_link(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_invite_link(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.accept_invite(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.send_onboarding_feedback(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_invite_link(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_invite_link(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_invite_link(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.accept_invite(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.send_onboarding_feedback(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_invite(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
