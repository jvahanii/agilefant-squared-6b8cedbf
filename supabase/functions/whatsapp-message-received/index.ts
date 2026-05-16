// WhatsApp webhook receiver (whapi.cloud-compatible).
// Accepts POST {messages: [...]} with `?token=<webhook_secret>` query param.
// For each text message (optionally filtered by integration.chat_id), creates
// an "in_progress" work item at the top of the configured backlog.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WhapiMessage {
  id?: string;
  type?: string;
  from_me?: boolean;
  chat_id?: string;
  from?: string;
  from_name?: string;
  text?: { body?: string };
  // some bridges also send caption / body at top-level
  body?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get('token') ?? req.headers.get('x-webhook-token');
    if (!token) {
      return new Response(JSON.stringify({ error: 'missing token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const { data: integ, error: intErr } = await supabase
      .from('whatsapp_integrations')
      .select('id, organization_id, tree_id, backlog_id, chat_id, enabled')
      .eq('webhook_secret', token)
      .maybeSingle();

    if (intErr) {
      console.error('integration lookup failed', intErr);
      return new Response(JSON.stringify({ error: 'Internal server error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!integ) {
      return new Response(JSON.stringify({ error: 'invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!integ.enabled) {
      return new Response(JSON.stringify({ ignored: true, reason: 'disabled' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const payload = await req.json().catch(() => ({}));
    console.log('whatsapp payload:', JSON.stringify(payload));

    // Whapi wraps live events in `data` (array or object). Also support `messages`,
    // bare arrays, and single `message` objects from other bridges.
    let rawMessages: unknown = payload?.messages ?? payload?.data ?? payload;
    if (payload?.message) rawMessages = [payload.message];

    const messages: WhapiMessage[] = Array.isArray(rawMessages)
      ? (rawMessages as WhapiMessage[])
      : rawMessages && typeof rawMessages === 'object'
        ? [rawMessages as WhapiMessage]
        : [];

    if (messages.length === 0) {
      // ping / verification
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const created: string[] = [];

    for (const m of messages) {
      if (m.from_me) continue; // ignore messages sent by the bridge account itself
      if (integ.chat_id && m.chat_id && m.chat_id !== integ.chat_id) continue;

      const body = (m.text?.body ?? m.body ?? '').toString().trim();
      if (!body) continue;
      const title = body.slice(0, 300);
      const description = m.from_name ? `From ${m.from_name} via WhatsApp` : 'via WhatsApp';

      // Place at top: take min rank from both the ranks table and legacy work_items.rank
      const [{ data: rankRows }, { data: legacyRows }] = await Promise.all([
        supabase
          .from('work_item_backlog_ranks')
          .select('rank')
          .eq('backlog_id', integ.backlog_id)
          .order('rank', { ascending: true })
          .limit(1),
        supabase
          .from('work_items')
          .select('rank')
          .filter('backlog_assignments', 'cs', JSON.stringify({ [integ.tree_id]: integ.backlog_id }))
          .order('rank', { ascending: true })
          .limit(1),
      ]);
      const candidates = [
        rankRows?.[0]?.rank as number | undefined,
        legacyRows?.[0]?.rank as number | undefined,
      ].filter((v): v is number => typeof v === 'number');
      const newRank = (candidates.length ? Math.min(...candidates) : 0) - 1;

      const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
      const workItemId = `${integ.organization_id}::wi-${suffix}`;

      const { error: wiErr } = await supabase.from('work_items').insert({
        id: workItemId,
        organization_id: integ.organization_id,
        title,
        description,
        status: 'in_progress',
        parent_id: null,
        backlog_assignments: { [integ.tree_id]: integ.backlog_id },
        rank: newRank,
      });
      if (wiErr) { console.error('insert work_item failed', wiErr); continue; }

      const { error: rankErr } = await supabase.from('work_item_backlog_ranks').insert({
        organization_id: integ.organization_id,
        work_item_id: workItemId,
        backlog_id: integ.backlog_id,
        rank: newRank,
      });
      if (rankErr) console.error('insert rank failed', rankErr);

      created.push(workItemId);
    }

    return new Response(JSON.stringify({ ok: true, created: created.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('handler error', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
