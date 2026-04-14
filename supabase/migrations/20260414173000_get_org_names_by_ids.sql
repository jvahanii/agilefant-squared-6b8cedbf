CREATE OR REPLACE FUNCTION public.get_org_names_by_ids(_ids uuid[])
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT o.id, o.name
  FROM public.organizations o
  WHERE o.id = ANY(_ids);
$$;
