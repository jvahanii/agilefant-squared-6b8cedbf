// Job-board senders whose mail is a digest of postings wrapped in site chrome.
//
// The generic extractor takes every link in a message. For these senders that
// is wrong: one Duunitori "6 new jobs" mail carries roughly twenty links --
// six postings, four repeats under a "seen these already?" heading, three
// editorial articles, and the browse/edit/unsubscribe furniture. Importing all
// of them buries the six that matter.
//
// A sender with no profile here is unaffected and keeps the generic behaviour.
//
// Dependency-free apart from the URL helpers: shared by the Deno edge functions
// and vitest.

import { decodeEntities } from './urls.ts';
import { parseDeadline, parseOpenEnded } from './deadlines.ts';

/** One appearance of a URL in a message: its anchor text, and the markup after it. */
export interface LinkOccurrence {
  label: string;
  after: string;
}

/** What a source gets to work from when naming the employer. */
export interface CompanyContext {
  /** Anchor texts for this posting, in document order. */
  labels: string[];
  /** Markup following each anchor, in the same order. */
  afters: string[];
  url: URL;
  subject: string;
  from: string;
}

export interface JobSource {
  id: string;
  /** Tested against the raw From header. */
  senders: RegExp;
  /**
   * Addresses -- or bare domains, where the local part varies per employer --
   * that actually send job alerts, for building a Gmail query. May be empty
   * when a domain also carries unrelated mail.
   * Narrower than `senders` on purpose: LinkedIn's messages-noreply matches
   * the profile but only ever sends profile views and course promos, so it
   * is not worth searching.
   */
  alertSenders: string[];
  /** Is this URL an actual posting, as opposed to navigation or editorial? */
  isJobUrl(u: URL): boolean;
  /**
   * Employer for a posting, when the markup around the link cannot give it.
   * Overrides the default extraction.
   */
  company?(ctx: CompanyContext): string | undefined;
  /**
   * Last resort, used only when the markup yielded nothing. Kept separate from
   * `company` because a subject line names one posting, and a digest carries
   * several.
   */
  companyFallback?(ctx: CompanyContext): string | undefined;
  /** Optional path rewrite so one posting is one URL across mail templates. */
  canonicalPath?(u: URL): string;
}

