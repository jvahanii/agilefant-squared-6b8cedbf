-- Whether a job ad asks for Finnish, read from the ad itself.
--
-- The public page of job ads has a "No Finnish" chip, and until now it judged
-- an ad by the language its title was written in. That is the wrong question
-- twice over: ads written in English end with "fluent Finnish required", and
-- ads written in Finnish say Finnish is not needed. The importer and the
-- closed-ads check already read each ad's page; they now also keep what it
-- says about the language (supabase/functions/_shared/languageRequirement.ts).
--
-- Kept under the ad's address, not under a work item: it is a fact about the
-- ad, the same for everyone who has it on a list. The key is a hash of the
-- address exactly as a work item's link stores it — the one thing both the
-- function that reads the ad and the database that holds the link can compute.

CREATE TABLE IF NOT EXISTS public.posting_language (
  -- SHA-256, in hex, of the link's address as stored.
  url_hash text PRIMARY KEY,
  -- What the ad says. NULL: the page was read and does not say — an ad that
  -- has been taken down, a board that draws its ads with script.
  finnish  text CHECK (finnish IN ('required', 'not_required')),
  -- 'stated': the ad says so in words. 'language': it says nothing about
  -- languages, and this is the one it is written in.
  basis    text CHECK (basis IN ('stated', 'language')),
  -- The ad's own words the verdict was read from, for whoever asks why.
  evidence text,
  read_at  timestamptz NOT NULL DEFAULT now()
);

-- Written by the edge functions through the service role, read by the public
-- page through get_published_link_features() below. Row-level security on with
-- no policies, so no client reads or writes it directly.
ALTER TABLE public.posting_language ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.posting_language IS
  'What each job ad says about needing Finnish, keyed by a hash of the ad''s address as work items link to it. Written by the gmail-connector and posting-status edge functions.';

-- What the page behind a link may do beyond showing the list — and, for a
-- page with the job-ad filters on, what each of its jobs' ads says about
-- Finnish. Only for the items the page shows: the same backlogs and the same
-- organizations get_published_backlog() reads, so nothing is said here about
-- an item the page does not list.
CREATE OR REPLACE FUNCTION public.get_published_link_features(_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _link public.published_links%ROWTYPE;
  _job_filters boolean;
  _scope text[];
  _orgs uuid[];
  _finnish jsonb := '{}'::jsonb;
BEGIN
  IF _token IS NULL OR length(_token) < 20 THEN
    RETURN NULL;
  END IF;

  SELECT * INTO _link FROM public.published_links l WHERE l.token = _token;
  IF NOT FOUND OR NOT public.public_links_enabled_for_tree(_link.tree_id) THEN
    RETURN NULL;
  END IF;

  _job_filters := coalesce(
    (SELECT s.job_filters
       FROM public.published_link_settings s
      WHERE s.tree_id = _link.tree_id
        AND s.backlog_id IS NOT DISTINCT FROM _link.backlog_id),
    false);

  IF _job_filters THEN
    -- The backlogs in view, as get_published_backlog() works them out.
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

    -- An item with several links goes by the first of them whose ad said
    -- anything, in the order the page lists them.
    SELECT coalesce(jsonb_object_agg(v.work_item_id, v.finnish), '{}'::jsonb) INTO _finnish
      FROM (
        SELECT DISTINCT ON (h.work_item_id) h.work_item_id, pl.finnish
          FROM public.work_items w
          JOIN public.work_item_hyperlinks h ON h.work_item_id = w.id
          JOIN public.posting_language pl
            ON pl.url_hash = encode(sha256(convert_to(h.url, 'UTF8')), 'hex')
         WHERE w.organization_id = ANY(_orgs)
           AND w.backlog_assignments ->> _link.tree_id = ANY(_scope)
           AND pl.finnish IS NOT NULL
         ORDER BY h.work_item_id, h.rank, h.created_at
      ) v;
  END IF;

  RETURN jsonb_build_object('jobFilters', _job_filters, 'finnish', _finnish);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_published_link_features(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_link_features(text) TO anon, authenticated;
