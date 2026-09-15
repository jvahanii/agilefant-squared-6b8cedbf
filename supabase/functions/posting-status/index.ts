// Is a job posting still taking applications?
//
// The browser cannot answer this: a job board serves no CORS headers, so a page
// fetched from the app is unreadable to it. The server can, and already knows
// how -- this is the same fetch and the same phrase matching the Gmail import
// uses to grey out a closed posting in its picker, pointed at links that are
// already work items.
//
// It changes nothing anyone owns: no work item, no title, no status. What to do
// about a closed ad is the reader's decision, made in the backlog. The one thing
// it does write is its own memory of what each posting last said, so that asking
// twice costs one request -- see postingCache.ts and posting_checks.

import { adminClient, corsHeaders, json } from '../_shared/gmail.ts';
import { requireAppUser } from '../_shared/auth.ts';
import { factsForUrls, postingTextUrl } from '../_shared/fetchDeadline.ts';
import { hashTarget, usable, type Verdict } from '../_shared/postingCache.ts';

// Structural, for the same reason gmailImport.ts uses one: the client's type
// comes from a Deno URL import that the app's typecheck cannot follow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/**
 * Per call. The caller sends a backlog in batches rather than in one request:
 * each fetch may sit out a six-second timeout, so an unbounded list could run
 * past the function's own deadline and return nothing at all. Smaller calls also
 * let the caller show progress.
 */
const MAX_URLS = 50;

async function recall(admin: Admin, hashes: string[]): Promise<Map<string, Verdict>> {
  const out = new Map<string, Verdict>();
  if (hashes.length === 0) return out;
  const { data, error } = await admin
    .from('posting_checks')
    .select('target_hash, closed, deadline, checked_at')
    .in('target_hash', hashes);
  // A cache that cannot be read is not a failure worth refusing the request
  // over: it only means everything has to be fetched, as it was before.
  if (error) {
    console.error('posting-status: could not read the cache:', error.message);
    return out;
  }
  for (const row of data ?? []) {
    out.set(row.target_hash, {
      closed: row.closed,
      deadline: row.deadline,
      checkedAt: new Date(row.checked_at).getTime(),
    });
  }
  return out;
}

/** Keep only what was actually learnt. A refusal teaches nothing worth storing. */
async function remember(
  admin: Admin,
  urls: string[],
  targets: Map<string, string>,
  hashes: Map<string, string>,
  facts: Record<string, { closed?: boolean; deadline?: string; unreachable?: number }>,
): Promise<void> {
  const rows = [];
  const written = new Set<string>();
  for (const url of urls) {
    const fact = facts[url];
    const hash = hashes.get(url);
    const target = targets.get(url);
    if (!fact || fact.unreachable !== undefined || !hash || !target) continue;
    if (written.has(hash)) continue;
    written.add(hash);
    rows.push({
      target_hash: hash,
      target,
      closed: fact.closed ?? false,
      deadline: fact.deadline ?? null,
      checked_at: new Date().toISOString(),
    });
  }
  if (rows.length === 0) return;
  const { error } = await admin.from('posting_checks').upsert(rows, { onConflict: 'target_hash' });
  if (error) console.error('posting-status: could not write the cache:', error.message);
}

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

    const admin = adminClient();

    // Ask the memory first. Every URL a remembered verdict covers is one the
    // board is not asked about again -- which is the whole of the answer to
    // being refused: not a cleverer request, but far fewer of them.
    const targets = new Map<string, string>();
    for (const url of urls) {
      const target = postingTextUrl(url);
      if (target) targets.set(url, target);
    }
    const hashes = new Map<string, string>();
    for (const [url, target] of targets) hashes.set(url, await hashTarget(target));

    const remembered = await recall(admin, [...new Set(hashes.values())]);

    const stale: string[] = [];
    for (const url of urls) {
      const hit = remembered.get(hashes.get(url) ?? '');
      if (!hit || !usable(hit)) stale.push(url);
    }

    const facts = stale.length > 0 ? await factsForUrls(stale) : {};
    await remember(admin, stale, targets, hashes, facts);

    const results = urls.map((url: string) => {
      const fresh = facts[url];
      // A fetch that came back with nothing falls back on what was remembered:
      // an old answer beats no answer, and it is the one the board gave.
      if (fresh && fresh.unreachable === undefined) {
        return { url, closed: fresh.closed ?? false, deadline: fresh.deadline ?? null, unreachable: null };
      }
      const hit = remembered.get(hashes.get(url) ?? '');
      if (hit) return { url, closed: hit.closed, deadline: hit.deadline, unreachable: null };
      return {
        url,
        closed: false,
        deadline: null,
        // Says nothing was learnt, as against the posting being open. The caller
        // must be able to tell those apart, or a board that turns us away reports
        // a backlog of dead ads as a healthy one.
        unreachable: fresh?.unreachable ?? 0,
      };
    });

    // A line per call saying how the fetches went: closed, open, and what the
    // boards answered when they would not talk. Without it, a sweep that a
    // board quietly refused looks exactly like a sweep that found nothing.
    const refusals: Record<string, number> = {};
    for (const r of results) {
      if (r.unreachable !== null) refusals[r.unreachable] = (refusals[r.unreachable] ?? 0) + 1;
    }
    console.log(
      `posting-status: ${results.length} urls, ${results.length - stale.length} remembered, ` +
        `${results.filter((r) => r.closed).length} closed, ` +
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
