
CREATE OR REPLACE FUNCTION public.lookup_org_by_slug(_slug text)
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.name
  FROM public.organizations o
  WHERE o.slug = lower(_slug)
  LIMIT 1;
$$;
