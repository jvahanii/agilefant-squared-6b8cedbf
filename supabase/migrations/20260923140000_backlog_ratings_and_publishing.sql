-- Stars per backlog, and in a published link.
--
-- Two changes that belong together, because the same switch governs both.
--
-- 1. Every backlog starts with its stars off, even where the organization has
--    ratings on. Ratings are useful on a shortlist and noise on a sprint
--    backlog, so a backlog opts in rather than out. This is deliberately
--    unlike the tree-level points override, where NULL means "inherit": here
--    there is nothing to inherit, only an off switch that has to be flipped.
--
-- 2. A published link can show those stars. "rating" joins the attributes a
--    link may hide, shown unless it is ticked off, and get_published_backlog
--    puts each item's rating in the payload -- but only for items in a
--    backlog whose own switch is on.
--
-- get_published_backlog_unchecked is replaced whole, from the body that was
-- live when this was written rather than from any earlier file: the live
-- definitions have drifted before, and a replacement built from a file would
-- quietly undo whatever that drift was.

ALTER TABLE public.backlogs
  ADD COLUMN IF NOT EXISTS ratings_enabled boolean NOT NULL DEFAULT false;

-- The attributes a link may hide are held to a known list. Without "rating"
-- in it, ticking ratings off would be refused by the database, and the tick
-- box would appear to work and change nothing.
ALTER TABLE public.published_link_settings
  DROP CONSTRAINT IF EXISTS published_link_settings_known_attributes;

ALTER TABLE public.published_link_settings
  ADD CONSTRAINT published_link_settings_known_attributes
  CHECK (hidden_attributes <@ ARRAY['description', 'status', 'points', 'teams', 'labels', 'links', 'time', 'rating']);

COMMENT ON COLUMN public.backlogs.ratings_enabled IS
  'Whether this backlog shows star ratings and offers sorting by them. Off until switched on, and only consulted where organization_settings.ratings_enabled.';

