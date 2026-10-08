-- Search for Tieto's job alerts in saved job searches.
--
-- The job import reads a new sender: the alerts Tieto's own career site mails
-- from careers@tietoevry.com. A new saved search starts out looking for every
-- sender the import can read, but a search saved earlier keeps the query it
-- was saved with — so it would go on not finding these.
--
-- Only searches still shaped like that starting query are touched: a job
-- search whose query opens with the from:( … ) list of senders and names the
-- LinkedIn alert address in it. The new address joins the list; whatever
-- follows it — the look-back window, is:unread, a label — is left as it is.
-- A query somebody has rewritten is theirs.

UPDATE public.gmail_import_queries
SET query = regexp_replace(query, '^from:\(([^)]*)\)', 'from:(\1 OR careers@tietoevry.com)')
WHERE import_mode = 'jobs'
  AND query ~ '^from:\([^)]*jobalerts-noreply@linkedin\.com[^)]*\)'
  AND query NOT ILIKE '%tietoevry.com%';
