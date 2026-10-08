-- Search for Valtiolle.fi's job alerts in saved job searches.
--
-- The job import reads a new sender: the "Hakuvahtitulos" alerts the Finnish
-- state's job site mails from hakuvahti@valtiolle.fi. As with the sender added
-- before it, a search saved earlier keeps the query it was saved with and
-- would go on not finding these.
--
-- Only searches still shaped like the starting query are touched — a job
-- search whose query opens with the from:( … ) list of senders and names the
-- LinkedIn alert address in it. The new address joins the list; whatever
-- follows it is left as it is, and a query somebody has rewritten is theirs.
--
-- hakuvahti@ only: noreply@valtiolle.fi writes about applications already
-- made, and is no list of postings.

UPDATE public.gmail_import_queries
SET query = regexp_replace(query, '^from:\(([^)]*)\)', 'from:(\1 OR hakuvahti@valtiolle.fi)')
WHERE import_mode = 'jobs'
  AND query ~ '^from:\([^)]*jobalerts-noreply@linkedin\.com[^)]*\)'
  AND query NOT ILIKE '%valtiolle.fi%';
