-- Let anyone who can see a tree publish it, not just owners and admins.
--
-- Publishing was gated on is_tree_admin(), the check that governs sharing a
-- tree with another organization. It is now gated on is_tree_accessible() --
-- the same check that decides whether a user can read the tree at all. That
-- covers every member of the owning organization whatever their role, members
-- of organizations the tree is shared with, and superusers.
--
-- Unpublishing follows the same rule. Otherwise a member could publish a link
-- that nobody but an admin could take back down.
--
-- What a link exposes is unchanged: that is decided by get_published_backlog()
-- alone, and this migration does not touch it.

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

  -- Anyone who can see the tree may publish it. is_tree_accessible() already
  -- includes superusers.
  IF NOT public.is_tree_accessible(_uid, _tree_id) THEN
    RAISE EXCEPTION 'You do not have access to this backlog tree';
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
  IF NOT public.is_tree_accessible(_uid, _tree_id) THEN
    RAISE EXCEPTION 'You do not have access to this backlog tree';
  END IF;

  -- Deleting the row kills the token outright: publishing again mints a new
  -- one, so an old link that has spread stays dead.
  DELETE FROM public.published_links
   WHERE tree_id = _tree_id AND backlog_id IS NOT DISTINCT FROM _backlog_id;
END;
$function$;

-- CREATE OR REPLACE keeps the existing privileges, but restating them keeps
-- this file honest on its own: still no anonymous publishing or unpublishing.
REVOKE EXECUTE ON FUNCTION public.publish_backlog_link(text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.unpublish_backlog_link(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_backlog_link(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpublish_backlog_link(text, text) TO authenticated;