CREATE OR REPLACE FUNCTION public.get_published_backlog_unchecked(_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _link public.published_links%ROWTYPE;
  _hidden text[];
  _scope text[];
  _orgs uuid[];
  _loaded_trees text[];
  _items text[];
  _time_on boolean;
  _labels_on boolean;
  _points_on boolean;
  _description_on boolean;
  _status_on boolean;
  _teams_on boolean;
  _links_on boolean;
  _ratings_on boolean;
  _rating_backlogs text[];
  _totals jsonb := '{}'::jsonb;
BEGIN
  IF _token IS NULL OR length(_token) < 20 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _link FROM public.published_links WHERE token = _token;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- What this link hides. No row means nothing is hidden.
  SELECT s.hidden_attributes INTO _hidden
    FROM public.published_link_settings s
   WHERE s.tree_id = _link.tree_id
     AND s.backlog_id IS NOT DISTINCT FROM _link.backlog_id;
  _hidden := coalesce(_hidden, '{}');

  -- The backlogs in view: the whole tree, or the published backlog and
  -- everything beneath it. The depth cap keeps a parent cycle in the data from
  -- turning into an unbounded query on a public endpoint.
  IF _link.backlog_id IS NULL THEN
    SELECT coalesce(array_agg(b.id), '{}') INTO _scope
      FROM public.backlogs b
     WHERE b.tree_id = _link.tree_id;
  ELSE
    WITH RECURSIVE sub(id, depth) AS (
      SELECT b.id, 0 FROM public.backlogs b WHERE b.id = _link.backlog_id
      UNION ALL
      SELECT b.id, sub.depth + 1
        FROM public.backlogs b
        JOIN sub ON b.parent_id = sub.id
       WHERE sub.depth < 64
    )
    SELECT coalesce(array_agg(DISTINCT id), '{}') INTO _scope FROM sub;
  END IF;

  -- The owning organization and every partner it shares trees with, in either
  -- direction: whose entries and items its app loads.
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

  -- The trees the owning organization loads: its own and those shared to it.
  -- sanitizeData keeps only per-tree parent overrides keyed to these, so an
  -- override on any other tree creates no parent edge in the app.
  SELECT coalesce(array_agg(DISTINCT x.t), '{}') INTO _loaded_trees FROM (
    SELECT bt.id AS t FROM public.backlog_trees bt WHERE bt.organization_id = _link.organization_id
    UNION
    SELECT s.tree_id FROM public.backlog_tree_shares s WHERE s.organization_id = _link.organization_id
  ) x;

  SELECT coalesce(array_agg(w.id), '{}') INTO _items
    FROM public.work_items w
   WHERE w.organization_id = ANY(_orgs)
     AND w.backlog_assignments ->> _link.tree_id = ANY(_scope);

  -- A missing settings row means the features are off, as in the app.
  SELECT s.time_logging_enabled, s.labels_enabled, s.points_enabled
    INTO _time_on, _labels_on, _points_on
    FROM public.organization_settings s
   WHERE s.organization_id = _link.organization_id;
  -- Points also follow the tree's own opt-out (NULL means inherit).
  _points_on := coalesce(_points_on, false)
    AND coalesce((SELECT t.points_enabled FROM public.backlog_trees t WHERE t.id = _link.tree_id), true)
    AND NOT 'points' = ANY(_hidden);
  _time_on := coalesce(_time_on, false) AND NOT 'time' = ANY(_hidden);
  _labels_on := coalesce(_labels_on, false) AND NOT 'labels' = ANY(_hidden);
  _description_on := NOT 'description' = ANY(_hidden);
  _status_on := NOT 'status' = ANY(_hidden);
  _teams_on := NOT 'teams' = ANY(_hidden);
  _links_on := NOT 'links' = ANY(_hidden);

  -- Ratings pass three gates: the organization setting, this link's own tick
  -- box, and each backlog's own switch, which starts off. A backlog that has
  -- not been switched on publishes no stars even where the rest is rated.
  SELECT s.ratings_enabled INTO _ratings_on
    FROM public.organization_settings s
   WHERE s.organization_id = _link.organization_id;
  _ratings_on := coalesce(_ratings_on, false) AND NOT 'rating' = ANY(_hidden);
  IF _ratings_on THEN
    SELECT coalesce(array_agg(b.id), '{}') INTO _rating_backlogs
      FROM public.backlogs b
     WHERE b.id = ANY(_scope) AND b.ratings_enabled;
  ELSE
    _rating_backlogs := '{}';
  END IF;
  _ratings_on := _ratings_on AND coalesce(array_length(_rating_backlogs, 1), 0) > 0;

  IF _time_on THEN
    WITH RECURSIVE
    loaded AS (
      SELECT w.id, w.parent_id, w.parent_id_overrides
        FROM public.work_items w
       WHERE w.organization_id = ANY(_orgs)
    ),
    -- child -> parent, the union `childrenIds` is built from.
    edges AS (
      SELECT l.id AS child, l.parent_id AS parent
        FROM loaded l
       WHERE l.parent_id IS NOT NULL
      UNION
      SELECT l.id, ov.value
        FROM loaded l
       CROSS JOIN LATERAL jsonb_each_text(
               CASE WHEN jsonb_typeof(l.parent_id_overrides) = 'object'
                    THEN l.parent_id_overrides ELSE '{}'::jsonb END) ov
       WHERE ov.value IS NOT NULL
         AND ov.key = ANY(_loaded_trees)
    ),
    -- Only a parent the app has loaded can hold a child.
    valid_edges AS (
      SELECT e.child, e.parent FROM edges e JOIN loaded p ON p.id = e.parent
    ),
    own AS (
      SELECT te.work_item_id AS id, sum(te.duration_minutes)::bigint AS m
        FROM public.time_entries te
       WHERE te.organization_id = ANY(_orgs)
         AND te.work_item_id IS NOT NULL
       GROUP BY te.work_item_id
    ),
    -- Every path down from each shown item. On acyclic data -- which the app
    -- enforces -- summing over paths equals the app's memoized walk, including
    -- counting an item once under each of two parents. The path check and depth
    -- cap only matter if the data ever holds a cycle.
    walk(root, node, path) AS (
      SELECT i, i, ARRAY[i] FROM unnest(_items) AS i
      UNION ALL
      SELECT w.root, e.child, w.path || e.child
        FROM walk w
        JOIN valid_edges e ON e.parent = w.node
       WHERE NOT (e.child = ANY(w.path))
         AND cardinality(w.path) < 64
    )
    SELECT coalesce(jsonb_object_agg(t.root, t.total), '{}'::jsonb) INTO _totals
      FROM (
        SELECT w.root, sum(coalesce(o.m, 0)) AS total
          FROM walk w
          LEFT JOIN own o ON o.id = w.node
         GROUP BY w.root
      ) t;
  END IF;

  RETURN jsonb_build_object(
    'kind', CASE WHEN _link.backlog_id IS NULL THEN 'tree' ELSE 'backlog' END,
    'tree', (
      SELECT jsonb_build_object('id', t.id, 'name', t.name)
        FROM public.backlog_trees t
       WHERE t.id = _link.tree_id
    ),
    'rootBacklogId', _link.backlog_id,
    'pointsVisible', _points_on,
    'timeVisible', _time_on,
    'labelsVisible', _labels_on,
    'descriptionVisible', _description_on,
    'statusVisible', _status_on,
    'teamsVisible', _teams_on,
    'linksVisible', _links_on,
    'ratingsVisible', _ratings_on,
    'backlogs', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', b.id,
               'name', b.name,
               'parentId', b.parent_id,
               'rank', b.rank,
               'labelIds', CASE WHEN _labels_on THEN coalesce((
                   SELECT jsonb_agg(la.label_id ORDER BY la.created_at)
                     FROM public.label_assignments la
                    WHERE la.entity_type = 'backlog' AND la.entity_id = b.id), '[]'::jsonb)
                 ELSE '[]'::jsonb END,
               -- Time logged against the backlog itself rather than an item.
               'minutes', CASE WHEN _time_on THEN coalesce((
                   SELECT sum(te.duration_minutes)
                     FROM public.time_entries te
                    WHERE te.backlog_id = b.id
                      AND te.work_item_id IS NULL
                      AND te.organization_id = ANY(_orgs)), 0)
                 ELSE 0 END)
             ORDER BY b.rank, b.id)
        FROM public.backlogs b
       WHERE b.id = ANY(_scope)
    ), '[]'::jsonb),
    -- Time logged against the tree itself, which only a whole-tree link shows.
    'treeMinutes', CASE WHEN _time_on AND _link.backlog_id IS NULL THEN coalesce((
        SELECT sum(te.duration_minutes)
          FROM public.time_entries te
         WHERE te.tree_id = _link.tree_id
           AND te.work_item_id IS NULL
           AND te.backlog_id IS NULL
           AND te.organization_id = ANY(_orgs)), 0)
      ELSE 0 END,
    -- Each backlog's effective statuses: its own if it has any, else the
    -- nearest ancestor's -- including ancestors above a published backlog, whose
    -- names stay private but whose status labels apply to what is shown. A
    -- backlog absent here uses the defaults.
    'statusesByBacklog', CASE WHEN _status_on THEN coalesce((
      WITH RECURSIVE chain(backlog_id, ancestor_id, parent_id, depth) AS (
        SELECT b.id, b.id, b.parent_id, 0
          FROM public.backlogs b
         WHERE b.id = ANY(_scope)
        UNION ALL
        SELECT c.backlog_id, p.id, p.parent_id, c.depth + 1
          FROM chain c
          JOIN public.backlogs p ON p.id = c.parent_id
         WHERE c.depth < 64
      ),
      owner AS (
        SELECT DISTINCT ON (c.backlog_id) c.backlog_id, c.ancestor_id
          FROM chain c
         WHERE EXISTS (SELECT 1 FROM public.backlog_statuses s WHERE s.backlog_id = c.ancestor_id)
         ORDER BY c.backlog_id, c.depth
      )
      SELECT jsonb_object_agg(o.backlog_id, (
               SELECT jsonb_agg(
                        jsonb_build_object('key', s.key, 'label', s.label, 'color', s.color, 'rank', s.rank)
                        ORDER BY s.rank)
                 FROM public.backlog_statuses s
                WHERE s.backlog_id = o.ancestor_id))
        FROM owner o
    ), '{}'::jsonb) ELSE '{}'::jsonb END,
    -- Only the teams and labels something in view actually uses. People are
    -- shown as teams, always -- never the individuals in a team.
    'teams', CASE WHEN _teams_on THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
        FROM public.teams t
       WHERE t.id IN (SELECT a.team_id FROM public.work_item_team_assignments a
                       WHERE a.work_item_id = ANY(_items))
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'labels', CASE WHEN _labels_on THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'color', l.color) ORDER BY l.name)
        FROM public.labels l
       WHERE l.id IN (
         SELECT la.label_id FROM public.label_assignments la
          WHERE (la.entity_type = 'work_item' AND la.entity_id = ANY(_items))
             OR (la.entity_type = 'backlog' AND la.entity_id = ANY(_scope)))
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'items', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', w.id,
               'title', w.title,
               'description', CASE WHEN _description_on THEN w.description END,
               'points', CASE WHEN _points_on THEN w.points END,
               'rating', CASE WHEN w.backlog_assignments ->> _link.tree_id = ANY(_rating_backlogs)
                              THEN w.rating END,
               'status', CASE WHEN _status_on THEN w.status END,
               -- The effective parent in this tree: a per-tree override wins,
               -- and an override of null means "root here".
               'parentId', CASE WHEN w.parent_id_overrides ? _link.tree_id
                                THEN w.parent_id_overrides ->> _link.tree_id
                                ELSE w.parent_id END,
               'backlogId', w.backlog_assignments ->> _link.tree_id,
               'rank', r.rank,
               'teamIds', CASE WHEN _teams_on THEN coalesce((
                   SELECT jsonb_agg(a.team_id ORDER BY a.created_at)
                     FROM public.work_item_team_assignments a
                    WHERE a.work_item_id = w.id), '[]'::jsonb)
                 ELSE '[]'::jsonb END,
               'labelIds', CASE WHEN _labels_on THEN coalesce((
                   SELECT jsonb_agg(la.label_id ORDER BY la.created_at)
                     FROM public.label_assignments la
                    WHERE la.entity_type = 'work_item' AND la.entity_id = w.id), '[]'::jsonb)
                 ELSE '[]'::jsonb END,
               'links', CASE WHEN _links_on THEN coalesce((
                   SELECT jsonb_agg(jsonb_build_object('url', h.url, 'altText', h.alt_text)
                                    ORDER BY h.rank, h.created_at)
                     FROM public.work_item_hyperlinks h
                    WHERE h.work_item_id = w.id), '[]'::jsonb)
                 ELSE '[]'::jsonb END,
               -- The item's own logged time, for backlog and tree totals.
               'minutes', CASE WHEN _time_on THEN coalesce((
                   SELECT sum(te.duration_minutes)
                     FROM public.time_entries te
                    WHERE te.work_item_id = w.id
                      AND te.organization_id = ANY(_orgs)), 0)
                 ELSE 0 END,
               -- Its total including everything beneath it, as the app shows it.
               'totalMinutes', CASE WHEN _time_on
                 THEN coalesce((_totals ->> w.id)::bigint, 0) ELSE 0 END))
        FROM public.work_items w
        LEFT JOIN public.work_item_backlog_ranks r
          ON r.work_item_id = w.id
         AND r.backlog_id = w.backlog_assignments ->> _link.tree_id
       WHERE w.id = ANY(_items)
    ), '[]'::jsonb)
  );
