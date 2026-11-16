-- A copy of a public list in one's own organisation, that keeps receiving the
-- list's new items (2026-11-16). Made for public lists of job ads: a visitor
-- gets the ads without connecting their own Gmail, and new ads keep coming.
--
-- The copy is the copier's own. Items already in it are never removed or
-- changed by the list it follows: the copier may have marked, edited or
-- reordered them. Only items the copy has never received are added, at the
-- end of the list. A received item the copier deleted stays deleted.
--
-- Everything copied comes from get_published_backlog(), so a copy holds only
-- what the link shows (hidden descriptions and links stay hidden), and it
-- stops receiving anything once the link is unpublished or public links are
-- turned off.

CREATE TABLE public.published_list_copies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The public link followed. Its own organisation's members had it already:
  -- it is the address they copied from.
  token text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The list the items go into. Deleting the list ends the copy.
  backlog_id text NOT NULL REFERENCES public.backlogs(id) ON DELETE CASCADE,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, token)
);

-- Which of the list's items a copy has received, so none comes twice.
CREATE TABLE public.published_list_copy_items (
  copy_id uuid NOT NULL REFERENCES public.published_list_copies(id) ON DELETE CASCADE,
  source_item_id text NOT NULL,
  PRIMARY KEY (copy_id, source_item_id)
);

-- Read and written only by the functions below.
ALTER TABLE public.published_list_copies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.published_list_copy_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.published_list_copies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.published_list_copy_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.published_list_copies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.published_list_copy_items TO service_role;

