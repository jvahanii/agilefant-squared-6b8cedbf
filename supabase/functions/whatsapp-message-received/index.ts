// WhatsApp webhook receiver.
//
// Authenticated with the integration's webhook_secret, sent as an
// X-Webhook-Token header (or a ?token= query param, for URLs already deployed
// before the header existed).
//
// Takes either a plain-text body — the shape a phone forwarding notifications
// can produce, with the sender in X-From-Name — or the JSON a hosted bridge
// posts. Each non-empty line becomes its own "in_progress" work item at the top
// of the configured backlog, skipping lines already on the list, since
// notification forwarders resend recent messages repeatedly.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isUnfilledPlaceholder, senderWithoutUnreadCount, splitMessage } from './split.ts';

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
      .select('id, organization_id, tree_id, backlog_id, chat_id, enabled, split_on_newline, split_on_space, split_delimiters, min_fragment_length')
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
    // The phone was heard from, whatever the request turns out to hold. When the
    // forwarding was switched off nothing said so for nine days; this is what
    // lets the integration show how long it has been quiet. A failure here must
    // not cost the message, so it is only logged.
    {
      const { error: seenErr } = await supabase
        .from('whatsapp_integrations')
        .update({ last_received_at: new Date().toISOString() })
        .eq('id', integ.id);
      if (seenErr) console.error('last_received_at update failed', seenErr);
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
    // The sender may also arrive as a ?from= query param. HTTP headers are
    // ASCII-only, and Android's client throws rather than sending when a value
    // breaks that — a Finnish group title like "Kauppalista (7 viestiä)" was
    // enough to stop the request ever leaving the phone. Query params are
    // percent-encoded, so they carry non-ASCII names safely.
    const payload: Record<string, unknown> = (parsed && typeof parsed === 'object')
      ? parsed as Record<string, unknown>
      : {
          body: typeof parsed === 'string' ? parsed : rawBody,
          from_name: req.headers.get('x-from-name')
            ?? new URL(req.url).searchParams.get('from')
            ?? undefined,
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
    let skipped = 0;

    // A phone forwarding notifications re-sends the same recent lines every
    // time the notification is updated — Android's grouped-message
    // notifications carry the last several messages, not just the newest — so
    // the same text arrives over and over. Skip a line when the backlog
    // already holds an open item with that exact text.
    //
    // Matching on open items rather than a time window means completing or
    // deleting an item lets it be added again, which is what someone asking a
    // second time would expect. The cap keeps this to one bounded query; new
    // items take the lowest ranks, so ordering by rank looks at the newest.
    const seenTitles = new Set<string>();
    {
      const { data: existing, error: existingErr } = await supabase
        .from('work_items')
        .select('title, status')
        .filter('backlog_assignments', 'cs', JSON.stringify({ [integ.tree_id]: integ.backlog_id }))
        .neq('status', 'done')
        .order('rank', { ascending: true })
        .limit(300);
      if (existingErr) console.error('dedupe lookup failed', existingErr);
      for (const row of existing ?? []) {
        const t = (row as { title?: string }).title;
        if (t) seenTitles.add(t.trim().toLowerCase());
      }
    }

    for (const m of messages) {
      if (integ.chat_id && m.chat_id && m.chat_id !== integ.chat_id) continue;
      if (m.type && m.type !== 'text') continue;

      // People post lists into the group, so a message can become several work
      // items. Which characters start a new item is configured per integration
      // (line breaks only, by default).
      const allLines = splitMessage((m.text?.body ?? m.body ?? '').toString(), {
        splitOnNewline: (integ as { split_on_newline?: boolean }).split_on_newline ?? true,
        splitOnSpace: (integ as { split_on_space?: boolean }).split_on_space ?? false,
        delimiters: (integ as { split_delimiters?: string }).split_delimiters ?? '',
        minFragmentLength: (integ as { min_fragment_length?: number }).min_fragment_length ?? 1,
      });
      // Drop anything already on the list, and anything repeated within this
      // request — the same line can appear twice in one forwarded batch.
      // And anything that is only an automation placeholder sent unfilled: a
      // macro run by hand posts "{not_text_lines}" itself.
      const lines = allLines.filter((line: string) => {
        if (isUnfilledPlaceholder(line)) return false;
        const key = line.slice(0, 300).toLowerCase();
        if (seenTitles.has(key)) return false;
        seenTitles.add(key);
        return true;
      });
      skipped += allLines.length - lines.length;
      if (lines.length === 0) continue;
      const sender = m.from_name ? senderWithoutUnreadCount(m.from_name) : '';
      const description = sender ? `From ${sender} via WhatsApp` : 'via WhatsApp';

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

    return new Response(JSON.stringify({ ok: true, created: created.length, skipped }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('handler error', e);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