END;
$function$;

-- The tick boxes a link offers. "rating" appears only where the organization
-- rates its items and at least one backlog in the link's scope has its stars
-- switched on -- otherwise the box would promise something no row could show.
CREATE OR REPLACE FUNCTION public.get_published_link_options(_tree_id text, _backlog_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _org uuid;
  _tree_points boolean;
  _points boolean;
  _labels boolean;
  _time boolean;
  _ratings boolean;
  _rated_backlogs integer;
  _hidden text[];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.is_tree_accessible(_uid, _tree_id) THEN
    RAISE EXCEPTION 'You do not have access to this backlog tree';
  END IF;

  SELECT t.organization_id, t.points_enabled INTO _org, _tree_points
    FROM public.backlog_trees t WHERE t.id = _tree_id;
  SELECT s.points_enabled, s.labels_enabled, s.time_logging_enabled, s.ratings_enabled
    INTO _points, _labels, _time, _ratings
    FROM public.organization_settings s WHERE s.organization_id = _org;

  -- The same scope the payload uses: the whole tree, or the published backlog
  -- and everything beneath it.
  IF _backlog_id IS NULL THEN
    SELECT count(*) INTO _rated_backlogs
      FROM public.backlogs b WHERE b.tree_id = _tree_id AND b.ratings_enabled;
  ELSE
    WITH RECURSIVE sub(id, depth) AS (
      SELECT b.id, 0 FROM public.backlogs b WHERE b.id = _backlog_id
      UNION ALL
      SELECT b.id, sub.depth + 1
        FROM public.backlogs b
        JOIN sub ON b.parent_id = sub.id
       WHERE sub.depth < 64
    )
    SELECT count(*) INTO _rated_backlogs
      FROM public.backlogs b WHERE b.id IN (SELECT id FROM sub) AND b.ratings_enabled;
  END IF;

  SELECT s.hidden_attributes INTO _hidden
    FROM public.published_link_settings s
   WHERE s.tree_id = _tree_id AND s.backlog_id IS NOT DISTINCT FROM _backlog_id;

  RETURN jsonb_build_object(
    'hidden', to_jsonb(coalesce(_hidden, '{}')),
    'available', to_jsonb(ARRAY['status', 'description', 'teams', 'links']
      || CASE WHEN coalesce(_points, false) AND coalesce(_tree_points, true) THEN ARRAY['points'] ELSE '{}' END
      || CASE WHEN coalesce(_labels, false) THEN ARRAY['labels'] ELSE '{}' END
      || CASE WHEN coalesce(_time, false) THEN ARRAY['time'] ELSE '{}' END
      || CASE WHEN coalesce(_ratings, false) AND coalesce(_rated_backlogs, 0) > 0 THEN ARRAY['rating'] ELSE '{}' END)
  );
END;
$function$;
