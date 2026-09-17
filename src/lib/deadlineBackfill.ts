import { deadlinePrefix, titleDeadline } from "../../supabase/functions/_shared/deadlines";
import { JOB_SOURCES } from "../../supabase/functions/_shared/jobSources";
import type { PostingFacts } from "../../supabase/functions/_shared/fetchDeadline";

/**
 * Giving job-ad items the deadline their title never got.
 *
 * An import names an item "1011 Alma Media — …" when it knows the posting's
 * application deadline. For a long time it could not know it for Jobly, which
 * refuses the server, and for anything imported before a phrasing was learned.
 * This reads those postings again — Jobly through the browser, everything else
 * through the posting-status function — and puts the date in front of the name.
 */

export interface BackfillItem {
  id: string;
  title: string;
  urls: string[];
  description?: string | null;
}

/** Is this link a posting on a job board the importer knows? */
export function isJobPostingUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return JOB_SOURCES.some((source) => source.isJobUrl(url));
}

/**
 * Items worth reading: a title with no MMDD prefix yet, and a link to a job
 * posting. Items linking only to articles or documents are left alone — a date
 * in an article is not an application deadline.
 */
export function itemsMissingDeadline<T extends BackfillItem>(items: T[]): T[] {
  return items.filter((item) => titleDeadline(item.title) === undefined && item.urls.some(isJobPostingUrl));
}

/** "Alma Media — …" + 2026-10-11 → "1011 Alma Media — …" */
export function titleWithDeadline(title: string, iso: string): string {
  const prefix = deadlinePrefix(iso);
  return prefix ? `${prefix} ${title.trimStart()}` : title;
}

/**
 * When the import saw the posting: the description's "Received:" line. It
 * decides the year of a date written without one ("haku päättyy 20.9."), the
 * same reference the import itself used.
 */
export function referenceDate(description: string | null | undefined): string | undefined {
  const m = description?.match(/^Received:[ \t]*(\S+)[ \t\r]*$/m);
  if (!m || Number.isNaN(new Date(m[1]).getTime())) return undefined;
  return m[1];
}

export interface BackfillDeps {
  /** posting-status, for boards the server can read. Up to 20 URLs a call. */
  serverFacts: (urls: string[]) => Promise<Record<string, { deadline?: string | null; unreachable?: number | null }>>;
  /** Whether this URL has to be read in the browser (Jobly). */
  needsBrowser: (url: string) => boolean;
  /** The posting reader extension, or null when it is not installed. */
  browserFacts: ((url: string, reference: string) => Promise<PostingFacts>) | null;
  onProgress?: (done: number, total: number) => void;
}

export interface BackfillResult {
  /** Item id → yyyy-mm-dd, for each item a deadline was found for. */
  found: Map<string, string>;
  /** Read, but the posting states no deadline. */
  noneStated: number;
  /** Could not be read: refused, timed out, or gone. */
  unreadable: number;
  /** Needed the browser, and the extension is not installed. */
  needsReader: number;
}

const SERVER_BATCH = 20;

/** Read each item's posting and collect the deadlines found. Never throws. */
export async function findMissingDeadlines(items: BackfillItem[], deps: BackfillDeps): Promise<BackfillResult> {
  const result: BackfillResult = { found: new Map(), noneStated: 0, unreadable: 0, needsReader: 0 };
  const total = items.length;
  let done = 0;
  const step = () => deps.onProgress?.(++done, total);

  const serverItems: { item: BackfillItem; url: string }[] = [];
  const browserItems: { item: BackfillItem; url: string }[] = [];
  for (const item of items) {
    const url = item.urls.find(isJobPostingUrl);
    if (!url) {
      step();
      continue;
    }
    if (!deps.needsBrowser(url)) serverItems.push({ item, url });
    else if (deps.browserFacts) browserItems.push({ item, url });
    else {
      result.needsReader++;
      step();
    }
  }

  for (let at = 0; at < serverItems.length; at += SERVER_BATCH) {
    const batch = serverItems.slice(at, at + SERVER_BATCH);
    let facts: Awaited<ReturnType<BackfillDeps["serverFacts"]>> = {};
    try {
      facts = await deps.serverFacts([...new Set(batch.map((b) => b.url))]);
    } catch {
      facts = {};
    }
    for (const { item, url } of batch) {
      const fact = facts[url];
      if (fact?.deadline) result.found.set(item.id, fact.deadline);
      else if (!fact || (fact.unreachable !== null && fact.unreachable !== undefined)) result.unreadable++;
      else result.noneStated++;
      step();
    }
  }

  for (const { item, url } of browserItems) {
    let fact: PostingFacts;
    try {
      fact = await deps.browserFacts!(url, referenceDate(item.description) ?? new Date().toISOString());
    } catch {
      fact = { unreachable: 0 };
    }
    if (fact.deadline) result.found.set(item.id, fact.deadline);
    else if (fact.unreachable !== undefined) result.unreadable++;
    else result.noneStated++;
    step();
  }

  return result;
}
