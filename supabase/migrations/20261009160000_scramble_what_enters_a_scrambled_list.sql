-- What is put into a scrambled list is scrambled as it arrives.
--
-- Scrambling a list scrambled what was in it then (20261009120000). An item
-- added the next day kept its name, readable to everyone, in a list whose
-- whole point was that nothing in it could be read -- until the person who
-- scrambled the list noticed and scrambled again.
--
-- It is done here, by trigger, rather than by the app, for three reasons:
--   - Items arrive from more places than one screen: the job importer writes
--     them from an edge function, a paste writes many, a move writes none new.
--   - The new name belongs with the list. Whoever scrambled the list is the
--     one who can read it back and who unscrambles it with the list; the
--     person adding the item may have no PIN at all.
--   - Scrambled before it is stored, the real name is never in the table, in
--     the history, or in the change feed other members' browsers receive.
--
-- Each such scramble is recorded as made with the list (20261009150000), so
-- unscrambling the list brings it back -- also when the item has since been
-- moved out again, still scrambled.
--
-- That last point needs the scrambled name made here rather than passed in,
-- so the app's scramble (lib/scramble) is written out again in SQL below.

-- The app's scrambleName(): each run of the letters a-z is replaced by a
-- Moomin word chosen by a hash of the run, keeping its capitals; digits,
-- spaces, punctuation and other letters stay. The word list and the hash
-- (djb2, xor form, in 32 bits, over the lowercased run) are lib/scramble's,
-- and src/test/scrambleSql.test.ts holds the two lists to each other.
CREATE OR REPLACE FUNCTION public.scramble_name(_name text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  _words constant text[] := ARRAY[
    'Moomintroll', 'Moominmamma', 'Moominpappa', 'Snorkmaiden', 'Snork', 'Sniff',
    'LittleMy', 'Mymble', 'Snufkin', 'Hemulen', 'Fillyjonk', 'TooTicky',
    'Groke', 'Hattifattener', 'Fuzzy', 'Hobgoblin', 'Ancestor', 'Moominvalley',
    'Moominhouse', 'Nibling', 'Whomper', 'Inspector', 'Salome', 'Misabel',
    'Edwardian', 'Oomph', 'Joxter', 'Muddler', 'Muskrat', 'Nymphaea'
  ];
  _out text := '';
  _part text[];
  _word text;
  _lower text;
  _moomin text;
  _h bigint;
  _i int;
BEGIN
  IF _name IS NULL OR _name = '' THEN
    RETURN _name;
  END IF;

  FOR _part IN SELECT regexp_matches(_name, '([a-zA-Z]+)|([^a-zA-Z]+)', 'g') LOOP
    IF _part[1] IS NULL THEN
      _out := _out || _part[2];
      CONTINUE;
    END IF;

    _word := _part[1];
    _lower := lower(_word);
    _h := 5381;
    FOR _i IN 1..length(_lower) LOOP
      _h := ((_h * 33) & 4294967295) # ascii(substr(_lower, _i, 1));
    END LOOP;
    _moomin := _words[(_h % array_length(_words, 1))::int + 1];

    IF length(_word) > 1 AND _word = upper(_word) THEN
      _out := _out || upper(_moomin);
    ELSIF substr(_word, 1, 1) = upper(substr(_word, 1, 1)) THEN
      _out := _out || upper(substr(_moomin, 1, 1)) || substr(_moomin, 2);
    ELSE
      _out := _out || lower(_moomin);
    END IF;
  END LOOP;

  RETURN _out;
END;
$function$;

-- The scrambled list an item is in, if any, from its backlog_assignments
-- ({tree id: list id}, or the older {tree id: {"backlogId": list id}}) --
-- leaving out the lists in _before, so that a move can ask only about the
-- lists the item has just entered. The oldest scramble, when there are two.
CREATE OR REPLACE FUNCTION public.scrambled_list_among(_assignments jsonb, _before jsonb DEFAULT NULL)
RETURNS public.backlog_scrambles
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH lists AS (
    SELECT CASE jsonb_typeof(a.value)
             WHEN 'string' THEN a.value #>> '{}'
             WHEN 'object' THEN a.value ->> 'backlogId'
           END AS id
      FROM jsonb_each(CASE WHEN jsonb_typeof(_assignments) = 'object' THEN _assignments ELSE '{}'::jsonb END) a
  ),
  earlier AS (
    SELECT CASE jsonb_typeof(a.value)
             WHEN 'string' THEN a.value #>> '{}'
             WHEN 'object' THEN a.value ->> 'backlogId'
           END AS id
      FROM jsonb_each(CASE WHEN jsonb_typeof(_before) = 'object' THEN _before ELSE '{}'::jsonb END) a
  )
  SELECT s.*
    FROM public.backlog_scrambles s
    JOIN lists l ON l.id = s.backlog_id
   WHERE NOT EXISTS (SELECT 1 FROM earlier e WHERE e.id = s.backlog_id)
   ORDER BY s.created_at, s.backlog_id
   LIMIT 1;
$function$;

REVOKE EXECUTE ON FUNCTION public.scrambled_list_among(jsonb, jsonb) FROM PUBLIC, anon, authenticated;

-- A new item, written into a scrambled list.
--
-- Its name is scrambled before the row is stored. The original cannot be put
-- in work_item_scrambles yet -- that row points at an item which is not there
-- until the insert has happened -- so it waits in a setting for the rest of
-- the statement, and record_scrambled_new_work_items() below files it.
--
-- The app saves with INSERT ... ON CONFLICT DO UPDATE, and this trigger runs
-- for every such save, new item or not; what it does to the row is what the
-- update then sees as the incoming values. An item that is already there must
-- therefore be left exactly alone here: scrambling it would write the
-- scramble over its name with nothing kept to restore it from. The lock makes
-- "is it already there?" hold against another save of the same new item.
CREATE OR REPLACE FUNCTION public.scramble_new_work_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _list public.backlog_scrambles;
  _waiting jsonb;
BEGIN
  IF NEW.title IS NULL OR btrim(NEW.title) = '' THEN
    RETURN NEW;
  END IF;

  _list := public.scrambled_list_among(NEW.backlog_assignments);
  IF _list.backlog_id IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('scramble:item:' || NEW.id, 0));
  IF EXISTS (SELECT 1 FROM public.work_items WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  _waiting := coalesce(nullif(current_setting('app.scramble_new_items', true), ''), '{}')::jsonb;
  _waiting := _waiting || jsonb_build_object(NEW.id, jsonb_build_object(
    'title', NEW.title,
    'org', _list.organization_id,
    'by', _list.scrambled_by,
    'with', coalesce(_list.with_backlog_id, _list.backlog_id)));
  PERFORM set_config('app.scramble_new_items', _waiting::text, true);

  NEW.title := public.scramble_name(NEW.title);
  RETURN NEW;
END;
$function$;

-- Files the originals the trigger above set aside, once their items exist.
-- The new name belongs to whoever scrambled the list, under the list's
-- organization -- that is where their PIN is.
CREATE OR REPLACE FUNCTION public.record_scrambled_new_work_items()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _waiting jsonb;
BEGIN
  _waiting := coalesce(nullif(current_setting('app.scramble_new_items', true), ''), '{}')::jsonb;
  IF _waiting = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.work_item_scrambles (work_item_id, organization_id, scrambled_by, original_title, with_backlog_id)
  SELECT n.id, (w.value ->> 'org')::uuid, (w.value ->> 'by')::uuid, w.value ->> 'title', w.value ->> 'with'
    FROM jsonb_each(_waiting) w
    JOIN new_rows n ON n.id = w.key
  ON CONFLICT (work_item_id) DO NOTHING;

  PERFORM set_config('app.scramble_new_items', '', true);
  RETURN NULL;
END;
$function$;

-- An item that is already there, and has just come into a scrambled list --
-- moved in, or dropped in from another tree -- or one created without a name
-- in a scrambled list and now given its first.
--
-- The item exists, so its original goes straight into work_item_scrambles.
-- Its history and its change-log entries carry the name it had, and are
-- scrubbed as scrambling by hand scrubs them.
--
-- This must run after trg_work_items_block_scrambled_title, which would
-- otherwise see the scramble made here and put the old name back. Triggers of
-- one kind run in name order, and this one's name is chosen for that.
CREATE OR REPLACE FUNCTION public.scramble_work_item_entering_list()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _list public.backlog_scrambles;
  _scrambled text;
BEGIN
  IF coalesce(current_setting('app.scrambling', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF NEW.title IS NULL OR btrim(NEW.title) = '' THEN
    RETURN NEW;
  END IF;

  IF NEW.backlog_assignments IS DISTINCT FROM OLD.backlog_assignments THEN
    -- Only a list it was not in before: an item its owner has unscrambled by
    -- itself stays readable through every later save.
    _list := public.scrambled_list_among(NEW.backlog_assignments, OLD.backlog_assignments);
  END IF;
  IF _list.backlog_id IS NULL AND btrim(coalesce(OLD.title, '')) = '' THEN
    _list := public.scrambled_list_among(NEW.backlog_assignments);
  END IF;
  IF _list.backlog_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.work_item_scrambles WHERE work_item_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  _scrambled := public.scramble_name(NEW.title);

  INSERT INTO public.work_item_scrambles (work_item_id, organization_id, scrambled_by, original_title, with_backlog_id)
  VALUES (NEW.id, _list.organization_id, _list.scrambled_by, NEW.title,
          coalesce(_list.with_backlog_id, _list.backlog_id));

  UPDATE public.work_item_history SET title = _scrambled WHERE work_item_id = NEW.id;
  UPDATE public.change_log
     SET entity_name = _scrambled,
         details = CASE WHEN action = 'Rename' THEN NULL ELSE details END
   WHERE entity_type = 'work_item' AND entity_id = NEW.id;

  NEW.title := _scrambled;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_work_items_scramble_new
  BEFORE INSERT ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.scramble_new_work_item();

CREATE TRIGGER trg_work_items_scramble_new_record
  AFTER INSERT ON public.work_items
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.record_scrambled_new_work_items();

-- "scramble_entering" sorts after "block_scrambled_title": see above.
CREATE TRIGGER trg_work_items_scramble_entering
  BEFORE UPDATE ON public.work_items
  FOR EACH ROW
  WHEN (
    NEW.backlog_assignments IS DISTINCT FROM OLD.backlog_assignments
    OR (btrim(coalesce(OLD.title, '')) = '' AND btrim(coalesce(NEW.title, '')) <> '')
  )
  EXECUTE FUNCTION public.scramble_work_item_entering_list();

-- A new list made under a scrambled one is scrambled the same way, so that
-- what is then put into it is covered too. (A list that already exists and is
-- moved under a scrambled one is not: it may hold hundreds of items, and the
-- scrambled list's menu offers to take it in.)
CREATE OR REPLACE FUNCTION public.scramble_new_backlog()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _parent public.backlog_scrambles;
  _waiting jsonb;
BEGIN
  IF NEW.parent_id IS NULL OR NEW.name IS NULL OR btrim(NEW.name) = '' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _parent FROM public.backlog_scrambles WHERE backlog_id = NEW.parent_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- As for items: a save of a list that is already there must be left alone.
  PERFORM pg_advisory_xact_lock(hashtextextended('scramble:list:' || NEW.id, 0));
  IF EXISTS (SELECT 1 FROM public.backlogs WHERE id = NEW.id) THEN
    RETURN NEW;
  END IF;

  _waiting := coalesce(nullif(current_setting('app.scramble_new_lists', true), ''), '{}')::jsonb;
  _waiting := _waiting || jsonb_build_object(NEW.id, jsonb_build_object(
    'name', NEW.name,
    'org', _parent.organization_id,
    'by', _parent.scrambled_by,
    'with', coalesce(_parent.with_backlog_id, _parent.backlog_id)));
  PERFORM set_config('app.scramble_new_lists', _waiting::text, true);

  NEW.name := public.scramble_name(NEW.name);
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_scrambled_new_backlogs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _waiting jsonb;
BEGIN
  _waiting := coalesce(nullif(current_setting('app.scramble_new_lists', true), ''), '{}')::jsonb;
  IF _waiting = '{}'::jsonb THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.backlog_scrambles (backlog_id, organization_id, scrambled_by, original_name, with_backlog_id)
  SELECT n.id, (w.value ->> 'org')::uuid, (w.value ->> 'by')::uuid, w.value ->> 'name', w.value ->> 'with'
    FROM jsonb_each(_waiting) w
    JOIN new_rows n ON n.id = w.key
  ON CONFLICT (backlog_id) DO NOTHING;

  PERFORM set_config('app.scramble_new_lists', '', true);
  RETURN NULL;
END;
$function$;

CREATE TRIGGER trg_backlogs_scramble_new
  BEFORE INSERT ON public.backlogs
  FOR EACH ROW
  EXECUTE FUNCTION public.scramble_new_backlog();

CREATE TRIGGER trg_backlogs_scramble_new_record
  AFTER INSERT ON public.backlogs
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.record_scrambled_new_backlogs();
