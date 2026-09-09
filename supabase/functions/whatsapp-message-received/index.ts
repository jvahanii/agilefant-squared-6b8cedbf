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
    // Prefer header-based token; only fall back to query param for backward
    // compatibility with already-deployed webhook URLs. The header avoids
    // leaking the secret into edge function access logs.
    const token = req.headers.get('x-webhook-token') ?? new URL(req.url).searchParams.get('token');
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

    // Accept either JSON or a plain-text body. A notification-forwarding app on
    // a phone can only send the message text verbatim — embedding it in JSON
    // would need the sender to escape quotes and newlines, and an unescaped
    // newline makes the whole request unparseable, silently dropping the
    // message. A raw body sidesteps that entirely; the sender name then travels
    // in the X-From-Name header.
    const rawBody = await req.text();
    let parsed: unknown;
    if (rawBody.trim()) {
      try { parsed = JSON.parse(rawBody); } catch { /* not JSON — handled below */ }
    }
    const payload: Record<string, unknown> = (parsed && typeof parsed === 'object')
      ? parsed as Record<string, unknown>
      : {
          body: typeof parsed === 'string' ? parsed : rawBody,
          from_name: req.headers.get('x-from-name') ?? undefined,
        };
    // Avoid logging full payload (contains private message content / PII).

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
      if (integ.chat_id && m.chat_id && m.chat_id !== integ.chat_id) continue;
      if (m.type && m.type !== 'text') continue;

      // People post lists into the group, so every non-empty line becomes its
      // own work item rather than one item holding the whole message.
      const lines = (m.text?.body ?? m.body ?? '')
        .toString()
        .split(/\r?\n/)
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0);
      if (lines.length === 0) continue;
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
      const minRank = candidates.length ? Math.min(...candidates) : 0;
      // Reserve a contiguous block above everything already in the backlog, so
      // the lines land in the order they were written with the first on top.
      let nextRank = minRank - lines.length;

      for (const line of lines) {
        const title = line.slice(0, 300);
        const rank = nextRank++;
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
          rank,
        });
        if (wiErr) { console.error('insert work_item failed', wiErr); continue; }

        const { error: rankErr } = await supabase.from('work_item_backlog_ranks').insert({
          organization_id: integ.organization_id,
          work_item_id: workItemId,
          backlog_id: integ.backlog_id,
          rank,
        });
        if (rankErr) console.error('insert rank failed', rankErr);

        created.push(workItemId);
      }
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
