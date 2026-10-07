-- Let a saved job search read company career pages as well as job alert mail.
--
-- An alert mail is a list of postings somebody else chose to send. A company's
-- own "open positions" page is the same list without the wait, and without a
-- board in between. A saved job search can now name such pages; running it
-- reads each one and offers the positions on it beside what the mail brought.
--
-- Two things mail gives for free have to be kept here instead:
--
--   * which pages to read            -> gmail_import_queries.career_pages
--   * which positions were turned down -> career_page_seen_postings
--
-- A mail that has been dealt with is marked read and drops out of an "only
-- unread" search. A page has no such mark: the positions nobody wanted would
-- come back as new on every run. So the ones a run listed and did not import
-- are remembered per search, and not offered again.

ALTER TABLE public.gmail_import_queries
  ADD COLUMN IF NOT EXISTS career_pages text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.gmail_import_queries.career_pages IS
  'Company career pages a job search reads beside the mail: each one''s open positions are offered in the picker. Addresses, in the order given.';

CREATE TABLE IF NOT EXISTS public.career_page_seen_postings (
  query_id uuid NOT NULL REFERENCES public.gmail_import_queries(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  url text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (query_id, url)
);

COMMENT ON TABLE public.career_page_seen_postings IS
  'Positions a job search has listed from a career page and need not offer again — the page''s stand-in for marking a mail read.';

-- Read and written only by the gmail-connector function, with the service
-- role, after it has checked the caller belongs to the organization. No policy
-- on purpose: nothing in the browser has any business here.
ALTER TABLE public.career_page_seen_postings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.career_page_seen_postings FROM anon, authenticated;
GRANT ALL ON public.career_page_seen_postings TO service_role;

-- The one job search there is, in the organization this was asked for: read
-- Reaktor's open positions too. A no-op where the search does not exist or
-- already names the page.
UPDATE public.gmail_import_queries
SET career_pages = array_append(career_pages, 'https://www.reaktor.com/careers/all-open-positions')
WHERE id = 'f1df4f89-7861-4694-862f-8ab494340463'
  AND import_mode = 'jobs'
  AND NOT ('https://www.reaktor.com/careers/all-open-positions' = ANY (career_pages));
