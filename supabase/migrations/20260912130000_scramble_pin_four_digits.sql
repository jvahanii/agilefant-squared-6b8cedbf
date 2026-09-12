-- A scramble PIN is exactly four digits.
--
-- It was 4 to 12. Four keeps it a PIN -- something typed quickly in front of
-- other people -- and the dialog can then say plainly what it wants. The check
-- stays here as well as in the field, because the field is not what protects
-- anything.

CREATE OR REPLACE FUNCTION public.check_or_set_scramble_pin(_user_id uuid, _organization_id uuid, _pin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _hash text;
BEGIN
  SELECT pin_hash INTO _hash
    FROM public.scramble_pins
   WHERE user_id = _user_id AND organization_id = _organization_id;

  IF _hash IS NULL THEN
    IF _pin IS NULL OR _pin !~ '^[0-9]{4}$' THEN
      RAISE EXCEPTION 'Choose a PIN of four digits';
    END IF;
    INSERT INTO public.scramble_pins (user_id, organization_id, pin_hash)
    VALUES (_user_id, _organization_id, extensions.crypt(_pin, extensions.gen_salt('bf')));
    RETURN;
  END IF;

  IF _pin IS NULL OR extensions.crypt(_pin, _hash) <> _hash THEN
    RAISE EXCEPTION 'Wrong PIN';
  END IF;
END;
$function$;
