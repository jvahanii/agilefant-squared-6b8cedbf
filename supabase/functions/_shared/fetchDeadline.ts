// Fetching a posting to find its application deadline.
//
// Used only where the mail did not state one. The Finnish digests do, so those
// never reach here; LinkedIn, Jobly, The Hub, jobs2web and Teamtailor do not,
// and their deadline lives in the description.
//
// Everything is best-effort: a failed or slow fetch yields no deadline rather
// than an error. A missing date is a small loss, a wrong one ends up in a work
// item's name.

import { deadlinePassed, parseApplicationsClosed, parseDeadline } from './deadlines.ts';

/** Per request. Long enough for a slow board, short enough not to stall a preview. */
const TIMEOUT_MS = 6_000;
/** Postings fetched concurrently. */
const CONCURRENCY = 6;
/**
 * Gentler, for checking a whole backlog at once.
 *
 * A preview asks about a handful of postings; a backlog check asks about
 * dozens, from a datacentre address, and a job board reads a burst like that as
 * a scraper. Fewer at a time is the one lever that costs nothing but seconds.
 */
const SWEEP_CONCURRENCY = 3;
/** Ceiling per preview, so a wide query cannot turn into hundreds of requests. */
const MAX_FETCHES = 40;

/**
 * Statuses that mean "not now" rather than anything about the posting. 999 is
 * LinkedIn's own: it is what the site returns to an address it has decided is a
 * robot, and it is the likeliest thing to meet when checking a backlog.
 */
const THROTTLED = new Set([429, 503, 999]);
/** One pause and one retry. Longer would cost more than the answer is worth. */
const RETRY_PAUSE_MS = 1_200;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/** Headers a browser would send. A bare user-agent is itself a tell. */
const BROWSER_HEADERS: Record<string, string> = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'en-GB,en;q=0.9,fi;q=0.8',
  'cache-control': 'no-cache',
};

/**
 * Where to fetch a posting's text from.
 *
 * LinkedIn's own job page is a 260 KB shell; its guest endpoint returns the
 * posting on its own, without a login, and includes the whole description --
 * the "…more" button is CSS truncation, not withheld content. Following the
 * Apply button instead would hit a sign-up wall.
 */
/**
 * Does this response status mean the ad itself is gone?
 *
 * A withdrawn posting often answers with a status code rather than a sentence:
 * the address that held it now says "Page not found -- Unable to find job".
 * Only "gone" counts. A 403 or a 429 is the board refusing *us* -- a datacentre
 * address, a burst of requests -- which says nothing about the posting, and
 * treating it as closed would mark a whole backlog shut the moment a board
 * started rate-limiting.
 */
export function closedByStatus(status: number): boolean {
  return status === 404 || status === 410;
}

/** Did postingTextUrl send us to LinkedIn's guest endpoint? */
export function isLinkedInGuest(target: string): boolean {
  return target.startsWith('https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/');
}

