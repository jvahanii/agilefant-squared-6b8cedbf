-- Search for Danske Bank's job alerts in saved job searches.
--
-- The job import reads a new sender: "New job opportunities in Danske Bank" from
-- hrplatform-noreply@hr.danskebank.com. As with the senders added before it, a
-- search saved earlier keeps the query it was saved with and would go on not
-- finding these. Only searches still shaped like the starting query are touched;
-- a query somebody has rewritten is theirs.

UPDATE public.gmail_import_queries
SET query = regexp_replace(query, '^from:\(([^)]*)\)', 'from:(\1 OR hrplatform-noreply@hr.danskebank.com)')
WHERE import_mode = 'jobs'
  AND query ~ '^from:\([^)]*jobalerts-noreply@linkedin\.com[^)]*\)'
  AND query NOT ILIKE '%hr.danskebank.com%';
