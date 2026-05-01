-- Attach existing check_profile_update function as a BEFORE UPDATE trigger on profiles
-- to prevent any user from toggling is_superuser via UPDATE. The WITH CHECK in the
-- RLS policy already prevents setting is_superuser=true on insert/update, but adding
-- a trigger provides defense-in-depth: even SECURITY DEFINER functions or future RLS
-- policy changes cannot accidentally allow privilege escalation.

DROP TRIGGER IF EXISTS prevent_superuser_change ON public.profiles;

CREATE TRIGGER prevent_superuser_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.check_profile_update();