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
// Dependency-free on purpose: shared by the Deno edge functions and vitest.

export interface JobSource {
  id: string;
  /** Tested against the raw From header. */
  senders: RegExp;
  /** Is this URL an actual posting, as opposed to navigation or editorial? */
  isJobUrl(u: URL): boolean;
  /** Optional path rewrite so one posting is one URL across mail templates. */
  canonicalPath?(u: URL): string;
}

export const JOB_SOURCES: JobSource[] = [
  {
    // Covers jobalerts-, jobs- and messages-noreply. The last sends profile
    // views and course promos, which carry no /jobs/view/ link and so yield
    // nothing here -- which is the intended outcome.
    id: 'linkedin',
    senders: /@linkedin\.com/i,
    isJobUrl: (u) =>
      /(^|\.)linkedin\.com$/i.test(u.hostname) && /^\/(comm\/)?jobs\/view\/\d+/i.test(u.pathname),
    // Email links use /comm/jobs/view/<id>; the site uses /jobs/view/<id>.
    // Fold them together or the same role arrives twice.
    canonicalPath: (u) => u.pathname.replace(/^\/comm\//i, '/').replace(/\/+$/, ''),
  },
  {
    id: 'duunitori',
    senders: /@duunitori\.fi/i,
    isJobUrl: (u) =>
      /(^|\.)duunitori\.fi$/i.test(u.hostname) && /^\/tyopaikat\/tyo\/[^/]+/i.test(u.pathname),
  },
  {
    id: 'jobly',
    senders: /@jobly\.fi/i,
    isJobUrl: (u) => /(^|\.)jobly\.fi$/i.test(u.hostname) && /^\/tyopaikka\/[^/]+/i.test(u.pathname),
  },
  {
    // Postings are /jobs/<hex id>; the browse link is a bare /jobs/ plus query.
    id: 'thehub',
    senders: /@thehub\.io/i,
    isJobUrl: (u) => /(^|\.)thehub\.io$/i.test(u.hostname) && /^\/jobs\/[0-9a-z]{6,}/i.test(u.pathname),
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

/** Reduce a message's links to its job postings. Non-job senders pass through. */
export function filterJobLinks<T extends { url: string }>(from: string, links: T[]): T[] {
  const source = jobSourceFor(from);
  if (!source) return links;
  const out = new Map<string, T>();
  for (const l of links) {
    const canonical = canonicalJobUrl(source, l.url);
    if (!canonical) continue;
    if (!out.has(canonical)) out.set(canonical, { ...l, url: canonical });
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
