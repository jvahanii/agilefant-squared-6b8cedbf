
CREATE TABLE public.organization_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  token text NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex') UNIQUE,
  role app_role NOT NULL DEFAULT 'member',
  expires_at timestamp with time zone,
  max_uses integer,
  use_count integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_organization_invites_token ON public.organization_invites(token);
CREATE INDEX idx_organization_invites_org ON public.organization_invites(organization_id);

-- Admins/owners/superusers can create invites
CREATE POLICY "Admins can insert invites"
  ON public.organization_invites FOR INSERT
  TO authenticated
  WITH CHECK (
    has_org_role(auth.uid(), organization_id, 'owner') OR
    has_org_role(auth.uid(), organization_id, 'admin') OR
    is_superuser(auth.uid())
  );

-- Org members can read invites
CREATE POLICY "Org members can read invites"
  ON public.organization_invites FOR SELECT
  TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid())
  );

-- Admins/owners/superusers can update invites
CREATE POLICY "Admins can update invites"
  ON public.organization_invites FOR UPDATE
  TO authenticated
  USING (
    has_org_role(auth.uid(), organization_id, 'owner') OR
    has_org_role(auth.uid(), organization_id, 'admin') OR
    is_superuser(auth.uid())
  );

-- Admins/owners/superusers can delete invites
CREATE POLICY "Admins can delete invites"
  ON public.organization_invites FOR DELETE
  TO authenticated
  USING (
    has_org_role(auth.uid(), organization_id, 'owner') OR
    has_org_role(auth.uid(), organization_id, 'admin') OR
    is_superuser(auth.uid())
  );

-- Function to redeem an invite token (called by the invitee)
CREATE OR REPLACE FUNCTION public.redeem_invite(_token text)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  _invite record;
  _user_id uuid;
BEGIN
  _user_id := auth.uid();
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

  -- Ensure profile exists
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _user_id) THEN
    INSERT INTO public.profiles (id, email)
    SELECT _user_id, u.email FROM auth.users u WHERE u.id = _user_id;
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
$$;
