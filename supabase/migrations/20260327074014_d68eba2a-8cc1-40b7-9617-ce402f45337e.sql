CREATE OR REPLACE FUNCTION public.is_superuser(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (SELECT is_superuser FROM public.profiles WHERE id = _user_id),
    false
  )
$$;