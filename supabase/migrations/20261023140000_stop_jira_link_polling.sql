-- Stop polling Jira for web-link changes.
--
-- 20261023104958 asked every space's pairs for their Jira web links every two
-- minutes, since Jira announces no change to them. It slowed the sync: each
-- round read every pair. Hyperlinks still travel both ways whenever an item or
-- an issue changes, and on Sync now; a web link changed in Jira alone comes in
-- with the issue's next change or the next full sync.
--
-- jira_queue_links_check() stays, to be run by hand or scheduled again.

DO $cron$
BEGIN
  PERFORM cron.unschedule('jira-external-links-check')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'jira-external-links-check');
END
$cron$;

-- Checks already queued are dropped rather than run once more.
UPDATE public.jira_sync_queue SET done_at = now(), error = 'link polling stopped'
 WHERE kind = 'links' AND done_at IS NULL;
