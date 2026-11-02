-- Search for MPS's weekly job mail in saved job searches.
--
-- The job import reads a new sender: "MPS viikon työpaikat" from mps@mps.fi. As
-- with the senders added before it, a search saved earlier keeps the query it
-- was saved with and would go on not finding these.
--
-- Only searches still shaped like the starting query are touched, as before:
-- the new address joins the list, and a query somebody has rewritten is theirs.

UPDATE public.gmail_import_queries
SET query = regexp_replace(query, '^from:\(([^)]*)\)', 'from:(\1 OR mps@mps.fi)')
WHERE import_mode = 'jobs'
  AND query ~ '^from:\([^)]*jobalerts-noreply@linkedin\.com[^)]*\)'
  AND query NOT ILIKE '%mps@mps.fi%';
