-- Public, read-only links to a backlog tree or a single backlog.
--
-- Anonymous visitors must be able to read what a link points at, while all 124
-- RLS policies stay exactly as they are. So nothing here widens a policy.
-- Instead, a link is an unguessable token, and one SECURITY DEFINER function
-- decides what that token may see and returns it as a single payload. The table
-- itself has no insert/update/delete policy at all: links are created and
-- revoked only through the two functions below, which is where the permission
-- check lives.
--
-- What a link exposes: tree and backlog names and structure, and for each item
-- its title, description, status, points and nesting. Deliberately not: who
-- anyone is, time entries, labels, hyperlinks, financial targets, respawn
-- settings. That list lives in get_published_backlog() and nowhere else.
--
-- The whole tree is published as it appears in the app, which for a tree shared
-- with other organizations includes items those organizations created. The
-- owning organization's owners and admins are the ones who decide.

CREATE TABLE public.published_links (
  -- 24 random bytes, base64url: 192 bits, so a token cannot be guessed and the
  -- set of published links cannot be enumerated.
  token text PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  tree_id text NOT NULL REFERENCES public.backlog_trees(id) ON DELETE CASCADE,
  -- NULL publishes the whole tree; otherwise this backlog and everything under
  -- it, which is what selecting it in the app shows.
  backlog_id text REFERENCES public.backlogs(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One link per target, so publishing twice hands back the same link rather
  -- than scattering several that each need revoking.
  CONSTRAINT published_links_one_per_target UNIQUE NULLS NOT DISTINCT (tree_id, backlog_id)
);

CREATE INDEX published_links_tree_id_idx ON public.published_links (tree_id);

ALTER TABLE public.published_links ENABLE ROW LEVEL SECURITY;

-- Anyone who can see the tree can see whether it is published, and copy the
-- link. Only the functions below can change that.
CREATE POLICY "Tree members can see published links"
  ON public.published_links
  FOR SELECT
  TO authenticated
  USING (public.is_tree_accessible(public.current_user_id(), tree_id));

-- ─── Publish ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.publish_backlog_link(_tree_id text, _backlog_id text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _org uuid;
  _token text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  -- The same check that gates sharing a tree with another organization.
  IF NOT (public.is_tree_admin(_uid, _tree_id) OR public.is_superuser(_uid)) THEN
    RAISE EXCEPTION 'Only owners and admins of the organization that owns this tree can publish it';
  END IF;

  SELECT organization_id INTO _org FROM public.backlog_trees WHERE id = _tree_id;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'Backlog tree not found';
  END IF;

  IF _backlog_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.backlogs WHERE id = _backlog_id AND tree_id = _tree_id
  ) THEN
    RAISE EXCEPTION 'That backlog does not belong to this tree';
  END IF;

  SELECT token INTO _token
    FROM public.published_links
   WHERE tree_id = _tree_id AND backlog_id IS NOT DISTINCT FROM _backlog_id;
  IF _token IS NOT NULL THEN
    RETURN _token;
  END IF;

  _token := translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_');

  BEGIN
    INSERT INTO public.published_links (token, organization_id, tree_id, backlog_id, created_by)
    VALUES (_token, _org, _tree_id, _backlog_id, _uid);
  EXCEPTION WHEN unique_violation THEN
    -- Someone published the same target a moment earlier; hand back theirs.
    SELECT token INTO _token
      FROM public.published_links
     WHERE tree_id = _tree_id AND backlog_id IS NOT DISTINCT FROM _backlog_id;
  END;

  RETURN _token;
END;
$function$;

-- ─── Unpublish ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.unpublish_backlog_link(_tree_id text, _backlog_id text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT (public.is_tree_admin(_uid, _tree_id) OR public.is_superuser(_uid)) THEN
    RAISE EXCEPTION 'Only owners and admins of the organization that owns this tree can unpublish it';
  END IF;

  -- Deleting the row kills the token outright: publishing again mints a new
  -- one, so an old link that has spread stays dead.
  DELETE FROM public.published_links
   WHERE tree_id = _tree_id AND backlog_id IS NOT DISTINCT FROM _backlog_id;
END;
$function$;

-- ─── Read ──────────────────────────────────────────────────────────────────
-- The only thing an anonymous visitor can call. Returns NULL for any token
-- that does not exist, so a revoked link and a made-up one look identical.
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
    'backlogs', coalesce((
      SELECT jsonb_agg(
               jsonb_build_object('id', b.id, 'name', b.name, 'parentId', b.parent_id, 'rank', b.rank)
               ORDER BY b.rank, b.id)
        FROM public.backlogs b
       WHERE b.id = ANY(_scope)
    ), '[]'::jsonb),
    -- Each backlog's effective statuses: its own if it has any, else the
    -- nearest ancestor's — including ancestors above a published backlog, whose
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
               'rank', r.rank))
        FROM public.work_items w
        LEFT JOIN public.work_item_backlog_ranks r
          ON r.work_item_id = w.id
         AND r.backlog_id = w.backlog_assignments ->> _link.tree_id
       WHERE w.backlog_assignments ->> _link.tree_id = ANY(_scope)
    ), '[]'::jsonb)
  );
END;
$function$;

-- Functions in this schema are executable by anon by default. Publishing and
-- unpublishing refuse a NULL user anyway, but they have no business being
-- callable without a session at all.
REVOKE EXECUTE ON FUNCTION public.publish_backlog_link(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unpublish_backlog_link(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_backlog_link(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpublish_backlog_link(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_published_backlog(text) TO anon, authenticated;
