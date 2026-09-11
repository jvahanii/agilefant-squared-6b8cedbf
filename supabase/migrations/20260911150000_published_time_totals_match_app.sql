-- Make every time total on a published page match the app exactly.
--
-- The previous version rolled an item's time up only through the children the
-- link shows. The app rolls up through all of them, so the two could disagree
-- whenever an item had children outside the published backlog. Totals must be
-- identical, so they are now computed the app's way, from the app's data.
--
-- "The app's data" depends on who is looking: an organization loads its own
-- time entries and work items plus those of every partner it shares trees
-- with, in either direction (timeEntryStore.loadTimeEntries,
-- supabaseSync.loadFromSupabase). A published page has no viewer, so it takes
-- the owning organization's view -- the tree's owner and all its partners.
--
-- The rules, mirrored from lib/timeTotalsCore:
-- - An item's total is its own time plus its children's totals, where its
--   children are the union of items whose global parent_id is this item and
--   items naming it as parent through a per-tree override, as `childrenIds` is
--   built. Only loaded items count, on either end, and only overrides for trees
--   the app has loaded -- appStore.sanitizeData discards the rest on load.
-- - A backlog's total is time on the backlog plus its items' own time, through
--   every backlog beneath it; a tree's adds time on the tree itself. Those were
--   already right, and now draw on the same entries.
--
-- Item totals are computed here rather than in the browser so that the time of
-- children the link does not show is counted without those children, or even
-- their ids, ever leaving the server.

CREATE OR REPLACE FUNCTION public.get_published_backlog(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _link public.published_links%ROWTYPE;
  _scope text[];
  _orgs uuid[];
  _loaded_trees text[];
  _items text[];
  _time_on boolean;
  _labels_on boolean;
  _totals jsonb := '{}'::jsonb;
BEGIN
  IF _token IS NULL OR length(_token) < 20 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _link FROM public.published_links WHERE token = _token;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

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

  -- A missing settings row means both features are off, as in the app.
  SELECT s.time_logging_enabled, s.labels_enabled INTO _time_on, _labels_on
    FROM public.organization_settings s
   WHERE s.organization_id = _link.organization_id;
  _time_on := coalesce(_time_on, false);
  _labels_on := coalesce(_labels_on, false);

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
    -- The app's rule: the organization must enable points, and the tree must
    -- not have opted out (NULL means inherit).
    'pointsVisible', (
      coalesce((SELECT s.points_enabled FROM public.organization_settings s
                 WHERE s.organization_id = _link.organization_id), false)
      AND coalesce((SELECT t.points_enabled FROM public.backlog_trees t
                     WHERE t.id = _link.tree_id), true)
    ),
    'timeVisible', _time_on,
    'labelsVisible', _labels_on,
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
    'statusesByBacklog', coalesce((
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
    ), '{}'::jsonb),
    -- Only the teams and labels something in view actually uses. People are
    -- shown as teams, always -- never the individuals in a team.
    'teams', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) ORDER BY t.name)
        FROM public.teams t
       WHERE t.id IN (SELECT a.team_id FROM public.work_item_team_assignments a
                       WHERE a.work_item_id = ANY(_items))
    ), '[]'::jsonb),
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
               'description', w.description,
               'points', w.points,
               'status', w.status,
               -- The effective parent in this tree: a per-tree override wins,
               -- and an override of null means "root here".
               'parentId', CASE WHEN w.parent_id_overrides ? _link.tree_id
                                THEN w.parent_id_overrides ->> _link.tree_id
                                ELSE w.parent_id END,
               'backlogId', w.backlog_assignments ->> _link.tree_id,
               'rank', r.rank,
               'teamIds', coalesce((
                   SELECT jsonb_agg(a.team_id ORDER BY a.created_at)
                     FROM public.work_item_team_assignments a
                    WHERE a.work_item_id = w.id), '[]'::jsonb),
               'labelIds', CASE WHEN _labels_on THEN coalesce((
                   SELECT jsonb_agg(la.label_id ORDER BY la.created_at)
                     FROM public.label_assignments la
                    WHERE la.entity_type = 'work_item' AND la.entity_id = w.id), '[]'::jsonb)
                 ELSE '[]'::jsonb END,
               'links', coalesce((
                   SELECT jsonb_agg(jsonb_build_object('url', h.url, 'altText', h.alt_text)
                                    ORDER BY h.rank, h.created_at)
                     FROM public.work_item_hyperlinks h
                    WHERE h.work_item_id = w.id), '[]'::jsonb),
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
