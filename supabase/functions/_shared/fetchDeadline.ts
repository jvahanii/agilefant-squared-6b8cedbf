// Fetching a posting to find its application deadline.
//
// Used only where the mail did not state one. The Finnish digests do, so those
// never reach here; LinkedIn, Jobly, The Hub, jobs2web and Teamtailor do not,
// and their deadline lives in the description.
//
// Everything is best-effort: a failed or slow fetch yields no deadline rather
// than an error. A missing date is a small loss, a wrong one ends up in a work
// item's name.

import { parseApplicationsClosed, parseDeadline } from './deadlines.ts';

/** Per request. Long enough for a slow board, short enough not to stall a preview. */
const TIMEOUT_MS = 6_000;
/** Postings fetched concurrently. */
const CONCURRENCY = 6;
/** Ceiling per preview, so a wide query cannot turn into hundreds of requests. */
const MAX_FETCHES = 40;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/**
 * Where to fetch a posting's text from.
 *
 * LinkedIn's own job page is a 260 KB shell; its guest endpoint returns the
 * posting on its own, without a login, and includes the whole description --
 * the "…more" button is CSS truncation, not withheld content. Following the
 * Apply button instead would hit a sign-up wall.
 */
export function postingTextUrl(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  const linkedInJob = u.hostname.match(/(^|\.)linkedin\.com$/i)
    ? u.pathname.match(/^\/(?:comm\/)?jobs\/view\/(\d+)/i)
    : null;
  if (linkedInJob) {
    return `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${linkedInJob[1]}`;
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

/** What one fetch of a posting can tell us. Both fields are best-effort. */
export interface PostingFacts {
  deadline?: string;
  /** The posting says it is no longer taking applications. */
  closed?: boolean;
}

async function factsFor(rawUrl: string, reference: string): Promise<PostingFacts> {
  const target = postingTextUrl(rawUrl);
  if (!target) return {};

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(target, {
      headers: { 'user-agent': UA, accept: 'text/html,*/*' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) return {};
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('html') && !type.includes('text')) return {};
    // One fetch answers both questions, so closed postings cost no extra request.
    const text = textFromHtml(await res.text());
    return { deadline: parseDeadline(text, reference), closed: parseApplicationsClosed(text) };
  } catch {
    // Timeout, DNS, TLS, a board blocking datacentre IPs: all just "nothing known".
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/** Run `job` over every item, at most CONCURRENCY of them in flight at once. */
async function pool<T>(items: T[], job: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
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
  await pool(unique, async (url) => {
    out[url] = await factsFor(url, reference);
  });
  return out;
}
