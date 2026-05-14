// GitHub webhook receiver: when a PR is merged, insert a "done" work item
// at the top of the "Done archive" backlog under the "Agilefant" tree.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-hub-signature-256, x-github-event',
};

// Hardcoded targets (Agilefant tree → Done archive backlog)
const ORG_ID = '227ff1d1-36df-4f46-b97e-483ada92ccfb';
const TREE_ID = '227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-a414aa6c';
const BACKLOG_ID = '227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-ef7b2521';

async function verifySignature(secret: string, body: string, sigHeader: string | null): Promise<boolean> {
  if (!sigHeader || !sigHeader.startsWith('sha256=')) return false;
  const expected = sigHeader.slice('sha256='.length);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const computed = Array.from(new Uint8Array(sigBytes))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  // Constant-time comparison
  if (computed.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) mismatch |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const secret = Deno.env.get('GITHUB_WEBHOOK_SECRET');
    if (!secret) {
      return new Response(JSON.stringify({ error: 'GITHUB_WEBHOOK_SECRET not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256');
    const ok = await verifySignature(secret, rawBody, signature);
    if (!ok) {
      return new Response(JSON.stringify({ error: 'invalid signature' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const event = req.headers.get('x-github-event');
    if (event === 'ping') {
      return new Response(JSON.stringify({ pong: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (event !== 'pull_request') {
      return new Response(JSON.stringify({ ignored: true, reason: `event ${event}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = JSON.parse(rawBody);
    if (payload.action !== 'closed' || !payload.pull_request?.merged) {
      return new Response(JSON.stringify({ ignored: true, reason: 'not a merged PR' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pr = payload.pull_request;
    const title: string = (pr.title ?? `PR #${pr.number}`).toString().slice(0, 300);
    const prNumber: number = pr.number;
    const description = `Merged from ${payload.repository?.full_name ?? 'github'} #${prNumber}\n${pr.html_url ?? ''}`;

    // Service-role client (bypasses RLS — webhook has no user session)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Find current min rank in this backlog → place new item one below it (top of list)
    const { data: ranks, error: ranksErr } = await supabase
      .from('work_item_backlog_ranks')
      .select('rank')
      .eq('backlog_id', BACKLOG_ID)
      .order('rank', { ascending: true })
      .limit(1);
    if (ranksErr) console.error('rank lookup failed', ranksErr);
    const minRank = ranks && ranks.length > 0 ? ranks[0].rank : 0;
    const newRank = (minRank ?? 0) - 1;

    // Generate id matching the project format: <org-uuid>::wi-<8 hex>
    const wiSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const workItemId = `${ORG_ID}::wi-${wiSuffix}`;

    const { error: wiErr } = await supabase.from('work_items').insert({
      id: workItemId,
      organization_id: ORG_ID,
      title,
      description,
      status: 'done',
      parent_id: null,
      backlog_assignments: { [TREE_ID]: BACKLOG_ID },
      rank: newRank,
    });
    if (wiErr) {
      console.error('insert work_item failed', wiErr);
      return new Response(JSON.stringify({ error: wiErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: rankErr } = await supabase.from('work_item_backlog_ranks').insert({
      organization_id: ORG_ID,
      work_item_id: workItemId,
      backlog_id: BACKLOG_ID,
      rank: newRank,
    });
    if (rankErr) console.error('insert rank failed', rankErr);

    return new Response(JSON.stringify({ ok: true, work_item_id: workItemId, rank: newRank }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('handler error', e);
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