-- Adds the items of _payload (a get_published_backlog() answer) the copy has
-- not received yet, leaving out those already done or past their deadline.
-- Returns how many were added. Not callable by users; the two functions
-- after it check who is asking.
CREATE OR REPLACE FUNCTION public.add_new_published_items(_copy_id uuid, _payload jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _copy public.published_list_copies%ROWTYPE;
  _tree text;
  _last integer;
  _added integer;
BEGIN
  -- Two members opening the app at once would otherwise both add the same items.
  PERFORM pg_advisory_xact_lock(hashtext(_copy_id::text));

  SELECT * INTO _copy FROM public.published_list_copies WHERE id = _copy_id;
  IF NOT FOUND OR _payload IS NULL THEN
    RETURN 0;
  END IF;
  -- The list's tree now: the copier may have moved the list to another tree.
  SELECT b.tree_id INTO _tree FROM public.backlogs b WHERE b.id = _copy.backlog_id;
  IF _tree IS NULL THEN
    RETURN 0;
  END IF;

  SELECT coalesce(max(r.rank), -1) INTO _last
    FROM public.work_item_backlog_ranks r
   WHERE r.backlog_id = _copy.backlog_id;

  WITH src AS (
    SELECT e.i, e.ord
      FROM jsonb_array_elements(coalesce(_payload -> 'items', '[]'::jsonb)) WITH ORDINALITY AS e(i, ord)
  ),
  fresh AS (
    SELECT s.i ->> 'id' AS source_id,
           s.i ->> 'title' AS title,
           s.i ->> 'description' AS description,
           (s.i ->> 'deadline')::date AS deadline,
           coalesce(s.i -> 'links', '[]'::jsonb) AS links,
           _copy.organization_id::text || '::wi-'
             || substr(md5(random()::text || clock_timestamp()::text || (s.i ->> 'id')), 1, 8) AS new_id,
           _last + row_number() OVER (ORDER BY (s.i ->> 'rank')::numeric NULLS LAST, s.ord) AS new_rank
      FROM src s
     WHERE s.i ->> 'id' IS NOT NULL
       AND coalesce(s.i ->> 'title', '') <> ''
       AND coalesce(s.i ->> 'status', '') <> 'done'
       AND (s.i ->> 'deadline' IS NULL OR (s.i ->> 'deadline')::date >= current_date)
       AND NOT EXISTS (
         SELECT 1 FROM public.published_list_copy_items m
          WHERE m.copy_id = _copy.id AND m.source_item_id = s.i ->> 'id')
  ),
  items AS (
    INSERT INTO public.work_items
      (id, title, description, parent_id, backlog_assignments, rank, status, organization_id, deadline, created_on)
    SELECT f.new_id, f.title, f.description, NULL, jsonb_build_object(_tree, _copy.backlog_id),
           f.new_rank, 'not_started', _copy.organization_id, f.deadline, current_date
      FROM fresh f
    RETURNING id
  ),
  ranks AS (
    INSERT INTO public.work_item_backlog_ranks (work_item_id, backlog_id, rank, organization_id)
    SELECT f.new_id, _copy.backlog_id, f.new_rank, _copy.organization_id
      FROM fresh f
      JOIN items i ON i.id = f.new_id
  ),
  links AS (
    INSERT INTO public.work_item_hyperlinks (work_item_id, url, alt_text, rank, organization_id)
    SELECT f.new_id, l.link ->> 'url', l.link ->> 'altText', (l.n - 1)::integer, _copy.organization_id
      FROM fresh f
      JOIN items i ON i.id = f.new_id
     CROSS JOIN LATERAL jsonb_array_elements(f.links) WITH ORDINALITY AS l(link, n)
     WHERE coalesce(l.link ->> 'url', '') <> ''
  ),
  received AS (
    INSERT INTO public.published_list_copy_items (copy_id, source_item_id)
    SELECT _copy.id, f.source_id FROM fresh f
  )
  SELECT count(*) INTO _added FROM fresh;

  RETURN _added;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.add_new_published_items(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Makes a copy of the public list _token in _organization_id: a new tree
-- named as the list's tree, holding one list named as the list, with every
-- current item that is not done or past its deadline. Copying the same list
-- into the same organisation again brings the existing copy up to date
-- instead. Any member may copy, as any member may add items.
CREATE OR REPLACE FUNCTION public.copy_published_list(_token text, _organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _payload jsonb;
  _copy public.published_list_copies%ROWTYPE;
  _tree_name text;
  _list_name text;
  _tree text;
  _backlog text;
  _added integer;
BEGIN
  IF _uid IS NULL OR NOT public.is_member_of(_uid, _organization_id) THEN
    RAISE EXCEPTION 'Not a member of this organisation' USING ERRCODE = '42501';
  END IF;

  _payload := public.get_published_backlog(_token);
  IF _payload IS NULL THEN
    RAISE EXCEPTION 'This list is no longer public' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO _copy FROM public.published_list_copies
   WHERE organization_id = _organization_id AND token = _token;
  IF FOUND THEN
    _added := public.add_new_published_items(_copy.id, _payload);
    SELECT b.tree_id INTO _tree FROM public.backlogs b WHERE b.id = _copy.backlog_id;
    RETURN jsonb_build_object('treeId', _tree, 'backlogId', _copy.backlog_id, 'added', _added, 'existing', true);
  END IF;

  _tree_name := left(coalesce(nullif(_payload -> 'tree' ->> 'name', ''), 'Copied list'), 200);
  _list_name := left(coalesce(
    (SELECT b ->> 'name' FROM jsonb_array_elements(_payload -> 'backlogs') b
      WHERE b ->> 'id' = _payload ->> 'rootBacklogId'),
    _tree_name), 200);
  _tree := _organization_id::text || '::bt-' || substr(md5(random()::text || clock_timestamp()::text), 1, 8);
  _backlog := _organization_id::text || '::bl-' || substr(md5(random()::text || clock_timestamp()::text || 'list'), 1, 8);

  INSERT INTO public.backlog_trees (id, name, rank, organization_id)
  VALUES (_tree, _tree_name,
          coalesce((SELECT max(t.rank) + 1 FROM public.backlog_trees t WHERE t.organization_id = _organization_id), 0),
          _organization_id);
  -- The list can be rated: stars are how a job seeker sorts the ads worth
  -- applying for from the rest.
  INSERT INTO public.backlogs (id, name, parent_id, tree_id, rank, organization_id, ratings_enabled)
  VALUES (_backlog, _list_name, NULL, _tree, 0, _organization_id, true);

  INSERT INTO public.published_list_copies (token, organization_id, backlog_id, created_by)
  VALUES (_token, _organization_id, _backlog, _uid)
  RETURNING * INTO _copy;

  -- Ratings on, so the list's stars show; and deadlines copied are deadlines
  -- shown, as a job ad's deadline is half its point. A new organisation has
  -- both off. Neither is ever turned off here.
  INSERT INTO public.organization_settings (organization_id, ratings_enabled, deadlines_enabled)
  VALUES (_organization_id, true, coalesce((_payload ->> 'deadlinesVisible')::boolean, false))
  ON CONFLICT (organization_id) DO UPDATE
    SET ratings_enabled = true,
        deadlines_enabled = public.organization_settings.deadlines_enabled OR EXCLUDED.deadlines_enabled;

  _added := public.add_new_published_items(_copy.id, _payload);
  RETURN jsonb_build_object('treeId', _tree, 'backlogId', _backlog, 'added', _added, 'existing', false);
END;
$function$;

-- Adds the new items of every public list copied into _organization_id.
-- Returns how many were added in all. A list no longer public adds nothing.
CREATE OR REPLACE FUNCTION public.sync_published_list_copies(_organization_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _copy public.published_list_copies%ROWTYPE;
  _payload jsonb;
  _added integer := 0;
BEGIN
  IF _uid IS NULL OR NOT public.is_member_of(_uid, _organization_id) THEN
    RAISE EXCEPTION 'Not a member of this organisation' USING ERRCODE = '42501';
  END IF;

  FOR _copy IN
    SELECT * FROM public.published_list_copies WHERE organization_id = _organization_id
  LOOP
    _payload := public.get_published_backlog(_copy.token);
    IF _payload IS NOT NULL THEN
      _added := _added + public.add_new_published_items(_copy.id, _payload);
    END IF;
  END LOOP;
  RETURN _added;
END;
$function$;

-- Signed-in users only (the default for new functions since 20261112090000),
-- said explicitly so it holds wherever the defaults differ.
REVOKE EXECUTE ON FUNCTION public.copy_published_list(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_published_list_copies(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_published_list(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_published_list_copies(uuid) TO authenticated, service_role;
