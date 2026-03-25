
-- Fix profiles UPDATE policy to prevent is_superuser self-escalation
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;

CREATE POLICY "Users can update own profile" ON public.profiles
FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid() AND is_superuser IS NOT TRUE);
