-- A name scrambled with a list remembers which list.
--
-- Unscrambling a list put back what was in the list at that moment. Items
-- that had been scrambled with it and then moved elsewhere -- by hand, or
-- carried along when an item above them was moved -- stayed scrambled, in
-- another list, under names nobody recognised: to the person who had
-- scrambled the list they had simply gone.
--
-- So each scramble now records the list it was made with, and the app asks
-- for those back along with the list, wherever they are. An item scrambled by
-- itself has no such list and is put back by itself, as before.
--
-- The column is readable by clients, like who scrambled a name: it says which
-- list, never what the name was.

ALTER TABLE public.work_item_scrambles
  ADD COLUMN with_backlog_id text REFERENCES public.backlogs(id) ON DELETE SET NULL;
ALTER TABLE public.backlog_scrambles
  ADD COLUMN with_backlog_id text REFERENCES public.backlogs(id) ON DELETE SET NULL;

CREATE INDEX work_item_scrambles_with_backlog_idx
  ON public.work_item_scrambles (with_backlog_id)
  WHERE with_backlog_id IS NOT NULL;

GRANT SELECT (with_backlog_id) ON public.work_item_scrambles TO authenticated;
GRANT SELECT (with_backlog_id) ON public.backlog_scrambles TO authenticated;

-- scramble_names() takes the list the names are being scrambled with. It is a
-- new last argument with a default, so a page loaded before this still calls
-- it as it did; the old three-argument function has to go first, or the two
-- would stand side by side.
DROP FUNCTION public.scramble_names(jsonb, jsonb, text);

-- Scramble many names at once (see 20261009120000 for the rest of it).
--
--   _with_list  the list being scrambled, when the names are scrambled as
--               part of one: recorded on every item, and on every list under
--               it, so that unscrambling that list can find them again. Left
--               out, or naming a list the caller cannot reach, nothing is
--               recorded.
CREATE FUNCTION public.scramble_names(_lists jsonb, _items jsonb, _pin text DEFAULT NULL, _with_list text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _do_lists jsonb;
  _do_items jsonb;
  _org uuid;
  _with text := _with_list;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF _with IS NOT NULL AND NOT public.is_backlog_accessible(_uid, _with) THEN
    _with := NULL;
  END IF;

  WITH wanted AS (
    SELECT DISTINCT ON (e->>'id') e->>'id' AS id, e->>'name' AS name
      FROM jsonb_array_elements(coalesce(_lists, '[]'::jsonb)) e
     WHERE btrim(coalesce(e->>'name', '')) <> ''
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id,
           'name', w.name,
           'was', b.name,
           'org', coalesce(b.organization_id, t.organization_id))), '[]'::jsonb)
    INTO _do_lists
    FROM wanted w
    JOIN public.backlogs b ON b.id = w.id
    JOIN public.backlog_trees t ON t.id = b.tree_id
   WHERE coalesce(b.organization_id, t.organization_id) IS NOT NULL
     AND public.is_backlog_accessible(_uid, b.id)
     AND NOT EXISTS (SELECT 1 FROM public.backlog_scrambles s WHERE s.backlog_id = b.id);

  WITH wanted AS (
    SELECT DISTINCT ON (e->>'id') e->>'id' AS id, e->>'title' AS title
      FROM jsonb_array_elements(coalesce(_items, '[]'::jsonb)) e
     WHERE btrim(coalesce(e->>'title', '')) <> ''
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', wi.id,
           'title', w.title,
           'was', wi.title,
           'org', wi.organization_id)), '[]'::jsonb)
    INTO _do_items
    FROM wanted w
    JOIN public.work_items wi ON wi.id = w.id
   WHERE wi.organization_id IS NOT NULL
     AND public.is_work_item_accessible(_uid, wi.id)
     AND NOT EXISTS (SELECT 1 FROM public.work_item_scrambles s WHERE s.work_item_id = wi.id);

  -- A first scramble in an organization sets the PIN there, and so needs one.
  FOR _org IN
    SELECT DISTINCT (e->>'org')::uuid
      FROM jsonb_array_elements(_do_lists || _do_items) e
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.scramble_pins WHERE user_id = _uid AND organization_id = _org
    ) THEN
      PERFORM public.check_or_set_scramble_pin(_uid, _org, _pin);
    END IF;
  END LOOP;

  -- The list itself is not "with" itself: only what goes along with it.
  INSERT INTO public.backlog_scrambles (backlog_id, organization_id, scrambled_by, original_name, with_backlog_id)
  SELECT e->>'id', (e->>'org')::uuid, _uid, e->>'was', CASE WHEN e->>'id' = _with THEN NULL ELSE _with END
    FROM jsonb_array_elements(_do_lists) e;

  INSERT INTO public.work_item_scrambles (work_item_id, organization_id, scrambled_by, original_title, with_backlog_id)
  SELECT e->>'id', (e->>'org')::uuid, _uid, e->>'was', _with
    FROM jsonb_array_elements(_do_items) e;

  PERFORM set_config('app.scrambling', 'on', true);

  UPDATE public.backlogs b
     SET name = e->>'name'
    FROM jsonb_array_elements(_do_lists) e
   WHERE b.id = e->>'id';
  UPDATE public.change_log c
     SET entity_name = e->>'name',
         details = CASE WHEN c.action = 'Rename' THEN NULL ELSE c.details END
    FROM jsonb_array_elements(_do_lists) e
   WHERE c.entity_type = 'backlog' AND c.entity_id = e->>'id';

  UPDATE public.work_items wi
     SET title = e->>'title'
    FROM jsonb_array_elements(_do_items) e
   WHERE wi.id = e->>'id';
  UPDATE public.work_item_history h
     SET title = e->>'title'
    FROM jsonb_array_elements(_do_items) e
   WHERE h.work_item_id = e->>'id';
  UPDATE public.change_log c
     SET entity_name = e->>'title',
         details = CASE WHEN c.action = 'Rename' THEN NULL ELSE c.details END
    FROM jsonb_array_elements(_do_items) e
   WHERE c.entity_type = 'work_item' AND c.entity_id = e->>'id';

  PERFORM set_config('app.scrambling', 'off', true);

  RETURN jsonb_build_object(
    'lists', (SELECT coalesce(jsonb_agg(e->>'id'), '[]'::jsonb) FROM jsonb_array_elements(_do_lists) e),
    'items', (SELECT coalesce(jsonb_agg(e->>'id'), '[]'::jsonb) FROM jsonb_array_elements(_do_items) e)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.scramble_names(jsonb, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scramble_names(jsonb, jsonb, text, text) TO authenticated;
