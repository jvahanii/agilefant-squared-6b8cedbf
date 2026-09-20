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
  /** Markup before the anchor. Optional: most sources never need it. */
  before?: string;
}

/** What a source gets to work from when naming the employer. */
export interface CompanyContext {
  /** Anchor texts for this posting, in document order. */
  labels: string[];
  /** Markup following each anchor, in the same order. */
  afters: string[];
  /** Markup preceding each anchor, in the same order. */
  befores: string[];
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
  /**
   * The posting's title, when the anchor text is not it — Barona's anchors all
   * read "View job". Given the same context as `company`.
   */
  title?(ctx: CompanyContext): string | undefined;
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
      // "New jobs similar to <role> at <employer>" names the posting the
      // reader already looked at, never the ones being advertised. The
      // 16.9.2026 digest carried ten employers -- Telenor, Wapice, GE
      // HealthCare, Nortal, ICEYE, Polar Squad, Nordea, Witted, Verda --
      // under a subject reading "at DNA Oyj", which appears nowhere in the
      // mail as an advertiser. So there is no employer to recover here, and
      // bailing out is not merely skipping a pattern: the trailing-at pattern
      // below would otherwise claim the reference company for every row.
      if (/^(new )?jobs similar to /i.test(s)) return undefined;
      const patterns = [
        /^You may be a fit for (.+?)'s .+ role$/i,
        /^(.+?) is hiring (?:a |an )?.+$/i,
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
    // Outokumpu, Fortum so far). The host differs per employer, hence a
    // path-only test.
    id: 'jobs2web',
    company: ({ url }) => {
      // Some sites put the brand in the path before /job/ —
      // jobs.fortum.com/Fortum/job/… — and that is the employer's own spelling.
      const brand = url.pathname.match(/^\/([^/]+)\/job\//i)?.[1];
      // Not a language code in the same place (/en/job/…, /fi_FI/job/…), which
      // would otherwise name the employer "en".
      if (brand && !/^[a-z]{2}(?:[_-][a-z]{2})?$/i.test(brand)) {
        try {
          return decodeURIComponent(brand);
        } catch {
          return brand;
        }
      }
      // Otherwise the host is careers.<employer>.<tld> or jobs.<employer>.<tld>.
      // Stripping only "careers." named every Fortum posting "Jobs".
      const label = url.hostname.replace(/^(careers?|jobs)\./i, '').split('.')[0];
      return label ? label.charAt(0).toUpperCase() + label.slice(1) : undefined;
    },
    senders: /@[\w.-]*jobs2web\.com/i,
    alertSenders: ['jobs2web.com'],
    // /job/<slug>/<id>, optionally after one brand segment: /Fortum/job/<slug>/<id>.
    // Requiring /job/ first threw away every posting in Fortum's alerts, so the
    // whole email imported nothing.
    isJobUrl: (u) => /^\/(?:[^/]+\/)?job\/[^/]+\/\d+/i.test(u.pathname),
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
    // One term covers every company: Gmail's from:teamtailor-mail.com matches
    // no-reply@nestai.teamtailor-mail.com, no-reply@verda.… and the rest.
    // Recruiters writing from <name>@<company>.teamtailor-mail.com match too,
    // which is harmless — only links to postings are kept, and a personal
    // message rarely carries one.
    alertSenders: ['teamtailor-mail.com'],
    // The posting is /jobs/<numeric id>-<slug>, on <company>.teamtailor.com or on
    // the company's own career domain — NestAI's digest links to
    // careers.nestai.com/jobs/8361702-machine-learning-engineer-action-recognition,
    // and requiring teamtailor.com threw every one of those away, so the email
    // imported nothing. The numeric id is what keeps this from matching any
    // site's /jobs/ page: The Hub's ids are hex, LinkedIn's sit under /jobs/view/.
    // An optional locale segment comes first on some sites (/en/jobs/…).
    isJobUrl: (u) => /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?jobs\/\d+(?:-[^/]*)?\/?$/i.test(u.pathname),
    canonicalPath: (u) => u.pathname.replace(/^\/[a-z]{2}(?:-[a-z]{2})?(?=\/jobs\/)/i, '').replace(/\/+$/, ''),
  },
  {
    // Barona Careers' weekly "Your latest job suggestions". Each posting is a
    // bold title, an employer-and-places line, "Posted n days ago", and a link
    // that only says "View job" — so title and employer are read from the
    // markup before the link, not from the anchor.
    id: 'barona',
    senders: /@baronacareers\.com/i,
    alertSenders: ['bea.barona@baronacareers.com'],
    title: ({ befores }) => baronaCard(befores)?.title,
    company: ({ befores }) => baronaCard(befores)?.company,
    // /jobs/<slug>. Not /job (all jobs) or /job/settings, which share the host.
    isJobUrl: (u) =>
      /(^|\.)baronacareers\.com$/i.test(u.hostname) && /^\/(?:[a-z]{2}\/[a-z]{2}\/)?jobs\/[^/]+\/?$/i.test(u.pathname),
  },
];

/**
 * A Barona suggestion card: the markup between the previous link and this one.
 *
 *   <div><b>💼 Electrical Engineer for CAM Plant Project, Kotka</b></div>
 *   <div>China Harbour Engineering Company Limited, Suomen sivuliike, Kotka, Finland</div>
 *   <div>Posted 1 day ago</div><div><a …>View job</a>
 *
 * The employer is the line's first comma-separated part. A title that ends by
 * repeating it ("Vastaava työnjohtaja, Lujatalo Oy") drops the repeat, since the
 * item is named employer first anyway.
 */
function baronaCard(befores: string[]): { title?: string; company?: string } | undefined {
  for (const before of befores) {
    const card = before.split(/<\/a>/i).pop() ?? '';
    const bold = [...card.matchAll(/<b\b[^>]*>([\s\S]*?)<\/b>/gi)];
    const last = bold.filter((m) => stripTags(m[1])).pop();
    if (!last || last.index === undefined) continue;
    const rawTitle = stripTags(last[1]).replace(/^[^\p{L}\p{N}]+/u, '').trim();
    if (!rawTitle) continue;
    const rest = card.slice(last.index + last[0].length);
    const line = [...rest.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)]
      .map((m) => stripTags(m[1]))
      .find((text) => text && !/^posted\b/i.test(text));
    const company = line?.split(/,\s/)[0]?.trim() || undefined;
    const title =
      company && rawTitle.toLowerCase().endsWith(`, ${company.toLowerCase()}`)
        ? rawTitle.slice(0, -(company.length + 2)).trim()
        : rawTitle;
    return { title, company };
  }
  return undefined;
}

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
  const ctx = contextFor(occ, url, subject, from);
  const override = source.company?.(ctx);
  if (override) return override.trim();

  const fromMarkup = firstSegment(beside);
  if (fromMarkup) return fromMarkup;

  return source.companyFallback?.(ctx)?.trim();
}

function contextFor(occ: LinkOccurrence[], url: URL, subject: string, from: string): CompanyContext {
  return {
    labels: occ.map((o) => o.label).filter((l) => l.length > 0),
    afters: occ.map((o) => o.after),
    befores: occ.map((o) => o.before ?? ''),
    url,
    subject,
    from,
  };
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
      const ownTitle = parsed
        ? source.title?.(contextFor(occ, parsed, l.subject ?? '', from))?.trim()
        : undefined;
      if (ownTitle) next = { ...next, title: ownTitle };
      if (company) next = { ...next, company, title: composeTitle(company, ownTitle ?? l.title ?? '') };

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
