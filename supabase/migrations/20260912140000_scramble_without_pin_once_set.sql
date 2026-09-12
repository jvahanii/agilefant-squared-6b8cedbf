-- Scrambling asks for the PIN only when there isn't one yet.
--
-- That was the intent, but scramble_work_item() always called
-- check_or_set_scramble_pin(), which treats a missing PIN as a wrong one. So
-- the first item scrambled fine — setting the PIN — and every one after it
-- failed with "Wrong PIN".
--
-- Hiding a name needs no permission; reading one back does. So: no PIN yet,
-- the caller must choose one; a PIN already set, none is asked for; and a PIN
-- passed anyway is still checked, so a caller can't quietly set a second one.

CREATE OR REPLACE FUNCTION public.scramble_work_item(_work_item_id text, _scrambled_title text, _pin text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _org uuid;
  _title text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF _scrambled_title IS NULL OR btrim(_scrambled_title) = '' THEN
    RAISE EXCEPTION 'A scrambled title is required';
  END IF;
  IF NOT public.is_work_item_accessible(_uid, _work_item_id) THEN
    RAISE EXCEPTION 'You do not have access to this item';
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_item_scrambles WHERE work_item_id = _work_item_id) THEN
    RAISE EXCEPTION 'This item is already scrambled';
  END IF;

  SELECT organization_id, title INTO _org, _title FROM public.work_items WHERE id = _work_item_id;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'Item not found';
  END IF;

  IF _pin IS NOT NULL OR NOT public.has_scramble_pin(_org) THEN
    PERFORM public.check_or_set_scramble_pin(_uid, _org, _pin);
  END IF;

  INSERT INTO public.work_item_scrambles (work_item_id, organization_id, scrambled_by, original_title)
  VALUES (_work_item_id, _org, _uid, _title);

  PERFORM set_config('app.scrambling', 'on', true);
  UPDATE public.work_items SET title = _scrambled_title WHERE id = _work_item_id;
  UPDATE public.work_item_history SET title = _scrambled_title WHERE work_item_id = _work_item_id;
  UPDATE public.change_log SET entity_name = _scrambled_title
   WHERE entity_type = 'work_item' AND entity_id = _work_item_id;
  PERFORM set_config('app.scrambling', 'off', true);
END;
$function$;
