-- Copies of public lists are filled in batches (2026-11-17).
--
-- The first copy tried, of the 1,505-ad job list, ran into the 8 s limit on
-- a signed-in request and was undone: every ad, with its rank, link and
-- record of receipt, went in one statement, on a database whose disk was
-- slowed. Now a call adds at most _limit ads (150 by default); the app calls
-- again until nothing more comes. copy_published_list() says whether there
-- is more; sync_published_list_copies() adds up to _limit per copy per call.
--
-- And a list cannot be copied into the organisation it comes from, or one
-- it is shared with: its ads are there already. That copy was into the job
-- list's own organisation, and would have doubled them.

DROP FUNCTION IF EXISTS public.add_new_published_items(uuid, jsonb);
DROP FUNCTION IF EXISTS public.sync_published_list_copies(uuid);

-- As before (20261116150000), but adds at most _limit items, the first in
-- the list's order, and the rest on the next call.
CREATE OR REPLACE FUNCTION public.add_new_published_items(_copy_id uuid, _payload jsonb, _limit integer DEFAULT 150)
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
  candidates AS (
    SELECT s.i, s.ord
      FROM src s
     WHERE s.i ->> 'id' IS NOT NULL
       AND coalesce(s.i ->> 'title', '') <> ''
       AND coalesce(s.i ->> 'status', '') <> 'done'
       AND (s.i ->> 'deadline' IS NULL OR (s.i ->> 'deadline')::date >= current_date)
       AND NOT EXISTS (
         SELECT 1 FROM public.published_list_copy_items m
          WHERE m.copy_id = _copy.id AND m.source_item_id = s.i ->> 'id')
     ORDER BY (s.i ->> 'rank')::numeric NULLS LAST, s.ord
     LIMIT greatest(coalesce(_limit, 150), 1)
  ),
  fresh AS (
    SELECT c.i ->> 'id' AS source_id,
           c.i ->> 'title' AS title,
           c.i ->> 'description' AS description,
           (c.i ->> 'deadline')::date AS deadline,
           coalesce(c.i -> 'links', '[]'::jsonb) AS links,
           _copy.organization_id::text || '::wi-'
             || substr(md5(random()::text || clock_timestamp()::text || (c.i ->> 'id')), 1, 8) AS new_id,
           _last + row_number() OVER (ORDER BY (c.i ->> 'rank')::numeric NULLS LAST, c.ord) AS new_rank
      FROM candidates c
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

REVOKE EXECUTE ON FUNCTION public.add_new_published_items(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;

-- As before, with the first batch only: "more" says the app should call
-- sync_published_list_copies() for the rest. Refuses the list's own
-- organisation and those it is shared with.
CREATE OR REPLACE FUNCTION public.copy_published_list(_token text, _organization_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _payload jsonb;
  _link public.published_links%ROWTYPE;
  _copy public.published_list_copies%ROWTYPE;
  _tree_name text;
  _list_name text;
  _tree text;
  _backlog text;
  _added integer;
  _batch constant integer := 150;
BEGIN
  IF _uid IS NULL OR NOT public.is_member_of(_uid, _organization_id) THEN
    RAISE EXCEPTION 'Not a member of this organisation' USING ERRCODE = '42501';
  END IF;

  _payload := public.get_published_backlog(_token);
  IF _payload IS NULL THEN
    RAISE EXCEPTION 'This list is no longer public' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO _link FROM public.published_links WHERE token = _token;
  IF _link.organization_id = _organization_id
     OR EXISTS (SELECT 1 FROM public.backlog_tree_shares s
                 WHERE s.tree_id = _link.tree_id AND s.organization_id = _organization_id) THEN
    RAISE EXCEPTION 'This list is already in this organisation' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO _copy FROM public.published_list_copies
   WHERE organization_id = _organization_id AND token = _token;
  IF FOUND THEN
    _added := public.add_new_published_items(_copy.id, _payload, _batch);
    SELECT b.tree_id INTO _tree FROM public.backlogs b WHERE b.id = _copy.backlog_id;
    RETURN jsonb_build_object('treeId', _tree, 'backlogId', _copy.backlog_id, 'added', _added,
                              'existing', true, 'more', _added >= _batch);
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

  _added := public.add_new_published_items(_copy.id, _payload, _batch);
  RETURN jsonb_build_object('treeId', _tree, 'backlogId', _backlog, 'added', _added,
                            'existing', false, 'more', _added >= _batch);
END;
$function$;

-- Adds up to _limit new items to each list copied into the organisation;
-- how many came in all. The app calls it until it gives 0.
CREATE OR REPLACE FUNCTION public.sync_published_list_copies(_organization_id uuid, _limit integer DEFAULT 150)
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
      _added := _added + public.add_new_published_items(_copy.id, _payload, least(greatest(coalesce(_limit, 150), 1), 300));
    END IF;
  END LOOP;
  RETURN _added;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.copy_published_list(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_published_list_copies(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.copy_published_list(text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sync_published_list_copies(uuid, integer) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