export function postingTextUrl(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  if (u.hostname.match(/(^|\.)linkedin\.com$/i)) {
    const fromPath = u.pathname.match(/^\/(?:comm\/)?jobs\/view\/(\d+)/i)?.[1];
    // A link copied out of the jobs feed names the posting in a query parameter
    // instead of the path: /jobs/collections/recommended/?currentJobId=… and
    // /jobs/search-results/?currentJobId=…. Without this, the fetch lands on the
    // feed itself — half a megabyte that says nothing about the posting, so the
    // ad was reported as neither open nor closed however plainly it had ended.
    const fromQuery = u.searchParams.get('currentJobId');
    const id = fromPath ?? (fromQuery && /^\d+$/.test(fromQuery) ? fromQuery : null);
    if (id) return `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;
  }
  return u.toString();
}

/** Visible text of a posting page, tags and scripts removed. */
export function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#(\d+);/g, (_m, c) => String.fromCodePoint(Number(c)))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Has LinkedIn withdrawn the apply button?
 *
 * LinkedIn shows "Not currently accepting applications" to a *signed-in* reader
 * only. Neither the guest endpoint nor the 227 KB public page carries that
 * sentence, or any job status, or a schema.org validThrough — checked against a
 * posting known to be closed. So there is no phrase to match, and the earlier
 * phrase list could never have caught these however it was worded.
 *
 * What the guest markup does show is the top card's call-to-action area: an
 * open posting renders apply buttons into it, a closed one renders the same
 * container empty. Verified across six postings, three open and three closed,
 * splitting exactly that way.
 *
 * This is markup rather than prose, so it is read conservatively: unless the
 * container itself is recognised, the answer is "nothing known" rather than
 * "closed". If LinkedIn renames these classes the container check fails first,
 * and the whole rule falls silent instead of marking every posting shut.
 */
export function linkedInApplyWithdrawn(html: string): boolean {
  if (!/top-card-layout__cta-container/.test(html)) return false;
  // The container's own class starts "top-card-layout__cta-", so a button is
  // distinguished by what follows the name: whitespace, or the quote closing
  // the attribute.
  return !/top-card-layout__cta["'\s]/.test(html) && !/apply-button/.test(html);
}

/** What one fetch of a posting can tell us. Every field is best-effort. */
export interface PostingFacts {
  deadline?: string;
  /** The posting is not taking applications: it says so, its apply button is
   *  gone, or the deadline it states has already passed. */
  closed?: boolean;
  /**
   * The page never arrived, so nothing at all is known about this posting --
   * as opposed to it being open.
   *
   * Worth its own field rather than an absent `closed`, because the two look
   * identical to a caller and mean opposite things. A board that answers 999 to
   * a datacentre address would otherwise report a backlog of expired ads as
   * perfectly healthy. The number is the HTTP status, or 0 for a timeout or a
   * connection that never got that far.
   */
  unreachable?: number;
}

/** Fetch once, and once more after a pause if the board is waving us off. */
async function fetchPosting(target: string): Promise<Response | { error: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RETRY_PAUSE_MS));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(target, {
        headers: BROWSER_HEADERS,
        signal: controller.signal,
        redirect: 'follow',
      });
      if (attempt === 0 && THROTTLED.has(res.status)) continue;
      return res;
    } catch {
      // Timeout, DNS, TLS. Worth one more go: these are often transient, and
      // the whole point of the sweep is that nobody is watching it happen.
      if (attempt === 0) continue;
      return { error: 0 };
    } finally {
      clearTimeout(timer);
    }
  }
  // Unreachable: the second attempt always returns one or the other.
  return { error: 0 };
}

async function factsFor(rawUrl: string, reference: string): Promise<PostingFacts> {
  const target = postingTextUrl(rawUrl);
  if (!target) return { unreachable: 0 };

  const res = await fetchPosting(target);
  if ('error' in res) return { unreachable: res.error };
  if (!res.ok) {
    return closedByStatus(res.status) ? { closed: true } : { unreachable: res.status };
  }
  const type = res.headers.get('content-type') ?? '';
  if (!type.includes('html') && !type.includes('text')) return { unreachable: res.status };

  try {
    // One fetch answers every question, so a closed posting costs no extra
    // request. The markup is kept as well as the text: what LinkedIn will not
    // say in words, it says by leaving the apply button out.
    const html = await res.text();
    const text = textFromHtml(html);
    const deadline = parseDeadline(text, reference);
    const closed =
      parseApplicationsClosed(text) ||
      // Against now, not `reference`: the question is whether it is too late
      // today, while the reference only decides which year a bare "9.9." meant.
      deadlinePassed(deadline) ||
      (isLinkedInGuest(target) && linkedInApplyWithdrawn(html));
    return { deadline, closed };
  } catch {
    return { unreachable: 0 };
  }
}

/** Run `job` over every item, a few at a time. */
async function pool<T>(items: T[], job: (item: T) => Promise<void>, width = CONCURRENCY): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        await job(items[i]);
      }
    }),
  );
}

/**
 * Fill in deadlines for links that do not already have one, in place of the
 * input array. Capped in three ways -- how many, how fast, how long each -- so a
 * broad query cannot turn a preview into a crawl.
 */
export async function fillDeadlines<
  T extends { url: string; date?: string; deadline?: string; applicationsClosed?: boolean },
>(links: T[]): Promise<T[]> {
  const targets: number[] = [];
  for (let i = 0; i < links.length && targets.length < MAX_FETCHES; i++) {
    if (!links[i].deadline) targets.push(i);
  }
  if (targets.length === 0) return links;

  const out = [...links];
  await pool(targets, async (i) => {
    const facts = await factsFor(out[i].url, out[i].date ?? new Date().toISOString());
    if (facts.deadline || facts.closed) {
      out[i] = {
        ...out[i],
        ...(facts.deadline ? { deadline: facts.deadline } : {}),
        ...(facts.closed ? { applicationsClosed: true } : {}),
      };
    }
  });
  return out;
}

/**
 * The same question asked of bare URLs, for callers that hold no links: what
 * does each of these postings say about itself?
 *
 * Every URL is fetched, with no `deadline` already known to skip on, so the
 * caller is responsible for the size of the batch. Duplicates are fetched once.
 */
export async function factsForUrls(
  urls: string[],
  reference: string = new Date().toISOString(),
): Promise<Record<string, PostingFacts>> {
  const unique = [...new Set(urls)];
  const out: Record<string, PostingFacts> = {};
  await pool(
    unique,
    async (url) => {
      out[url] = await factsFor(url, reference);
    },
    SWEEP_CONCURRENCY,
  );
  return out;
}
