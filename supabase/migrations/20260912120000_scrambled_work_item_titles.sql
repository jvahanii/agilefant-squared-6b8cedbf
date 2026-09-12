-- Scramble a work item's name, protected by a PIN.
--
-- Scrambling replaces the stored title with its Moomin scramble (lib/scramble,
-- the same words the display-wide scramble toggle uses). Everyone in the
-- organization sees that; the original is kept in work_item_scrambles, which
-- no one can read directly -- `original_title` is not selectable by any client
-- role. Only the person who scrambled it can get it back, with their PIN, and
-- reading it does not unscramble anything: the item stays scrambled until they
-- explicitly unscramble it.
--
-- The PIN is per user per organization, set when they scramble their first
-- item, and stored as a bcrypt hash that never leaves the database. When their
-- last scrambled item is unscrambled the PIN is deleted, so the next first
-- scramble asks for a new one.
--
-- Two other places would otherwise keep the original name legible, and both
-- are scrubbed with the title:
--   - work_item_history.title, snapshotted by trigger on every change.
--   - change_log.entity_name, written by the app.
-- Their older titles all become the scrambled one, and unscrambling puts the
-- restored title in their place: history keeps that an item changed and when,
-- but a name it used to have is not worth leaking. Organization backups taken
-- before the scramble still hold the original; restoring one brings it back.

CREATE TABLE public.scramble_pins (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

ALTER TABLE public.scramble_pins ENABLE ROW LEVEL SECURITY;
-- No policies and no grants: only the SECURITY DEFINER functions below touch
-- this table. Nothing may read a hash, not even its owner.
REVOKE ALL ON public.scramble_pins FROM PUBLIC, anon, authenticated;

CREATE TABLE public.work_item_scrambles (
  work_item_id text PRIMARY KEY REFERENCES public.work_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- NULL if the profile is deleted: the item then stays scrambled for good,
  -- which is the privacy-preserving direction to fail in.
  scrambled_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  original_title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.work_item_scrambles ENABLE ROW LEVEL SECURITY;

-- Members see *that* an item is scrambled and by whom, so the app can mark it
-- and offer the owner their options. There are no write policies: the
-- functions below are the only way in.
CREATE POLICY "Members can see which items are scrambled"
  ON public.work_item_scrambles
  FOR SELECT
  TO authenticated
  USING (public.is_work_item_accessible(public.current_user_id(), work_item_id));

REVOKE ALL ON public.work_item_scrambles FROM PUBLIC, anon, authenticated;
-- Column-level on purpose: original_title is missing from this list, so no
-- client can select it however it asks. reveal_scrambled_title() is the only
-- way to see it.
GRANT SELECT (work_item_id, organization_id, scrambled_by, created_at)
  ON public.work_item_scrambles TO authenticated;

-- While an item is scrambled its title is the scramble, and nothing may edit
-- it -- a rename would otherwise be overwritten when it is unscrambled, and
-- would let anyone replace a name they cannot read. The scramble functions set
-- app.scrambling for their own updates.
CREATE OR REPLACE FUNCTION public.block_scrambled_title_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title
     AND coalesce(current_setting('app.scrambling', true), '') <> 'on'
     AND EXISTS (SELECT 1 FROM public.work_item_scrambles s WHERE s.work_item_id = NEW.id)
  THEN
    RAISE EXCEPTION 'This item is scrambled; unscramble it before renaming it';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_work_items_block_scrambled_title
  BEFORE UPDATE ON public.work_items
  FOR EACH ROW
  EXECUTE FUNCTION public.block_scrambled_title_change();

-- Does the caller already have a PIN in this organization? Decides whether the
-- dialog asks them to choose one or to enter it.
CREATE OR REPLACE FUNCTION public.has_scramble_pin(_organization_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.scramble_pins
     WHERE user_id = public.current_user_id()
       AND organization_id = _organization_id
  );
$function$;

-- Check a PIN, or set it the first time. Raises on a wrong or unusable PIN.
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
    IF _pin IS NULL OR _pin !~ '^[0-9]{4,12}$' THEN
      RAISE EXCEPTION 'Choose a PIN of 4 to 12 digits';
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

REVOKE EXECUTE ON FUNCTION public.check_or_set_scramble_pin(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Scramble an item. The caller passes the scrambled title so the Moomin words
-- match the app's own scramble exactly (lib/scramble). The first scramble in
-- an organization sets the PIN; later ones do not ask for it, since hiding a
-- name needs no permission -- reading one does.
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

  PERFORM public.check_or_set_scramble_pin(_uid, _org, _pin);

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

-- The original title, for the person who scrambled it. The item stays
-- scrambled: this only answers "what was it?".
CREATE OR REPLACE FUNCTION public.reveal_scrambled_title(_work_item_id text, _pin text)
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
    RAISE EXCEPTION 'Only the person who scrambled this item can read its name';
  END IF;

  PERFORM public.check_or_set_scramble_pin(_uid, _row.organization_id, _pin);
  RETURN _row.original_title;
END;
$function$;

-- Put the original title back for everyone. When this was the caller's last
-- scrambled item in the organization, their PIN goes too: the next scramble
-- starts a fresh one.
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
  ) THEN
    DELETE FROM public.scramble_pins
     WHERE user_id = _uid AND organization_id = _row.organization_id;
  END IF;

  RETURN _row.original_title;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.has_scramble_pin(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.scramble_work_item(text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.reveal_scrambled_title(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unscramble_work_item(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_scramble_pin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scramble_work_item(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reveal_scrambled_title(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unscramble_work_item(text, text) TO authenticated;

-- The app marks scrambled items live, as it does published links.
ALTER PUBLICATION supabase_realtime ADD TABLE public.work_item_scrambles;
