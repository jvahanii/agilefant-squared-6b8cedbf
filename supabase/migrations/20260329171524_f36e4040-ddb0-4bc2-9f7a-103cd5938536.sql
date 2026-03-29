
CREATE OR REPLACE FUNCTION public.check_profile_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_superuser IS DISTINCT FROM OLD.is_superuser THEN
    RAISE EXCEPTION 'is_superuser-kentän muuttaminen on kielletty turvallisuussyistä.';
  END IF;
  RETURN NEW;
END;
$function$;
