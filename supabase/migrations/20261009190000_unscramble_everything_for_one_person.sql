-- One-off, at their own request: put back every name one person has scrambled.
--
-- Ten of their items were scrambled with a list and then carried to another
-- list, where unscrambling the list did not reach them (fixed from here on in
-- 20261009150000). Rather than have them hunt the ten down and enter a PIN,
-- this restores everything of theirs in one go -- items and lists -- exactly
-- as unscramble_names() would: the name, the history, the change log, and
-- then the PIN, which is forgotten once nothing of theirs is scrambled.
--
-- Scoped to that one profile. Nobody else's scrambles are touched.

DO $$
DECLARE
  _who constant uuid := '8036890f-71a3-4aa4-a173-88680c6bb040';
  _items integer;
  _lists integer;
BEGIN
  PERFORM set_config('app.scrambling', 'on', true);

  UPDATE public.work_items w
     SET title = s.original_title
    FROM public.work_item_scrambles s
   WHERE s.work_item_id = w.id AND s.scrambled_by = _who;
  GET DIAGNOSTICS _items = ROW_COUNT;
  UPDATE public.work_item_history h
     SET title = s.original_title
    FROM public.work_item_scrambles s
   WHERE s.work_item_id = h.work_item_id AND s.scrambled_by = _who;
  UPDATE public.change_log c
     SET entity_name = s.original_title
    FROM public.work_item_scrambles s
   WHERE c.entity_type = 'work_item' AND c.entity_id = s.work_item_id AND s.scrambled_by = _who;

  UPDATE public.backlogs b
     SET name = s.original_name
    FROM public.backlog_scrambles s
   WHERE s.backlog_id = b.id AND s.scrambled_by = _who;
  GET DIAGNOSTICS _lists = ROW_COUNT;
  UPDATE public.change_log c
     SET entity_name = s.original_name
    FROM public.backlog_scrambles s
   WHERE c.entity_type = 'backlog' AND c.entity_id = s.backlog_id AND s.scrambled_by = _who;

  PERFORM set_config('app.scrambling', 'off', true);

  DELETE FROM public.work_item_scrambles WHERE scrambled_by = _who;
  DELETE FROM public.backlog_scrambles WHERE scrambled_by = _who;
  DELETE FROM public.scramble_pins WHERE user_id = _who;

  RAISE NOTICE 'Unscrambled % items and % lists', _items, _lists;
END;
$$;
