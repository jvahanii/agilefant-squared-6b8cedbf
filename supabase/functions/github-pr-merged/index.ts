// GitHub webhook receiver: when a PR is merged, insert a "done" work item
// at the top of every configured backlog for that repository.
//
// Routing is driven by the `github_repo_integrations` + `github_repo_targets`
// tables. Each integration has its own webhook secret; the same payload URL
// (this function) is used for every repo.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-hub-signature-256, x-github-event',
};

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
  if (computed.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) mismatch |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-hub-signature-256');
    const event = req.headers.get('x-github-event');

    const payload = rawBody ? JSON.parse(rawBody) : {};
    const repoFullName: string | undefined = payload?.repository?.full_name;

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Ping handler: verify against ANY matching integration's secret so
    // setup confirmation works.
    if (event === 'ping') {
      if (!repoFullName) {
        return new Response(JSON.stringify({ pong: true, note: 'no repo in payload' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const { data: integrations } = await supabase
        .from('github_repo_integrations')
        .select('webhook_secret')
        .ilike('repo_full_name', repoFullName);

      for (const i of integrations ?? []) {
        if (await verifySignature(i.webhook_secret, rawBody, signature)) {
          return new Response(JSON.stringify({ pong: true, configured: true }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
      return new Response(JSON.stringify({ pong: true, configured: false }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (event !== 'pull_request') {
      return new Response(JSON.stringify({ ignored: true, reason: `event ${event}` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (payload.action !== 'closed' || !payload.pull_request?.merged) {
      return new Response(JSON.stringify({ ignored: true, reason: 'not a merged PR' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!repoFullName) {
      return new Response(JSON.stringify({ error: 'missing repository.full_name' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const pr = payload.pull_request;
    const title: string = (pr.title ?? `PR #${pr.number}`).toString().slice(0, 300);
    const prNumber: number = pr.number;
    const description = `Merged from ${repoFullName} #${prNumber}\n${pr.html_url ?? ''}`;

    // Find all integrations for this repo across all organizations
    const { data: integrations, error: intErr } = await supabase
      .from('github_repo_integrations')
      .select('id, organization_id, webhook_secret, enabled')
      .ilike('repo_full_name', repoFullName);

    if (intErr) {
      console.error('integration lookup failed', intErr);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!integrations || integrations.length === 0) {
      return new Response(JSON.stringify({ ignored: true, reason: 'no integrations for repo' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const results: Array<{ org: string; backlog: string; work_item_id: string }> = [];
    let verifiedAny = false;

    const envSecret = Deno.env.get('GITHUB_WEBHOOK_SECRET');

    for (const integ of integrations) {
      if (!integ.enabled) continue;
      let ok = await verifySignature(integ.webhook_secret, rawBody, signature);
      // Backward-compat fallback: accept the legacy shared env secret too
      if (!ok && envSecret) ok = await verifySignature(envSecret, rawBody, signature);
      if (!ok) continue;
      verifiedAny = true;

      const { data: targets, error: tErr } = await supabase
        .from('github_repo_targets')
        .select('tree_id, backlog_id')
        .eq('integration_id', integ.id);
      if (tErr) {
        console.error('targets lookup failed', tErr);
        continue;
      }

      for (const tgt of targets ?? []) {
        // Place at top of backlog: find the minimum rank across both the
        // dedicated ranks table AND the legacy work_items.rank column so that
        // items created before the work_item_backlog_ranks migration (which
        // have no entry in that table and fall back to work_items.rank on the
        // client) are taken into account.
        const [{ data: rankRows }, { data: legacyRows }] = await Promise.all([
          supabase
            .from('work_item_backlog_ranks')
            .select('rank')
            .eq('backlog_id', tgt.backlog_id)
            .order('rank', { ascending: true })
            .limit(1),
          supabase
            .from('work_items')
            .select('rank')
            .filter('backlog_assignments', 'cs', JSON.stringify({ [tgt.tree_id]: tgt.backlog_id }))
            .order('rank', { ascending: true })
            .limit(1),
        ]);
        const minFromRanksTable = rankRows && rankRows.length > 0 ? (rankRows[0].rank as number) : null;
        const minFromWorkItems = legacyRows && legacyRows.length > 0 ? (legacyRows[0].rank as number) : null;
        const candidates = [minFromRanksTable, minFromWorkItems].filter((v): v is number => v !== null);
        const minRank = candidates.length > 0 ? Math.min(...candidates) : 0;
        const newRank = minRank - 1;

        const wiSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
        const workItemId = `${integ.organization_id}::wi-${wiSuffix}`;

        const { error: wiErr } = await supabase.from('work_items').insert({
          id: workItemId,
          organization_id: integ.organization_id,
          title,
          description,
          status: 'done',
          parent_id: null,
          backlog_assignments: { [tgt.tree_id]: tgt.backlog_id },
          rank: newRank,
        });
        if (wiErr) {
          console.error('insert work_item failed', wiErr);
          continue;
        }

        const { error: rankErr } = await supabase.from('work_item_backlog_ranks').insert({
          organization_id: integ.organization_id,
          work_item_id: workItemId,
          backlog_id: tgt.backlog_id,
          rank: newRank,
        });
        if (rankErr) console.error('insert rank failed', rankErr);

        results.push({ org: integ.organization_id, backlog: tgt.backlog_id, work_item_id: workItemId });
      }
    }

    if (!verifiedAny) {
      return new Response(JSON.stringify({ error: 'invalid signature for all integrations' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ ok: true, created: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('handler error', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
