-- Show teams, labels, links and logged time on published pages.
--
-- The first version of get_published_backlog() deliberately left these out.
-- They are now part of what a public link shows, on request, with two limits:
--
-- - Labels and time appear only when the owning organization has those
--   features switched on, exactly as in the app. When a feature is off its data
--   is not sent at all, rather than sent and hidden, because anything in the
--   payload is readable by whoever holds the link.
-- - Time is shown as totals. Individual entries -- who logged them, when, and
--   their notes -- stay private.
--
-- People are shown as teams, always -- never the individuals in a team. Work
-- items are assigned to teams, and a published page shows those team names and
-- nothing else about who is involved: not team_members, not profiles, not
-- emails. (Today most teams happen to be named after one person; the rule does
-- not depend on that.) Hyperlinks are sent as stored; the public page is
-- responsible for refusing anything that is not an http(s) or mailto URL.

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
  _items text[];
  _time_on boolean;
  _labels_on boolean;
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

  SELECT coalesce(array_agg(w.id), '{}') INTO _items
    FROM public.work_items w
   WHERE w.backlog_assignments ->> _link.tree_id = ANY(_scope);

  -- A missing settings row means both features are off, as in the app.
  SELECT s.time_logging_enabled, s.labels_enabled INTO _time_on, _labels_on
    FROM public.organization_settings s
   WHERE s.organization_id = _link.organization_id;
  _time_on := coalesce(_time_on, false);
  _labels_on := coalesce(_labels_on, false);

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
                    WHERE te.backlog_id = b.id AND te.work_item_id IS NULL), 0)
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
           AND te.backlog_id IS NULL), 0)
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
    -- Only the teams and labels something in view actually uses.
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
               -- The item's own logged total; the page rolls children up.
               'minutes', CASE WHEN _time_on THEN coalesce((
                   SELECT sum(te.duration_minutes)
                     FROM public.time_entries te
                    WHERE te.work_item_id = w.id), 0)
                 ELSE 0 END))
        FROM public.work_items w
        LEFT JOIN public.work_item_backlog_ranks r
          ON r.work_item_id = w.id
         AND r.backlog_id = w.backlog_assignments ->> _link.tree_id
       WHERE w.id = ANY(_items)
    ), '[]'::jsonb)
  );
END;
$function$;

-- CREATE OR REPLACE keeps the existing privileges; restated so this file
-- stands on its own. This remains the one function anonymous visitors can call.
GRANT EXECUTE ON FUNCTION public.get_published_backlog(text) TO anon, authenticated;
