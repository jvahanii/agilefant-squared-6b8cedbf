// Runs saved, scheduled Gmail import queries.  Invoked hourly by pg_cron with
// the service role key.

import {
  adminClient,
  corsHeaders,
  getConnection,
  json,
  searchLinks,
} from '../_shared/gmail.ts';
import { importLinksAsWorkItems } from '../_shared/gmailImport.ts';
import { isDue } from '../_shared/importSchedule.ts';

const MAX_MESSAGES = 50;

/**
 * The status line a saved search shows under "Last run". A scheduled run fails
 * with nobody watching, so the line is the only explanation anyone gets — it
 * should say what to do, not repeat an internal code.
 */
function readableFailure(message: string): string {
  if (message === 'gmail_not_connected') {
    return 'Gmail is not connected, or the connection has expired. Connect Gmail again.';
  }
  if (message === 'oauth_client_not_configured') {
    return "This organization's Google OAuth client is not set up. An owner or admin can add it.";
  }
  if (message === 'oauth_client_rejected') {
    return "Google rejected this organization's OAuth client ID or secret. An owner or admin can replace them.";
  }
  return message;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const admin = adminClient();
    const { data: queries, error } = await admin
      .from('gmail_import_queries')
      .select('*')
      .eq('schedule_enabled', true);
    if (error) throw error;

    const now = new Date();
    const results: Array<{ id: string; status: string; created?: number; skipped?: number }> = [];

    for (const q of queries ?? []) {
      const due = isDue(
        {
          frequency: q.frequency,
          lastRunAt: q.last_run_at,
          runAtHour: q.run_at_hour ?? null,
          runAtTimezone: q.run_at_timezone ?? null,
        },
        now,
      );
      if (!due) continue;

      let status = 'ok';
      let created = 0;
      let skipped = 0;
      try {
        // The organization decides how Gmail is reached: its own OAuth client,
        // or the shared connector if it is one of the few allowed that.
        const { auth } = await getConnection(admin, q.user_id, q.organization_id);
        const mode = q.import_mode === 'jobs' ? 'jobs' : 'links';
        const links = await searchLinks(auth, q.query, MAX_MESSAGES, mode);
        const result = await importLinksAsWorkItems(
          admin,
          {
            organizationId: q.organization_id,
            treeId: q.tree_id,
            backlogId: q.backlog_id,
            queryId: q.id,
            allowDuplicates: mode === 'jobs',
            fetchDeadlines: mode === 'jobs',
          },
          links,
        );
        created = result.created;
        skipped = result.skipped;
        status = `ok: ${created} created, ${skipped} skipped`;
      } catch (e) {
        status = `error: ${readableFailure(e instanceof Error ? e.message : String(e))}`;
        console.error(`query ${q.id} failed:`, status);
      }

      await admin
        .from('gmail_import_queries')
        .update({ last_run_at: new Date().toISOString(), last_run_status: status.slice(0, 500) })
        .eq('id', q.id);

      results.push({ id: q.id, status, created, skipped });
    }

    return json({ ran: results.length, results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('gmail-scheduled-import error:', message);
    return json({ error: message }, 500);
  }
});
