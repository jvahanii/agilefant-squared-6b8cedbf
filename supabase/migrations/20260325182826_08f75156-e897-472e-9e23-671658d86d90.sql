
DROP POLICY "System can insert profiles" ON public.profiles;

CREATE POLICY "System can insert profiles" ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (
  auth.uid() = id
  AND is_superuser IS NOT TRUE
);
