-- Put public link sharing behind an organization setting, off by default.
--
-- A public link makes a backlog readable by anyone holding the address, with no
-- account. That is a decision for an organization to take, not something every
-- organization should find already switched on.
--
-- The setting is enforced here and not only in the app. Hiding the controls
-- would stop anyone *making* a link, but every link already made would go on
-- serving its page, and an organization that switched sharing off would reasonably
-- believe its backlogs had stopped being public. So:
--
--   - get_published_backlog() answers nothing for a link whose organization has
--     sharing off. The page says the link isn't available, exactly as it does for
--     an unknown one, so it gives away nothing about why.
--   - publish_backlog_link() refuses to create one.
--   - unpublish_backlog_link() is left alone: taking a link down must always work.
--
-- Switching sharing off deletes nothing. The links keep their tokens, and turning
-- it back on restores every one of them at the address it had.
--
-- Only the organization named Agilefant has any public links today, six of them,
-- and it keeps sharing on. No other organization loses a working link.
--
-- Both functions are wrapped rather than rewritten. get_published_backlog() is
-- some three hundred lines, and the live definitions have drifted from the files
-- before; renaming the live function and calling it from a checked wrapper
-- changes exactly one thing, whatever that body currently says.

-- 1. The setting. Writing it is already limited to owners, admins and
--    superusers by the existing policies on organization_settings.
ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS public_links_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organization_settings.public_links_enabled IS
  'Whether backlogs and trees in this organization may be shared by public link. Enforced by get_published_backlog and publish_backlog_link, not only in the app.';

-- 2. Agilefant keeps it. By id rather than name, since a name is not unique;
--    guarded so a database without this organization simply skips it.
INSERT INTO public.organization_settings (organization_id, public_links_enabled)
SELECT o.id, true
  FROM public.organizations o
 WHERE o.id = '227ff1d1-36df-4f46-b97e-483ada92ccfb'  -- Agilefant
ON CONFLICT (organization_id)
  DO UPDATE SET public_links_enabled = true, updated_at = now();

-- 3. The one question both wrappers ask. A tree with no settings row, or no
--    tree at all, is off: the default has to be the closed one.
CREATE OR REPLACE FUNCTION public.public_links_enabled_for_tree(_tree_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce((
    SELECT s.public_links_enabled
      FROM public.backlog_trees t
      JOIN public.organization_settings s ON s.organization_id = t.organization_id
     WHERE t.id = _tree_id
  ), false);
$$;

-- Internal. The app reads the setting from organization_settings directly.
REVOKE EXECUTE ON FUNCTION public.public_links_enabled_for_tree(text) FROM PUBLIC, anon, authenticated;

-- 4. get_published_backlog(): rename the live body, then put the check in front.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'get_published_backlog_unchecked'
  ) THEN
    ALTER FUNCTION public.get_published_backlog(text) RENAME TO get_published_backlog_unchecked;
  END IF;
END $$;

-- The grants travel with a renamed function, and this one was executable by
-- PUBLIC and anon. Left in place, anyone could call the unchecked body directly
-- and the setting would stop nothing.
REVOKE EXECUTE ON FUNCTION public.get_published_backlog_unchecked(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_published_backlog(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _tree public.published_links.tree_id%TYPE;
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

  RETURN public.get_published_backlog_unchecked(_token);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_published_backlog(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_backlog(text) TO anon, authenticated;

-- 5. publish_backlog_link(): the same arrangement, refusing instead of answering.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'publish_backlog_link_unchecked'
  ) THEN
    ALTER FUNCTION public.publish_backlog_link(text, text) RENAME TO publish_backlog_link_unchecked;
  END IF;
END $$;

REVOKE EXECUTE ON FUNCTION public.publish_backlog_link_unchecked(text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.publish_backlog_link(_tree_id text, _backlog_id text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.public_links_enabled_for_tree(_tree_id) THEN
    RAISE EXCEPTION 'Public links are turned off for this organization'
      USING ERRCODE = '42501',
            HINT = 'An owner or admin can turn them on in organization settings.';
  END IF;

  -- The body keeps its own membership check. current_user_id() reads the
  -- caller's token claims, which a security definer does not change, so it
  -- still sees who is really asking.
  RETURN public.publish_backlog_link_unchecked(_tree_id, _backlog_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.publish_backlog_link(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_backlog_link(text, text) TO authenticated;
