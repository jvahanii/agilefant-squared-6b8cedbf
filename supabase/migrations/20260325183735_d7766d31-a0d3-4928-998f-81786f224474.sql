
-- Create a function that creates an org and adds the creator as owner atomically
CREATE OR REPLACE FUNCTION public.create_organization_with_owner(
  _name text,
  _slug text,
  _user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _org_id uuid;
BEGIN
  INSERT INTO public.organizations (name, slug)
  VALUES (_name, _slug)
  RETURNING id INTO _org_id;

  INSERT INTO public.memberships (user_id, organization_id, role)
  VALUES (_user_id, _org_id, 'owner');

  RETURN _org_id;
END;
$$;
