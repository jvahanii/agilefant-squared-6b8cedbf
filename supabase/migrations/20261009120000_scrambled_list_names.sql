-- Scramble a list: its name, the lists under it, and every item in them.
--
-- An item's name could be scrambled (20260912120000); a list's could not, so a
-- list called "Offers to answer by Friday" stayed readable over a column of
-- Moomin words. A list is scrambled the same way an item is -- the stored name
-- becomes its scramble for everyone, the original is kept where no client can
-- select it, and only the person who scrambled it gets it back, with the same
-- PIN they use for items.
--
-- A list takes its contents with it, and a list of some hundreds of items one
-- call at a time is some hundreds of round trips. So the two functions here
-- take many names at once -- lists and items together -- and do them in one
-- transaction: either the list and its items are scrambled, or nothing is.

CREATE TABLE public.backlog_scrambles (
  backlog_id text PRIMARY KEY REFERENCES public.backlogs(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NULL if the profile is deleted: the list then stays scrambled for good,
  -- which is the privacy-preserving direction to fail in.
  scrambled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  original_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.backlog_scrambles ENABLE ROW LEVEL SECURITY;

-- Who may act on a list here: a member of its organization, or someone the
-- tree is shared with. Superusers read everything but are not let in by this,
-- as they are not for items' scrambles either.
CREATE OR REPLACE FUNCTION public.is_backlog_accessible(_user_id uuid, _backlog_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM public.backlogs b
     WHERE b.id = _backlog_id
       AND (public.is_member_of(_user_id, b.organization_id)
            OR public.is_tree_accessible(_user_id, b.tree_id))
  );
$function$;

-- Members see *that* a list is scrambled and by whom. No write policies: the
-- functions below are the only way in.
CREATE POLICY "Members can see which lists are scrambled"
  ON public.backlog_scrambles
  FOR SELECT
  TO authenticated
  USING (public.is_backlog_accessible(public.current_user_id(), backlog_id));

REVOKE ALL ON public.backlog_scrambles FROM PUBLIC, anon, authenticated;
-- Column-level on purpose: original_name is missing from this list.
GRANT SELECT (backlog_id, organization_id, scrambled_by, created_at)
  ON public.backlog_scrambles TO authenticated;

-- While a list is scrambled its name is the scramble. A write that would
-- change it keeps the scrambled one rather than failing: the app saves whole
-- list rows, and a backup restore writes every name it holds
-- (see 20260912150000 for the same choice on items).
CREATE OR REPLACE FUNCTION public.keep_scrambled_backlog_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name
     AND coalesce(current_setting('app.scrambling', true), '') <> 'on'
     AND EXISTS (SELECT 1 FROM public.backlog_scrambles s WHERE s.backlog_id = NEW.id)
  THEN
    NEW.name := OLD.name;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_backlogs_keep_scrambled_name
  BEFORE UPDATE ON public.backlogs
  FOR EACH ROW
  EXECUTE FUNCTION public.keep_scrambled_backlog_name();

-- Does this PIN open this person's scrambles in this organization? Unlike
-- check_or_set_scramble_pin() it never sets one and never raises, so a caller
-- with names in two organizations can restore the ones the PIN fits.
CREATE OR REPLACE FUNCTION public.scramble_pin_matches(_user_id uuid, _organization_id uuid, _pin text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _pin IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.scramble_pins p
     WHERE p.user_id = _user_id
       AND p.organization_id = _organization_id
       AND extensions.crypt(_pin, p.pin_hash) = p.pin_hash
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.scramble_pin_matches(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Scramble many names at once.
--
--   _lists  [{"id": <list id>, "name": <its scrambled name>}, ...]
--   _items  [{"id": <item id>, "title": <its scrambled title>}, ...]
--
-- The caller passes the scrambled names so the words match the app's own
-- scramble (lib/scramble). What the caller cannot reach, what is gone, and
-- what is already scrambled -- by anyone -- is passed over rather than refused:
-- a list scrambled a second time picks up the items added to it since.
--
-- The PIN is used only where the caller has none yet, to set it. Where they
-- have one it is not asked for and not looked at: hiding a name needs no
-- permission, reading one does.
--
-- Returns the ids that were scrambled: {"lists": [...], "items": [...]}.
CREATE OR REPLACE FUNCTION public.scramble_names(_lists jsonb, _items jsonb, _pin text DEFAULT NULL)
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
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
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

  INSERT INTO public.backlog_scrambles (backlog_id, organization_id, scrambled_by, original_name)
  SELECT e->>'id', (e->>'org')::uuid, _uid, e->>'was'
    FROM jsonb_array_elements(_do_lists) e;

  INSERT INTO public.work_item_scrambles (work_item_id, organization_id, scrambled_by, original_title)
  SELECT e->>'id', (e->>'org')::uuid, _uid, e->>'was'
    FROM jsonb_array_elements(_do_items) e;

  PERFORM set_config('app.scrambling', 'on', true);

  UPDATE public.backlogs b
     SET name = e->>'name'
    FROM jsonb_array_elements(_do_lists) e
   WHERE b.id = e->>'id';
  -- The change log names the list on every entry about it, and a rename's
  -- details spell out both names in full: "Old" → "New".
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

-- Put many names back at once: of the lists and items named, the ones the
-- caller scrambled. The rest are passed over -- someone else's stay as they
-- are, and there is nothing to refuse in asking.
--
-- The PIN is the caller's for the organization that owns each name. With names
-- in more than one organization, those whose PIN this is are restored; it is
-- "Wrong PIN" only when it fits none of them.
--
-- Returns what was restored, with the real names, so the app can show them
-- without waiting to be told: {"lists": [{"id", "name"}], "items": [{"id", "title"}]}.
CREATE OR REPLACE FUNCTION public.unscramble_names(_list_ids text[], _item_ids text[], _pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _mine uuid[];
  _open uuid[];
  _lists jsonb;
  _items jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT array_agg(DISTINCT org) INTO _mine
    FROM (
      SELECT s.organization_id AS org
        FROM public.backlog_scrambles s
       WHERE s.backlog_id = ANY(coalesce(_list_ids, '{}'::text[])) AND s.scrambled_by = _uid
      UNION
      SELECT s.organization_id
        FROM public.work_item_scrambles s
       WHERE s.work_item_id = ANY(coalesce(_item_ids, '{}'::text[])) AND s.scrambled_by = _uid
    ) owned;
  IF _mine IS NULL THEN
    RAISE EXCEPTION 'Nothing here that you scrambled';
  END IF;

  SELECT array_agg(org) INTO _open
    FROM unnest(_mine) org
   WHERE public.scramble_pin_matches(_uid, org, _pin);
  IF _open IS NULL THEN
    RAISE EXCEPTION 'Wrong PIN';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.backlog_id, 'name', s.original_name)), '[]'::jsonb)
    INTO _lists
    FROM public.backlog_scrambles s
   WHERE s.backlog_id = ANY(coalesce(_list_ids, '{}'::text[]))
     AND s.scrambled_by = _uid
     AND s.organization_id = ANY(_open);

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', s.work_item_id, 'title', s.original_title)), '[]'::jsonb)
    INTO _items
    FROM public.work_item_scrambles s
   WHERE s.work_item_id = ANY(coalesce(_item_ids, '{}'::text[]))
     AND s.scrambled_by = _uid
     AND s.organization_id = ANY(_open);

  PERFORM set_config('app.scrambling', 'on', true);

  UPDATE public.backlogs b
     SET name = e->>'name'
    FROM jsonb_array_elements(_lists) e
   WHERE b.id = e->>'id';
  UPDATE public.change_log c
     SET entity_name = e->>'name'
    FROM jsonb_array_elements(_lists) e
   WHERE c.entity_type = 'backlog' AND c.entity_id = e->>'id';

  UPDATE public.work_items wi
     SET title = e->>'title'
    FROM jsonb_array_elements(_items) e
   WHERE wi.id = e->>'id';
  UPDATE public.work_item_history h
     SET title = e->>'title'
    FROM jsonb_array_elements(_items) e
   WHERE h.work_item_id = e->>'id';
  UPDATE public.change_log c
     SET entity_name = e->>'title'
    FROM jsonb_array_elements(_items) e
   WHERE c.entity_type = 'work_item' AND c.entity_id = e->>'id';

  PERFORM set_config('app.scrambling', 'off', true);

  DELETE FROM public.backlog_scrambles s
   USING jsonb_array_elements(_lists) e
   WHERE s.backlog_id = e->>'id';
  DELETE FROM public.work_item_scrambles s
   USING jsonb_array_elements(_items) e
   WHERE s.work_item_id = e->>'id';

  -- With nothing of theirs left scrambled in an organization, the PIN goes
  -- too: the next scramble there starts a fresh one.
  DELETE FROM public.scramble_pins p
   WHERE p.user_id = _uid
     AND p.organization_id = ANY(_open)
     AND NOT EXISTS (
       SELECT 1 FROM public.work_item_scrambles s
        WHERE s.scrambled_by = _uid AND s.organization_id = p.organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.backlog_scrambles s
        WHERE s.scrambled_by = _uid AND s.organization_id = p.organization_id);

  RETURN jsonb_build_object('lists', _lists, 'items', _items);
END;
$function$;

-- A list's real name, for the person who scrambled it. The list stays
-- scrambled: this only answers "what was it?".
CREATE OR REPLACE FUNCTION public.reveal_scrambled_backlog_name(_backlog_id text, _pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _row public.backlog_scrambles%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO _row FROM public.backlog_scrambles WHERE backlog_id = _backlog_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This list is not scrambled';
  END IF;
  IF _row.scrambled_by IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'Only the person who scrambled this list can read its name';
  END IF;
  IF NOT public.scramble_pin_matches(_uid, _row.organization_id, _pin) THEN
    RAISE EXCEPTION 'Wrong PIN';
  END IF;

  RETURN _row.original_name;
END;
$function$;

-- Unscrambling a person's last item deleted their PIN. With lists scrambled
-- too, that would leave those lists behind a PIN that no longer exists -- and
-- the next thing to ask for one would have set a new one, whatever was typed.
-- The PIN now goes only when nothing of theirs is left, items or lists.
CREATE OR REPLACE FUNCTION public.unscramble_work_item(_work_item_id text, _pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _row public.work_item_scrambles%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT * INTO _row FROM public.work_item_scrambles WHERE work_item_id = _work_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This item is not scrambled';
  END IF;
  IF _row.scrambled_by IS DISTINCT FROM _uid THEN
    RAISE EXCEPTION 'Only the person who scrambled this item can unscramble it';
  END IF;

  PERFORM public.check_or_set_scramble_pin(_uid, _row.organization_id, _pin);

  PERFORM set_config('app.scrambling', 'on', true);
  UPDATE public.work_items SET title = _row.original_title WHERE id = _work_item_id;
  UPDATE public.work_item_history SET title = _row.original_title WHERE work_item_id = _work_item_id;
  UPDATE public.change_log SET entity_name = _row.original_title
   WHERE entity_type = 'work_item' AND entity_id = _work_item_id;
  PERFORM set_config('app.scrambling', 'off', true);

  DELETE FROM public.work_item_scrambles WHERE work_item_id = _work_item_id;

  IF NOT EXISTS (
    SELECT 1 FROM public.work_item_scrambles
     WHERE scrambled_by = _uid AND organization_id = _row.organization_id
  ) AND NOT EXISTS (
    SELECT 1 FROM public.backlog_scrambles
     WHERE scrambled_by = _uid AND organization_id = _row.organization_id
  ) THEN
    DELETE FROM public.scramble_pins
     WHERE user_id = _uid AND organization_id = _row.organization_id;
  END IF;

  RETURN _row.original_title;
END;
$function$;

-- Scrambling one item left its old names readable in the change log: every
-- rename is logged with both names in its details. They go with the name, as
-- they do for many at once above. (Otherwise as in 20260912140000.)
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
  UPDATE public.change_log
     SET entity_name = _scrambled_title,
         details = CASE WHEN action = 'Rename' THEN NULL ELSE details END
   WHERE entity_type = 'work_item' AND entity_id = _work_item_id;
  PERFORM set_config('app.scrambling', 'off', true);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.is_backlog_accessible(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.scramble_names(jsonb, jsonb, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unscramble_names(text[], text[], text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reveal_scrambled_backlog_name(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_backlog_accessible(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scramble_names(jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unscramble_names(text[], text[], text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_scrambled_backlog_name(text, text) TO authenticated;

-- The app marks scrambled lists live, as it does scrambled items.
ALTER PUBLICATION supabase_realtime ADD TABLE public.backlog_scrambles;
