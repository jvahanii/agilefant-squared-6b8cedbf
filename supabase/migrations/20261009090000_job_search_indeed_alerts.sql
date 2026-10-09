-- Search for Indeed's job alerts in saved job searches.
--
-- The job import reads a new sender: the alerts Indeed mails from
-- donotreply@jobalert.indeed.com. As with the senders added before it, a
-- search saved earlier keeps the query it was saved with and would go on not
-- finding these.
--
-- Only searches still shaped like the starting query are touched — a job
-- search whose query opens with the from:( … ) list of senders and names the
-- LinkedIn alert address in it. The new address joins the list; whatever
-- follows it is left as it is, and a query somebody has rewritten is theirs.

UPDATE public.gmail_import_queries
SET query = regexp_replace(query, '^from:\(([^)]*)\)', 'from:(\1 OR donotreply@jobalert.indeed.com)')
WHERE import_mode = 'jobs'
  AND query ~ '^from:\([^)]*jobalerts-noreply@linkedin\.com[^)]*\)'
  AND query NOT ILIKE '%indeed.com%';
