-- Job-ad filters on a public page, switched on per link.
--
-- A public page can now carry a panel of filters made for a list of job ads:
-- no Finnish-titled roles, no senior, only what was added this week, where a
-- job was found, and so on. They read an item's name as "Employer - Role" and
-- its first link as where the ad is, which is true of a list of imported job
-- ads and of nothing else — so they are a choice made for one link's target,
-- off by default, and kept where the link's other choices are.
--
-- The page asks for it with the link's own token, through a function of its
-- own: get_published_backlog() decides what a page may *show*, is large, and
-- is left exactly as it is.

ALTER TABLE public.published_link_settings
  ADD COLUMN IF NOT EXISTS job_filters boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.published_link_settings.job_filters IS
  'Whether the public page for this target shows the job-ad filter panel. Off by default.';

-- The same rule as the link's other choices: anyone who can see the tree may
-- make it. Returns what is stored.
CREATE OR REPLACE FUNCTION public.set_published_link_job_filters(
  _tree_id text,
  _backlog_id text,
  _on boolean
)
RETURNS boolean
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
  IF _backlog_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.backlogs WHERE id = _backlog_id AND tree_id = _tree_id
  ) THEN
    RAISE EXCEPTION 'That backlog does not belong to this tree';
  END IF;

  INSERT INTO public.published_link_settings (tree_id, backlog_id, job_filters, updated_by)
  VALUES (_tree_id, _backlog_id, coalesce(_on, false), _uid)
  ON CONFLICT ON CONSTRAINT published_link_settings_target_key
  DO UPDATE SET job_filters = EXCLUDED.job_filters,
                updated_by = EXCLUDED.updated_by,
                updated_at = now();

  RETURN coalesce(_on, false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.set_published_link_job_filters(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_published_link_job_filters(text, text, boolean) TO authenticated;

-- What the page behind a link may do beyond showing the list. Answers only
-- for a link that get_published_backlog() would answer for: null for an
-- unknown link and for one whose organization has sharing off alike.
CREATE OR REPLACE FUNCTION public.get_published_link_features(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _link public.published_links%ROWTYPE;
BEGIN
  IF _token IS NULL OR length(_token) < 20 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _link FROM public.published_links l WHERE l.token = _token;
  IF NOT FOUND OR NOT public.public_links_enabled_for_tree(_link.tree_id) THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'jobFilters',
    coalesce(
      (SELECT s.job_filters
         FROM public.published_link_settings s
        WHERE s.tree_id = _link.tree_id
          AND s.backlog_id IS NOT DISTINCT FROM _link.backlog_id),
      false)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_published_link_features(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_link_features(text) TO anon, authenticated;

-- On for the one list it was made for: "Open jobs". Only where that list
-- exists, so the migration also runs on a database that does not have it.
INSERT INTO public.published_link_settings (tree_id, backlog_id, job_filters)
SELECT b.tree_id, b.id, true
  FROM public.backlogs b
 WHERE b.id = '227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-eb2c6f3f'
ON CONFLICT ON CONSTRAINT published_link_settings_target_key
DO UPDATE SET job_filters = true, updated_at = now();
