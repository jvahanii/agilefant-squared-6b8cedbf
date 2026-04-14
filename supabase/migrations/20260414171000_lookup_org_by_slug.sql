-- Security-definer function to look up an organization by slug (case-insensitive).
-- This bypasses RLS so any authenticated user can find an org by its public slug
-- without being a member of that org (needed for the tree-sharing flow, where the
-- sharer needs to resolve another org's slug to get its UUID).
-- Only the org id and name are returned (no sensitive fields).
CREATE OR REPLACE FUNCTION public.lookup_org_by_slug(_slug text)
RETURNS TABLE (id uuid, name text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  RETURN QUERY
    SELECT o.id, o.name
    FROM public.organizations o
    WHERE lower(o.slug) = lower(_slug)
    LIMIT 1;
END;
$$;
