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

const MAX_MESSAGES = 50;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const admin = adminClient();
    const { data: queries, error } = await admin
      .from('gmail_import_queries')
      .select('*')
      .eq('schedule_enabled', true);
    if (error) throw error;

    const now = Date.now();
    const results: Array<{ id: string; status: string; created?: number; skipped?: number }> = [];

    for (const q of queries ?? []) {
      const dueAfterMs = q.frequency === 'hourly' ? 55 * 60 * 1000 : 23 * 60 * 60 * 1000;
      const last = q.last_run_at ? new Date(q.last_run_at).getTime() : 0;
      if (now - last < dueAfterMs) continue;

      let status = 'ok';
      let created = 0;
      let skipped = 0;
      try {
        const { key } = await getConnection(admin, q.user_id);
        const mode = q.import_mode === 'jobs' ? 'jobs' : 'links';
        const links = await searchLinks(key, q.query, MAX_MESSAGES, mode);
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
        status = `error: ${e instanceof Error ? e.message : String(e)}`;
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
