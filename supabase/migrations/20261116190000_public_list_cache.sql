-- A public list is built once per change, not once per visit (2026-11-16).
--
-- get_published_backlog() built the whole list on every visit: for the
-- 1,471-ad job list, 0.9 MB of JSON from every item, link and rank. On this
-- small instance, with its disk slowed after the Disk IO budget ran low, that
-- took 12 to 42 seconds, signed-out callers are stopped after 3, and the page
-- failed for everyone.
--
-- Now each link's last answer is kept with a fingerprint of what it was
-- built from. A visit works out the fingerprint (counts and latest changes
-- of the rows the list is made of, all read through indexes) and, when it
-- matches, is given the kept answer. Only a list that changed is built again,
-- and only then is anything written: a write here costs a 16 MB WAL segment.
--
-- The answer never depends on the time of day, so a kept one stays right
-- until something it was built from changes. What the fingerprint cannot
-- see: a team renamed (teams has no change time); such a list is rebuilt at
-- its next other change.
--
-- When a build does not finish in time, the page asks for the kept answer
-- through get_published_backlog_last() and shows when it was made.

CREATE TABLE public.published_backlog_cache (
  token text PRIMARY KEY REFERENCES public.published_links(token) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  payload jsonb NOT NULL,
  built_at timestamptz NOT NULL DEFAULT now()
);

-- Read and written only by the functions below.
ALTER TABLE public.published_backlog_cache ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.published_backlog_cache FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.published_backlog_cache TO service_role;

