
-- Update is_superuser() to read from JWT app_metadata instead of profiles table
CREATE OR REPLACE FUNCTION public.is_superuser(_user_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'is_superuser')::boolean,
    false
  )
$$;
