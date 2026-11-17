/**
 * A public list, answered by Cloudflare instead of the database (2026-11-17).
 *
 * The page behind a public link (src/pages/PublicBacklog.tsx) asked the
 * database for the whole list on every visit and every Refresh: two calls,
 * and up to seven when it was slow, each one holding one of the few
 * connections of a small instance that already swaps. A popular list
 * refreshed by many people at once would take it down.
 *
 * This Pages Function stands in front: it asks the database for a link's list
 * (and the link's job-filter features) at most once a minute in each
 * Cloudflare location and gives every other visitor the copy it kept. Asks
 * that arrive together while it is fetching share the one answer.
 *
 * When the database does not answer, a copy up to ten minutes older still
 * serves, marked with when it was fetched; the page says so, as it does for
 * the database's own kept copy. Past that, the page asks the database itself
 * as it always did. So a link that was switched off stops showing within a
 * minute, or eleven while the database is down.
 *
 * Only what anyone with the link may see passes through here: the same
 * functions, called as a signed-out visitor, with the publishable key the
 * app itself carries (src/integrations/supabase/client.ts).
 */

export const SUPABASE_URL = "https://hwwjwkdbautfkhpxuord.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3d2p3a2RiYXV0ZmtocHh1b3JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNzkwNDAsImV4cCI6MjA4OTk1NTA0MH0.PN9xhG95nXlaUJn5DmtoQJ62yn3XJWOsHvZyQF8Zq2I";

/** How long a fetched list is given out as current. */
export const FRESH_SECONDS = 60;
/** How much longer it may stand in while the database does not answer. */
export const SPARE_SECONDS = 600;
/** How long the database is given to answer. */
export const DATABASE_WAIT_MS = 8_000;

const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

/** What the page is given. */
export interface EdgeAnswer {
  /** The list, or null: no such link, or its organisation has public links off. */
  list: unknown;
  /** What get_published_link_features() answered, or null when it did not. */
  features: unknown;
  /** When this was fetched from the database. */
  at: string;
  /** True when it is an older copy given because the database did not answer. */
  spare?: boolean;
}

interface Context {
  request: Request;
  params: { token?: string | string[] };
  waitUntil: (promise: Promise<unknown>) => void;
}

async function ask(fn: string, token: string): Promise<unknown> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ _token: token }),
    signal: AbortSignal.timeout(DATABASE_WAIT_MS),
  });
  if (!response.ok) throw new Error(`${fn} answered ${response.status}`);
  return response.json();
}

/** Asks for the list and its features together. The features may fail
 *  without the list failing: the page is then the plain page. */
async function fetchAnswer(token: string): Promise<{ answer: EdgeAnswer; complete: boolean }> {
  const [list, features] = await Promise.all([
    ask("get_published_backlog", token),
    ask("get_published_link_features", token).catch(() => undefined),
  ]);
  return {
    answer: { list, features: features ?? null, at: new Date().toISOString() },
    complete: features !== undefined,
  };
}

// Asks for the same list that arrive while one is on its way wait for it
// instead of asking again (within one Cloudflare worker).
const onTheirWay = new Map<string, Promise<{ answer: EdgeAnswer; complete: boolean }>>();

function fetchShared(token: string) {
  let pending = onTheirWay.get(token);
  if (!pending) {
    pending = fetchAnswer(token).finally(() => onTheirWay.delete(token));
    onTheirWay.set(token, pending);
  }
  return pending;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // The browser always comes back here: a Refresh is cheap now, and
      // whatever the browser kept could be older than what is kept here.
      "Cache-Control": "no-store",
    },
  });

const kept = (answer: EdgeAnswer, seconds: number) =>
  new Response(JSON.stringify(answer), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${seconds}` },
  });

function cacheOf(): Cache | null {
  const store = (globalThis as { caches?: { default?: Cache } }).caches;
  return store?.default ?? null;
}

export async function onRequestGet(context: Context): Promise<Response> {
  const raw = context.params.token;
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token || !TOKEN.test(token)) {
    // Not a link at all: the same answer as one that does not exist, without asking.
    return json({ list: null, features: null, at: new Date().toISOString() } satisfies EdgeAnswer);
  }

  const cache = cacheOf();
  const origin = new URL(context.request.url).origin;
  const freshKey = new Request(`${origin}/__public-list/fresh/${token}`);
  const spareKey = new Request(`${origin}/__public-list/spare/${token}`);

  const fresh = await cache?.match(freshKey);
  if (fresh) return json(await fresh.json());

  try {
    const { answer, complete } = await fetchShared(token);
    if (cache && complete) {
      context.waitUntil(
        Promise.all([
          cache.put(freshKey, kept(answer, FRESH_SECONDS)),
          cache.put(spareKey, kept(answer, FRESH_SECONDS + SPARE_SECONDS)),
        ]),
      );
    }
    return json(answer);
  } catch {
    const spare = await cache?.match(spareKey);
    if (spare) return json({ ...((await spare.json()) as EdgeAnswer), spare: true });
    // Nothing kept: the page asks the database itself, as it did before.
    return json({ error: "The list could not be fetched just now" }, 503);
  }
}
