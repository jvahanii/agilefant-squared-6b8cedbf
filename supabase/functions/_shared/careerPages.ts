// Company career pages the job import reads beside the alert mail.
//
// A job alert is somebody else's selection of postings, mailed when they get
// round to it. A company's own "open positions" page is the whole list, as of
// now. A saved job search can name such pages, and each run offers what is on
// them next to what the mail brought.
//
// Every page is read by a profile written for that site, as every sender is in
// jobSources.ts — a careers page is site furniture around a list, and only the
// site's own markup says which links are the list. A page with no profile is
// not read at all, which also means this never fetches an address just because
// somebody typed it in.
//
// The positions travel through the picker and the import as ordinary links.
// What an email is to those — the thing a row came from — the page is to
// these, so a page's rows carry a made-up message id naming the page.
//
// Dependency-free apart from the URL and naming helpers: shared by the Deno
// edge functions, the app and vitest.

import { decodeEntities, normalizeUrl } from './urls.ts';
import { citiesFromList } from './cities.ts';
import { composeTitle } from './jobSources.ts';

export interface CareerPosition {
  url: string;
  title: string;
  /** Where the job is, as the list says; empty when it names no city. */
  cities: string[];
}

export interface CareerPageSource {
  id: string;
  /** The employer every position on the page is named after. */
  company: string;
  /** The address to give, shown where an unsupported one is refused. */
  example: string;
  /** Is this address the page this profile reads? */
  matches(u: URL): boolean;
  /** The positions listed in the page's markup, in the page's order. */
  positions(html: string, pageUrl: string): CareerPosition[];
}

function text(markup: string): string {
  return decodeEntities(markup.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : undefined;
}

/** An href as it stands on the page, made absolute and stripped of trackers. */
function resolve(href: string, pageUrl: string): string | null {
  try {
    return normalizeUrl(new URL(decodeEntities(href), pageUrl).toString());
  } catch {
    return null;
  }
}

export const CAREER_PAGE_SOURCES: CareerPageSource[] = [
  {
    // One <li data-open-position-row data-position-location="Helsinki, Turku">
    // per position, holding a link to the posting and the title in a heading.
    // The rows are in the page as served; its script only filters them.
    id: 'reaktor',
    company: 'Reaktor',
    example: 'https://www.reaktor.com/careers/all-open-positions',
    matches: (u) =>
      /^(www\.)?reaktor\.com$/i.test(u.hostname) &&
      /^(\/[a-z]{2}(-[a-z]{2})?)?\/careers\/all-open-positions\/?$/i.test(u.pathname),
    positions(html, pageUrl) {
      const out: CareerPosition[] = [];
      for (const [, tag, body] of html.matchAll(/<li\b([^>]*\bdata-open-position-row\b[^>]*)>([\s\S]*?)<\/li>/gi)) {
        const anchor = body.match(/<a\b[^>]*>/i)?.[0] ?? '';
        const url = resolve(attribute(anchor, 'href') ?? '', pageUrl);
        const title = text(body.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] ?? '');
        if (!url || !title) continue;
        out.push({ url, title, cities: citiesFromList(attribute(tag, 'data-position-location') ?? '') });
      }
      return out;
    },
  },
];

/** The profile that reads this address, or null when none does. */
export function careerPageFor(rawUrl: string): CareerPageSource | null {
  let u: URL;
  try {
    u = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:') return null;
  return CAREER_PAGE_SOURCES.find((s) => s.matches(u)) ?? null;
}

/** An address as it is kept on a search: trimmed, no fragment, no trailing slash. */
export function careerPageAddress(rawUrl: string): string | null {
  if (!careerPageFor(rawUrl)) return null;
  const u = new URL(rawUrl.trim());
  u.hash = '';
  u.search = '';
  return u.toString().replace(/\/$/, '');
}

const PAGE_PREFIX = 'page:';

/** The message id a page's rows carry in place of an email's. */
export const pageMessageId = (pageUrl: string) => `${PAGE_PREFIX}${pageUrl}`;

/** Did this row come from a career page rather than an email? */
export const isPageMessageId = (messageId: string | null | undefined) => !!messageId?.startsWith(PAGE_PREFIX);

/** The page a row came from, or null for a row that came from an email. */
export const pageUrlOf = (messageId: string | null | undefined) =>
  isPageMessageId(messageId) ? messageId!.slice(PAGE_PREFIX.length) : null;

export interface CareerPageLink {
  url: string;
  title: string;
  messageId: string;
  subject: string;
  from: string;
  date: string;
  company: string;
  cities: string[];
}

/**
 * A page's positions as the links the picker and the import deal in: named
 * "Reaktor - Head of Marketing" like any other posting, each address once.
 * `date` stands where an email's arrival would — when the page was read.
 */
export function positionsAsLinks(source: CareerPageSource, pageUrl: string, html: string, date: string): CareerPageLink[] {
  const seen = new Set<string>();
  const out: CareerPageLink[] = [];
  for (const position of source.positions(html, pageUrl)) {
    if (seen.has(position.url)) continue;
    seen.add(position.url);
    out.push({
      url: position.url,
      title: composeTitle(source.company, position.title),
      messageId: pageMessageId(pageUrl),
      subject: `${source.company}: open positions`,
      from: `${source.company} career page`,
      date,
      company: source.company,
      cities: position.cities,
    });
  }
  return out;
}

/** The pages a saved search may name at once. */
export const MAX_CAREER_PAGES = 10;
