// Finding out where a job alert's tracking links lead.
//
// Most boards' trackers carry their destination and are decoded without a
// request (see urls.ts). Indeed's do not: what a link leads to is encrypted
// into it, and the only way to learn a posting's address is to ask the tracker,
// which answers with a redirect. Without that there is nothing to tell one
// posting from another by, and nothing fit to keep on a work item — the tracker
// itself is personal to the recipient and differs in every mail.
//
// So each such link is requested once, and only as far as its own redirect:
// the answer's Location header is read and never followed. The site the
// posting lives on is not contacted at all. To the board this is the recipient
// opening each job in the alert once.
//
// Kept apart from jobSources.ts, which is pure, and takes its fetch as an
// argument so it can be tested without a network.

import { jobSourceFor, type JobSource } from './jobSources.ts';

/** Links resolved per search, so a mailbox full of alerts cannot become a crawl. */
export const MAX_RESOLVED_LINKS = 80;
const CONCURRENCY = 6;
const TIMEOUT_MS = 5_000;
/** A tracker may hand over to a second tracker before the posting; no further. */
const MAX_HOPS = 2;

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** Where a tracker leads, as a posting's address — or null when it is not one. */
async function follow(url: string, source: JobSource, fetcher: Fetcher): Promise<string | null> {
  let current = url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let location: string | null;
    try {
      const res = await fetcher(current, { redirect: 'manual', signal: controller.signal });
      location = res.headers.get('location');
      // Only the header was wanted.
      await res.body?.cancel().catch(() => undefined);
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (!location) return null;
    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return null;
    }
    const posting = source.fromRedirect?.(next);
    if (posting) return posting;
    // Anywhere else — a search page, an account page, an advert's own
    // redirect — is not a posting, and is not gone to.
    if (!source.unresolved?.(next)) return null;
    current = next.toString();
  }
  return null;
}

/**
 * The links with every tracker that had to be followed replaced by the posting
 * it leads to. A tracker that leads to no posting is dropped, as is one past
 * the limit — its mail stays as it was, and is read again on the next search.
 * A posting two trackers in one mail lead to is kept once. Links from senders
 * that need none of this pass through untouched, in their order.
 */
export async function resolveJobLinks<T extends { url: string; from?: string; messageId?: string }>(
  links: T[],
  fetcher: Fetcher = (url, init) => fetch(url, init),
  limit: number = MAX_RESOLVED_LINKS,
): Promise<T[]> {
  const pending: Array<{ index: number; source: JobSource }> = [];
  links.forEach((link, index) => {
    const source = jobSourceFor(link.from ?? '');
    if (!source?.unresolved || !source.fromRedirect) return;
    try {
      if (source.unresolved(new URL(link.url))) pending.push({ index, source });
    } catch {
      /* not an address: left as it is */
    }
  });
  if (pending.length === 0) return links;

  const resolved = new Map<number, string | null>();
  const queue = pending.slice(0, limit);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        const job = queue[next++];
        if (!job) return;
        resolved.set(job.index, await follow(links[job.index].url, job.source, fetcher));
      }
    }),
  );

  const waiting = new Set(pending.map((p) => p.index));
  const seen = new Set<string>();
  const out: T[] = [];
  links.forEach((link, index) => {
    if (!waiting.has(index)) {
      out.push(link);
      return;
    }
    const url = resolved.get(index);
    if (!url) return;
    const key = `${link.messageId ?? ''}|${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ ...link, url });
  });
  return out;
}