export const JOB_SOURCES: JobSource[] = [
  {
    // Covers jobalerts-, jobs- and messages-noreply. The last sends profile
    // views and course promos, which carry no /jobs/view/ link and so yield
    // nothing here -- which is the intended outcome.
    id: 'linkedin',
    // Only when the markup gives nothing. LinkedIn's saved-jobs digest lists
    // several postings from different employers under a subject that names just
    // the first -- reading the subject first labelled every row "emagine".
    companyFallback: ({ subject }) => {
      const s = subject.replace(/[\u2018\u2019\u201c\u201d']/g, "'").trim();
      const patterns = [
        /^You may be a fit for (.+?)'s .+ role$/i,
        /^(.+?) is hiring (?:a |an )?.+$/i,
        /^New jobs similar to .+ at (.+?)$/i,
        /^[^:]*:\s*(.+?)\s+-\s+.+posted on/i,
        /\bat ([^,]+?)'?$/i,
      ];
      for (const re of patterns) {
        const hit = s.match(re)?.[1]?.trim();
        if (hit && hit.length > 1 && hit.length < 80) return hit;
      }
      return undefined;
    },
    alertSenders: ['jobalerts-noreply@linkedin.com', 'jobs-noreply@linkedin.com'],
    senders: /@linkedin\.com/i,
    isJobUrl: (u) =>
      /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/(comm\/)?jobs\/view\/\d+/i.test(u.pathname),
    // Email links use /comm/jobs/view/<id>; the site uses /jobs/view/<id>.
    // Fold them together or the same role arrives twice.
    canonicalPath: (u) => u.pathname.replace(/^\/comm\//i, '/').replace(/\/+$/, ''),
  },
  {
    id: 'duunitori',
    alertSenders: ['duunivahti@duunitori.fi'],
    senders: /@duunitori\.fi/i,
    isJobUrl: (u) =>
      /(^|\.)duunitori\.fi$/i.test(u.hostname) && /^\/tyopaikat\/tyo\/[^/]+/i.test(u.pathname),
  },
  {
    id: 'jobly',
    alertSenders: ['noreply@jobly.fi'],
    senders: /@jobly\.fi/i,
    isJobUrl: (u) => /(^|\.)jobly\.fi$/i.test(u.hostname) && /^\/tyopaikka\/[^/]+/i.test(u.pathname),
  },
  {
    // Postings are /jobs/<hex id>; the browse link is a bare /jobs/ plus query.
    id: 'thehub',
    // The Hub links the same posting once per field: title, company,
    // location, contract type. The second is the employer.
    company: ({ labels }) => labels[1],
    alertSenders: ['noreply@thehub.io'],
    senders: /@thehub\.io/i,
    isJobUrl: (u) => /(^|\.)thehub\.io$/i.test(u.hostname) && /^\/jobs\/[0-9a-z]{6,}/i.test(u.pathname),
  },
  {
    // Finnish public employment service. Clean links: no wrapper, no tracking.
    id: 'tyomarkkinatori',
    senders: /@tyomarkkinatori\.fi/i,
    alertSenders: ['noreply@tyomarkkinatori.fi'],
    isJobUrl: (u) =>
      /(^|\.)tyomarkkinatori\.fi$/i.test(u.hostname) &&
      /^\/henkiloasiakkaat\/avoimet-tyopaikat\/[0-9a-f-]{36}/i.test(u.pathname),
    // The trailing segment is a locale (fi|sv|en) and the uuid is the identity,
    // so drop it -- otherwise one posting differs per language.
    canonicalPath: (u) => u.pathname.replace(/\/(fi|sv|en)\/?$/i, '').replace(/\/+$/, ''),
  },
  {
    // jobs2web / SuccessFactors powers per-employer career sites, so one
    // profile covers every company mailing through it (Nordea, Wärtsilä,
    // Outokumpu so far). The host differs per employer, hence a path-only test.
    id: 'jobs2web',
    // Career sites are careers.<employer>.<tld>; the employer is the host.
    company: ({ url }) => {
      const label = url.hostname.replace(/^careers?\./i, '').split('.')[0];
      return label ? label.charAt(0).toUpperCase() + label.slice(1) : undefined;
    },
    senders: /@[\w.-]*jobs2web\.com/i,
    alertSenders: ['jobs2web.com'],
    isJobUrl: (u) => /^\/job\/[^/]+\/\d+/i.test(u.pathname),
  },
  {
    // Teamtailor, likewise multi-tenant: <company>.teamtailor.com.
    id: 'teamtailor',
    // <company>.teamtailor.com is a slug ("sofigategroupoy"), so prefer the
    // display name on the From header, which is the real company name.
    company: ({ from, url }) => {
      const display = from.split('<')[0].replace(/["']/g, '').trim();
      if (display && !display.includes('@')) return display;
      const label = url.hostname.split('.')[0];
      return label ? label.charAt(0).toUpperCase() + label.slice(1) : undefined;
    },
    senders: /@[\w.-]*teamtailor-mail\.com/i,
    // Left out of the default query on purpose: individual recruiters mail
    // from <name>@<company>.teamtailor-mail.com too, and Gmail cannot express
    // "no-reply@ on any subdomain" in one from: term. Extraction still works
    // if such a message is imported; it just is not searched for by default.
    alertSenders: [],
    isJobUrl: (u) =>
      /(^|\.)teamtailor\.com$/i.test(u.hostname) && /^\/jobs\/\d+/i.test(u.pathname),
  },
];

export function jobSourceFor(from: string): JobSource | null {
  return JOB_SOURCES.find((s) => s.senders.test(from)) ?? null;
}

/**
 * A posting's identity is its path, so every query param is dropped. That is
 * stronger than stripping a known list: it also defeats tracking params the
 * boards have not invented yet.
 */
export function canonicalJobUrl(source: JobSource, rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!source.isJobUrl(u)) return null;
  const path = source.canonicalPath ? source.canonicalPath(u) : u.pathname.replace(/\/+$/, '');
  return `${u.origin}${path}`;
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The employer is the run of text before the first separator these digests put
 * between it and the location/date: "Academic Work | Tuusula, Helsinki | 12.9."
 * or "Academic Work, Espoo - Hakuaika 11.9." or "Lokki Oy - Useita sijainteja".
 */
function firstSegment(text: string): string | undefined {
  const cut = text.split(/\s[|\u2022\u00b7]\s|,\s|\s[-\u2013\u2014]\s/)[0]?.trim();
  if (!cut || cut.length < 2 || cut.length > 80) return undefined;
  return cut;
}

/**
 * The text a digest puts beside a posting: whatever follows the anchor that
 * supplied the title, up to the next link.
 *
 * Bounded at the next link deliberately. Reading past it picks up the following
 * posting's title, which would name every item after its neighbour. Anchored on
 * the *title* anchor rather than the first, because a logo link is followed by
 * the title itself.
 */
function markupBesidePosting(occ: LinkOccurrence[]): string {
  const titleIndex = occ.findIndex((o) => o.label.length > 2 && !/^https?:\/\//i.test(o.label));
  const after = occ[titleIndex >= 0 ? titleIndex : 0]?.after;
  if (!after) return '';
  return stripTags(after.split(/<a\b/i)[0] ?? '');
}

function resolveCompany(
  source: JobSource,
  occ: LinkOccurrence[],
  beside: string,
  url: URL,
  subject: string,
  from: string,
): string | undefined {
  const labels = occ.map((o) => o.label).filter((l) => l.length > 0);
  const afters = occ.map((o) => o.after);
  const override = source.company?.({ labels, afters, url, subject, from });
  if (override) return override.trim();

  const fromMarkup = firstSegment(beside);
  if (fromMarkup) return fromMarkup;

  return source.companyFallback?.({ labels, afters, url, subject, from })?.trim();
}

/** "Company — Title", unless the title already names the company. */
function composeTitle(company: string, title: string): string {
  if (!title) return company;
  if (title.toLowerCase().startsWith(company.toLowerCase())) return title;
  return `${company} \u2014 ${title}`.slice(0, 300);
}

/**
 * Reduce a message's links to its job postings, and name each one after its
 * employer. Non-job senders pass through untouched.
 */
export function filterJobLinks<
  T extends {
    url: string;
    title?: string;
    subject?: string;
    company?: string;
    deadline?: string;
    deadlineOpen?: boolean;
    date?: string;
  },
>(from: string, links: T[], occurrences?: Map<string, LinkOccurrence[]>): T[] {
  const source = jobSourceFor(from);
  if (!source) return links;
  const out = new Map<string, T>();
  for (const l of links) {
    const canonical = canonicalJobUrl(source, l.url);
    if (!canonical || out.has(canonical)) continue;
    let next = { ...l, url: canonical } as T;
    const occ = occurrences?.get(l.url);
    if (occ) {
      let parsed: URL | null = null;
      try {
        parsed = new URL(l.url);
      } catch {
        parsed = null;
      }
      const beside = markupBesidePosting(occ);
      const company = parsed
        ? resolveCompany(source, occ, beside, parsed, l.subject ?? '', from)
        : undefined;
      if (company) next = { ...next, company, title: composeTitle(company, l.title ?? '') };

      // Only the Finnish boards state a deadline in the mail. Elsewhere it is
      // left absent rather than guessed at, and filled in at import time by
      // fetching the posting.
      const deadline = parseDeadline(beside, l.date ?? Date.now());
      if (deadline) next = { ...next, deadline };
      else if (parseOpenEnded(beside)) next = { ...next, deadlineOpen: true };
    }
    out.set(canonical, next);
  }
  return [...out.values()];
}

/**
 * Canonicalise from the URL alone, with no sender to consult. Used to compare
 * against links already stored on work items: those were saved before job
 * canonicalisation existed (often as raw trackers), and running them back
 * through normalizeUrl + this function recovers the same identity the current
 * pipeline produces -- so historical imports still deduplicate instead of
 * coming back as copies.
 */
export function canonicalizeByHost(rawUrl: string): string | null {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  const source = JOB_SOURCES.find((s) => s.isJobUrl(u));
  return source ? canonicalJobUrl(source, rawUrl) : null;
}

/**
 * A starting Gmail query for the job-ad import: the senders whose mail this
 * module knows how to read. Restricting by sender rather than by label keeps it
 * meaningful for anyone, and leaves out senders whose links would be discarded
 * anyway.
 *
 * A label clause is usually a better filter once you have one -- narrower, and
 * it survives a board changing its From address.
 */
/**
 * Search windows offered by the job ad card. Gmail's newer_than accepts hours
 * as well as days -- verified against a live mailbox, where newer_than:1h and
 * newer_than:1d return different counts -- so sub-day windows need no date
 * arithmetic.
 */
export const LOOKBACK_OPTIONS = [
  { value: '12h', label: 'Last 12 hours' },
  { value: '1d', label: 'Last 24 hours' },
  { value: '3d', label: 'Last 3 days' },
  { value: '7d', label: 'Last 7 days' },
  { value: '14d', label: 'Last 14 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: '365d', label: 'Last year' },
] as const;

export type LookbackWindow = (typeof LOOKBACK_OPTIONS)[number]['value'];

export const DEFAULT_LOOKBACK: LookbackWindow = '30d';

export function defaultJobQuery(window: string = DEFAULT_LOOKBACK): string {
  const from = JOB_SOURCES.flatMap((s) => s.alertSenders).join(' OR ');
  return `from:(${from}) newer_than:${window}`;
}

/**
 * Retarget a query at a different window, preserving whatever else the user has
 * typed. Appends the clause when the query has none.
 */
export function withLookback(query: string, window: string): string {
  const clause = `newer_than:${window}`;
  if (/\bnewer_than:\d+[hdmy]\b/i.test(query)) {
    return query.replace(/\bnewer_than:\d+[hdmy]\b/gi, clause);
  }
  return query.trim() ? `${query.trim()} ${clause}` : clause;
}

/** Add or remove the is:unread restriction, leaving the rest of the query alone. */
export function withUnreadOnly(query: string, only: boolean): string {
  const without = query
    .replace(/\bis:unread\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!only) return without;
  return without ? `${without} is:unread` : 'is:unread';
}

/** Whether a query already restricts to unread mail. */
export function isUnreadOnly(query: string): boolean {
  return /\bis:unread\b/i.test(query);
}
