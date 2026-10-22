// jira-diagnose — owners and admins paste what they saw (a ticket, a time, an
// error) and Lovable AI reads it together with the organization's recent sync
// queue to name the likely cause of a delay or failure and the fix to try.

import { adminClient, corsHeaders, json } from '../_shared/gmail.ts';
import { requireAppUser } from '../_shared/auth.ts';
import { createResponsesCall } from './responses.ts';

const MODEL = 'openai/gpt-6-astra';
const GATEWAY = 'https://ai.gateway.lovable.dev/v1';

const INSTRUCTIONS = `You diagnose a two-way sync between Jira Cloud and Agilefant (a backlog app).
How it works: Jira's webhook (issue created/updated/deleted) calls the sync function, which queues an 'issue' row and drains the queue at once.
Agilefant edits are queued as 'item' rows by a database trigger which calls the function; a cron job every minute retries anything still queued.
'full' rows are full resyncs. A row is retried up to 3 attempts, then left failed. Normal delay is 1-3 seconds.
Jira's own open issue view does not refresh by itself; the user must reload it.
Given the admin's description and the data, answer in the same language the admin wrote in, in this shape:
**Todennäköinen syy** / **Likely cause**: one or two sentences.
**Näyttö** / **Evidence**: the rows or timings that show it.
**Suositeltu korjaus** / **Recommended fix**: concrete steps the admin can take in the app or in Jira.
Say plainly if the data does not show the problem. Do not invent rows.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const org = typeof body.organizationId === 'string' ? body.organizationId : '';
    const details = typeof body.details === 'string' ? body.details.trim() : '';
    if (!org) return json({ error: 'organizationId is required' }, 400);
    if (!details || details.length > 8000) return json({ error: 'Describe the event (1–8000 characters).' }, 400);

    const user = await requireAppUser(req);
    const admin = adminClient();
    const { data: m } = await admin.from('memberships').select('role').eq('user_id', user.id).eq('organization_id', org).maybeSingle();
    const { data: p } = await admin.from('profiles').select('is_superuser').eq('id', user.id).maybeSingle();
    if (!(m && (m.role === 'owner' || m.role === 'admin')) && !p?.is_superuser) return json({ error: 'Owners and admins only' }, 403);

    const apiKey = Deno.env.get('LOVABLE_API_KEY');
    if (!apiKey) return json({ error: 'Lovable AI is not configured' }, 500);

    const [{ data: conn }, { data: queue }, { data: links }] = await Promise.all([
      admin.from('jira_connections').select('enabled, project_key, webhook_url, last_synced_at, last_error').eq('organization_id', org).maybeSingle(),
      admin.from('jira_sync_queue').select('id, kind, ref, queued_at, done_at, attempts, error').eq('organization_id', org).order('id', { ascending: false }).limit(60),
      admin.from('jira_issue_links').select('jira_key, work_item_id, last_error').eq('organization_id', org).not('last_error', 'is', null).limit(20),
    ]);
    const connection = conn ? { ...conn, webhook_url: undefined, webhookRegistered: !!conn.webhook_url } : null;
    const data = JSON.stringify({ now: new Date().toISOString(), connection, recentQueue: queue ?? [], itemErrors: links ?? [] });

    const call = createResponsesCall(req, { baseURL: GATEWAY, apiKey, model: MODEL }, [
      { role: 'user', content: `Admin's description:\n${details}\n\nSync data (JSON):\n${data}` },
    ], INSTRUCTIONS);
    const text: string = await call.result.text;
    if (!text.trim()) return json({ error: 'Lovable AI returned no answer.' }, 502);
    return json({ diagnosis: text });
  } catch (e) {
    const status = (e as { statusCode?: number })?.statusCode;
    const msg = e instanceof Error ? e.message : String(e);
    if (status === 402) return json({ error: 'Lovable AI credits are used up. Add credits in Settings → Plans & credits.' }, 402);
    if (status === 429) return json({ error: 'Lovable AI is busy. Try again in a minute.' }, 429);
    if (status === 403) return json({ error: msg }, 403);
    if (/forbidden|not signed in|unauthor/i.test(msg)) return json({ error: msg }, 401);
    console.error('jira-diagnose:', msg);
    return json({ error: msg }, 500);
  }
});
