-- Choose which item attributes a public link shows.
--
-- Every public link used to show every attribute. Now each target -- a whole
-- tree, or a backlog -- has its own choice, stored in published_link_settings.
-- The table records what is *hidden*, so a target without a row, and any
-- attribute added later, is shown: by default, everything.
--
-- The choice lives apart from published_links on purpose. Unpublishing deletes
-- the link row so its token dies, but the choice should survive that and be
-- settable before anything is published.
--
-- Hiding is enforced by get_published_backlog(), which leaves a hidden
-- attribute out of the payload altogether. Hiding it only in the page would
-- keep nothing private: whoever holds the link can read the raw response.
--
-- Titles and the structure -- backlogs, and which item sits under which -- are
-- always shown; they are what a link publishes. Points, labels and time still
-- also need the organization's feature on, and the dialog offers them only
-- then (get_published_link_options).

CREATE TABLE public.published_link_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tree_id text NOT NULL REFERENCES public.backlog_trees(id) ON DELETE CASCADE,
  -- NULL for the whole tree's link.
  backlog_id text REFERENCES public.backlogs(id) ON DELETE CASCADE,
  hidden_attributes text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT published_link_settings_target_key UNIQUE NULLS NOT DISTINCT (tree_id, backlog_id),
  CONSTRAINT published_link_settings_known_attributes CHECK (
    hidden_attributes <@ ARRAY['description', 'status', 'points', 'teams', 'labels', 'links', 'time']::text[]
  )
);

ALTER TABLE public.published_link_settings ENABLE ROW LEVEL SECURITY;

-- Whoever can see the tree can see its choices. There are no write policies:
-- set_published_link_hidden_attributes() is the only way to change them.
CREATE POLICY "Tree members can see published link settings"
  ON public.published_link_settings
  FOR SELECT
  TO authenticated
  USING (public.is_tree_accessible(public.current_user_id(), tree_id));

REVOKE ALL ON public.published_link_settings FROM PUBLIC, anon;
GRANT SELECT ON public.published_link_settings TO authenticated;

-- The same rule as publishing: anyone who can see the tree may choose what its
-- links show. Returns the stored list, deduplicated and sorted.
CREATE OR REPLACE FUNCTION public.set_published_link_hidden_attributes(
  _tree_id text,
  _backlog_id text,
  _hidden text[]
)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _clean text[];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.is_tree_accessible(_uid, _tree_id) THEN
    RAISE EXCEPTION 'You do not have access to this backlog tree';
  END IF;
  IF _backlog_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.backlogs WHERE id = _backlog_id AND tree_id = _tree_id
  ) THEN
    RAISE EXCEPTION 'That backlog does not belong to this tree';
  END IF;

  SELECT coalesce(array_agg(DISTINCT a ORDER BY a), '{}') INTO _clean
    FROM unnest(coalesce(_hidden, '{}')) AS a;
  IF NOT _clean <@ ARRAY['description', 'status', 'points', 'teams', 'labels', 'links', 'time']::text[] THEN
    RAISE EXCEPTION 'Unknown attribute in %', _clean;
  END IF;

  INSERT INTO public.published_link_settings (tree_id, backlog_id, hidden_attributes, updated_by)
  VALUES (_tree_id, _backlog_id, _clean, _uid)
  ON CONFLICT ON CONSTRAINT published_link_settings_target_key
  DO UPDATE SET hidden_attributes = EXCLUDED.hidden_attributes,
                updated_by = EXCLUDED.updated_by,
                updated_at = now();

  RETURN _clean;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_published_link_hidden_attributes(text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_published_link_hidden_attributes(text, text, text[]) TO authenticated;

-- What the link dialog offers: the stored choice, and the attributes the tree
-- has at all. Points, labels and time exist only when the *owning*
-- organization has them on -- and points only when the tree has not opted out
-- -- so the dialog does not offer them otherwise. That is decided here because
-- for a tree shared in from a partner, the client does not hold the owner's
-- settings.
CREATE OR REPLACE FUNCTION public.get_published_link_options(_tree_id text, _backlog_id text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _org uuid;
  _tree_points boolean;
  _points boolean;
  _labels boolean;
  _time boolean;
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
  SELECT s.points_enabled, s.labels_enabled, s.time_logging_enabled
    INTO _points, _labels, _time
    FROM public.organization_settings s WHERE s.organization_id = _org;

  SELECT s.hidden_attributes INTO _hidden
    FROM public.published_link_settings s
   WHERE s.tree_id = _tree_id AND s.backlog_id IS NOT DISTINCT FROM _backlog_id;

  RETURN jsonb_build_object(
    'hidden', to_jsonb(coalesce(_hidden, '{}')),
    'available', to_jsonb(ARRAY['status', 'description', 'teams', 'links']
      || CASE WHEN coalesce(_points, false) AND coalesce(_tree_points, true) THEN ARRAY['points'] ELSE '{}' END
      || CASE WHEN coalesce(_labels, false) THEN ARRAY['labels'] ELSE '{}' END
      || CASE WHEN coalesce(_time, false) THEN ARRAY['time'] ELSE '{}' END)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_published_link_options(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_published_link_options(text, text) TO authenticated;

-- get_published_backlog(), as in 20260911150000, with every attribute now
-- subject to the link's choice.
CREATE OR REPLACE FUNCTION public.get_published_backlog(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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

GRANT EXECUTE ON FUNCTION public.get_published_backlog(text) TO anon, authenticated;
