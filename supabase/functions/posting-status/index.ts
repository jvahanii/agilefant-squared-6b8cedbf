// Is a job posting still taking applications?
//
// The browser cannot answer this: a job board serves no CORS headers, so a page
// fetched from the app is unreadable to it. The server can, and already knows
// how -- this is the same fetch and the same phrase matching the Gmail import
// uses to grey out a closed posting in its picker, pointed at links that are
// already work items.
//
// It reports; it writes nothing. What to do about a closed ad is the reader's
// decision, made in the backlog.

import { adminClient, corsHeaders, json } from '../_shared/gmail.ts';
import { requireAppUser } from '../_shared/auth.ts';
import { factsForUrls } from '../_shared/fetchDeadline.ts';

/**
 * Per call. The caller sends a backlog in batches rather than in one request:
 * each fetch may sit out a six-second timeout, so an unbounded list could run
 * past the function's own deadline and return nothing at all. Smaller calls also
 * let the caller show progress.
 */
const MAX_URLS = 50;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const user = await requireAppUser(req);

    // The button that calls this is superuser-only, and the rule is repeated
    // here because the endpoint is the thing worth protecting: it fetches
    // arbitrary URLs from the server's own address. Gating that in the UI alone
    // would leave it open to any signed-in account that called it directly.
    const { data: profile } = await adminClient()
      .from('profiles')
      .select('is_superuser')
      .eq('id', user.id)
      .maybeSingle();
    if (!profile?.is_superuser) throw new Error('forbidden: superuser only');

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const urls = (Array.isArray(body.urls) ? body.urls : [])
      .filter((u: unknown): u is string => typeof u === 'string' && u.length > 0)
      .slice(0, MAX_URLS);
    if (urls.length === 0) return json({ error: 'urls is required' }, 400);

    const facts = await factsForUrls(urls);

    const results = urls.map((url: string) => ({
      url,
      closed: facts[url]?.closed ?? false,
      deadline: facts[url]?.deadline ?? null,
      // Says nothing was learnt, as against the posting being open. The caller
      // must be able to tell those apart, or a board that turns us away reports
      // a backlog of dead ads as a healthy one.
      unreachable: facts[url]?.unreachable ?? null,
    }));

    // A line per call saying how the fetches went: closed, open, and what the
    // boards answered when they would not talk. Without it, a sweep that a
    // board quietly refused looks exactly like a sweep that found nothing.
    const refusals: Record<string, number> = {};
    for (const r of results) {
      if (r.unreachable !== null) refusals[r.unreachable] = (refusals[r.unreachable] ?? 0) + 1;
    }
    console.log(
      `posting-status: ${results.length} urls, ${results.filter((r) => r.closed).length} closed, ` +
        `${results.filter((r) => !r.closed && r.unreachable === null).length} open, ` +
        `unreachable ${JSON.stringify(refusals)}`,
    );

    return json({ results });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('posting-status error:', message);
    if (message.startsWith('unauthorized')) return json({ error: 'unauthorized' }, 401);
    if (message.startsWith('forbidden')) return json({ error: message }, 403);
    return json({ error: message }, 500);
  }
});