-- What a link's list is built from, in one string: equal strings, equal lists.
CREATE OR REPLACE FUNCTION public.published_backlog_fingerprint(_token text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _link public.published_links%ROWTYPE;
  _orgs uuid[];
BEGIN
  SELECT * INTO _link FROM public.published_links WHERE token = _token;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- The organisations whose rows the list can show, as get_published_backlog_unchecked() finds them.
  SELECT array_agg(DISTINCT o) INTO _orgs FROM (
    SELECT _link.organization_id AS o
    UNION
    SELECT t.organization_id
      FROM public.backlog_tree_shares s
      JOIN public.backlog_trees t ON t.id = s.tree_id
     WHERE s.organization_id = _link.organization_id
    UNION
    SELECT s.organization_id
      FROM public.backlog_tree_shares s
      JOIN public.backlog_trees t ON t.id = s.tree_id
     WHERE t.organization_id = _link.organization_id
  ) x;

  RETURN md5(concat_ws('|',
    _orgs::text,
    -- Items, their links and ranks: every change moves its row's changed_at,
    -- and so the sum, even when an edit that began earlier commits after a
    -- later one (the latest time alone would miss it); every deletion is
    -- noted in row_deletions.
    (SELECT count(*) || ':' || coalesce(sum(extract(epoch FROM changed_at)), 0) FROM public.work_items WHERE organization_id = ANY(_orgs)),
    (SELECT count(*) || ':' || coalesce(sum(extract(epoch FROM changed_at)), 0) FROM public.work_item_hyperlinks WHERE organization_id = ANY(_orgs)),
    (SELECT count(*) || ':' || coalesce(sum(extract(epoch FROM changed_at)), 0) FROM public.work_item_backlog_ranks WHERE organization_id = ANY(_orgs)),
    (SELECT coalesce(max(deleted_at)::text, '') FROM public.row_deletions WHERE organization_id = ANY(_orgs)),
    -- The tree and its lists.
    (SELECT t.name || '/' || coalesce(t.points_enabled::text, '') FROM public.backlog_trees t WHERE t.id = _link.tree_id),
    (SELECT md5(coalesce(string_agg(concat_ws('/', b.id, b.name, b.parent_id, b.rank, b.ratings_enabled, b.created_dates_enabled), ',' ORDER BY b.id), ''))
       FROM public.backlogs b WHERE b.tree_id = _link.tree_id),
    (SELECT count(*) || ':' || coalesce(sum(extract(epoch FROM bs.updated_at)), 0)
       FROM public.backlog_statuses bs JOIN public.backlogs b ON b.id = bs.backlog_id
      WHERE b.tree_id = _link.tree_id),
    -- What the link and the organisation choose to show.
    (SELECT s::text FROM public.published_link_settings s
      WHERE s.tree_id = _link.tree_id AND s.backlog_id IS NOT DISTINCT FROM _link.backlog_id),
    (SELECT s::text FROM public.organization_settings s WHERE s.organization_id = _link.organization_id),
    -- Labels, teams and logged time, where shown.
    (SELECT count(*) || ':' || coalesce(sum(extract(epoch FROM updated_at)), 0) FROM public.labels WHERE organization_id = ANY(_orgs)),
    (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM public.label_assignments WHERE organization_id = ANY(_orgs)),
    (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM public.teams WHERE organization_id = ANY(_orgs)),
    (SELECT count(*) || ':' || coalesce(max(created_at)::text, '') FROM public.work_item_team_assignments WHERE organization_id = ANY(_orgs)),
    (SELECT count(*) || ':' || coalesce(sum(duration_minutes), 0) || ':' || coalesce(max(created_at)::text, '')
       FROM public.time_entries WHERE organization_id = ANY(_orgs))
  ));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.published_backlog_fingerprint(text) FROM PUBLIC, anon, authenticated;

-- As before, but the list is built only when it changed since it was last
-- built. VOLATILE now, since it may keep what it built: PostgREST runs
-- STABLE functions in read-only transactions.
CREATE OR REPLACE FUNCTION public.get_published_backlog(_token text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tree public.published_links.tree_id%TYPE;
  _fingerprint text;
  _payload jsonb;
BEGIN
  IF _token IS NULL OR length(_token) < 20 THEN
    RETURN NULL;
  END IF;

  SELECT l.tree_id INTO _tree FROM public.published_links l WHERE l.token = _token;

  -- Null for an unknown link and for a link whose organization has sharing off
  -- alike, so a visitor cannot tell the two apart.
  IF _tree IS NULL OR NOT public.public_links_enabled_for_tree(_tree) THEN
    RETURN NULL;
  END IF;

  -- Worked out before building, so a change made during the build makes the
  -- kept answer look old, never new.
  _fingerprint := public.published_backlog_fingerprint(_token);
  SELECT c.payload INTO _payload
    FROM public.published_backlog_cache c
   WHERE c.token = _token AND c.fingerprint = _fingerprint;
  IF FOUND THEN
    RETURN _payload;
  END IF;

  _payload := public.get_published_backlog_unchecked(_token);
  IF _payload IS NOT NULL THEN
    INSERT INTO public.published_backlog_cache (token, fingerprint, payload, built_at)
    VALUES (_token, _fingerprint, _payload, now())
    ON CONFLICT (token) DO UPDATE
      SET fingerprint = EXCLUDED.fingerprint, payload = EXCLUDED.payload, built_at = EXCLUDED.built_at;
  END IF;
  RETURN _payload;
END;
$function$;

-- The list as last built, and when, for a page whose fresh answer did not
-- come in time. Nothing for an unknown link or one whose organisation has
-- public links off, as get_published_backlog() answers.
CREATE OR REPLACE FUNCTION public.get_published_backlog_last(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tree public.published_links.tree_id%TYPE;
BEGIN
  IF _token IS NULL OR length(_token) < 20 THEN
    RETURN NULL;
  END IF;
  SELECT l.tree_id INTO _tree FROM public.published_links l WHERE l.token = _token;
  IF _tree IS NULL OR NOT public.public_links_enabled_for_tree(_tree) THEN
    RETURN NULL;
  END IF;
  RETURN (SELECT jsonb_build_object('payload', c.payload, 'builtAt', c.built_at)
            FROM public.published_backlog_cache c WHERE c.token = _token);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_published_backlog(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_published_backlog_last(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
