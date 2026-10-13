// Reading the page a sender's mail points at, for mail that lists no posting.
//
// Most job mail is a list of postings, and jobSources.ts reads it as one. Some
// is only word that an employer is hiring — Thermo Fisher's newsletter links to
// worldwide searches by trade and names no job. For such a sender the mail is
// taken as the cue and the employer's own list is what is read: the source
// names a `listing`, filterJobLinks leaves one link to it in the mail's place,
// and here that link becomes the jobs on the page.
//
// The jobs keep the mail's id, subject and sender, so the picker shows them
// under the email they came by and the import marks that email read.
//
// Kept apart from jobSources.ts, which is pure, and takes its reader as an
// argument so it can be tested without a network.

import { composeTitle, jobSourceFor, type JobListing } from './jobSources.ts';
import { fetchPosting } from './fetchDeadline.ts';

/** Pages of one list read per search: fifty jobs, and no crawl. */
export const MAX_LISTING_PAGES = 5;

type Reader = (url: string) => Promise<string | null>;

/** The page as served, or null when it would not come. */
async function readPage(url: string): Promise<string | null> {
  const res = await fetchPosting(url);
  if ('error' in res) return null;
  if (!res.ok) {
    await res.body?.cancel().catch(() => undefined);
    return null;
  }
  try {
    return await res.text();
  } catch {
    return null;
  }
}

/** Every job on a list, across its pages; null when the first page would not come. */
async function jobsOn(listing: JobListing, read: Reader) {
  const jobs: ReturnType<JobListing['positions']> = [];
  const seen = new Set<string>();
  let url: string | null = listing.url;
  for (let page = 0; url && page < MAX_LISTING_PAGES; page++) {
    const html = await read(url);
    if (html === null) return page === 0 ? null : jobs;
    for (const job of listing.positions(html, url)) {
      if (seen.has(job.url)) continue;
      seen.add(job.url);
      jobs.push(job);
    }
    url = listing.nextPage?.(html, url) ?? null;
  }
  return jobs;
}

/**
 * The links with every link to a sender's listing replaced by the jobs on it.
 * A listing that could not be read yields nothing — a search page is not a
 * posting, and is never offered as one — and its mail is read again on the
 * next search. One page is read once however many mails point at it. Links
 * from senders with no listing pass through untouched, in their order.
 */
export async function expandListings<
  T extends { url: string; title?: string; from?: string; company?: string; cities?: string[] },
>(links: T[], read: Reader = readPage): Promise<T[]> {
  const listingOf = (link: T): JobListing | null => {
    const listing = jobSourceFor(link.from ?? '')?.listing;
    return listing && listing.url === link.url ? listing : null;
  };
  if (!links.some(listingOf)) return links;

  const pages = new Map<string, ReturnType<typeof jobsOn>>();
  const out: T[] = [];
  for (const link of links) {
    const listing = listingOf(link);
    if (!listing) {
      out.push(link);
      continue;
    }
    if (!pages.has(listing.url)) pages.set(listing.url, jobsOn(listing, read));
    for (const job of (await pages.get(listing.url)) ?? []) {
      out.push({
        ...link,
        url: job.url,
        title: composeTitle(listing.company, job.title),
        company: listing.company,
        ...(job.cities ? { cities: job.cities } : {}),
      });
    }
  }
  return out;
}
