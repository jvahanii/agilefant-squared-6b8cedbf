// Career sites built on Phenom ("phenompeople"): Thermo Fisher's so far.
//
// A Phenom search page draws its list with script, but the first page of
// results is already in the page as served, as data the script starts from:
//
//   phApp.ddo = {"eagerLoadRefineSearch":{"totalHits":8,"data":{"jobs":[
//     {"title":"Business Analyst","jobId":"R-01369408",
//      "multi_location":["Finland"], …}, …]}}, …}; phApp.…
//
// Ten jobs to a page; the next ten are the same address with from=10&s=1.
//
// Dependency-free apart from the city helper: shared by the Deno edge
// functions and vitest.

import { citiesFromList } from './cities.ts';
import type { JobListing } from './jobSources.ts';

export interface PhenomJob {
  title: string;
  jobId: string;
  /** Every place the job is offered in, as the site writes them: "Finland", "Brno, Czechia". */
  locations: string[];
}

export interface PhenomSearch {
  jobs: PhenomJob[];
  /** How many jobs the whole search has, of which a page shows ten. */
  totalHits: number;
}

/** The search results a Phenom page carries, or null for a page that carries none. */
export function phenomSearch(html: string): PhenomSearch | null {
  const data = html.match(/phApp\.ddo\s*=\s*(\{[\s\S]*?\});\s*phApp\./)?.[1];
  if (!data) return null;
  let search: { totalHits?: unknown; data?: { jobs?: unknown } } | undefined;
  try {
    search = (JSON.parse(data) as { eagerLoadRefineSearch?: typeof search }).eagerLoadRefineSearch;
  } catch {
    return null;
  }
  if (!search || !Array.isArray(search.data?.jobs)) return null;

  const jobs: PhenomJob[] = [];
  for (const raw of search.data.jobs as Array<Record<string, unknown>>) {
    const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
    const jobId = typeof raw?.jobId === 'string' ? raw.jobId.trim() : '';
    if (!title || !jobId) continue;
    const many = Array.isArray(raw.multi_location) ? raw.multi_location : [raw.location];
    jobs.push({ title, jobId, locations: many.filter((place): place is string => typeof place === 'string') });
  }
  return { jobs, totalHits: typeof search.totalHits === 'number' ? search.totalHits : jobs.length };
}

/** A page of a Phenom search holds this many jobs. */
const PAGE_SIZE = 10;

/** The address of the results after this page's, or null when this page ends them. */
export function phenomNextPage(html: string, pageUrl: string): string | null {
  const search = phenomSearch(html);
  if (!search || search.jobs.length === 0) return null;
  let u: URL;
  try {
    u = new URL(pageUrl);
  } catch {
    return null;
  }
  const from = Number(u.searchParams.get('from') ?? 0) || 0;
  const next = from + PAGE_SIZE;
  if (next >= search.totalHits) return null;
  u.searchParams.set('from', String(next));
  u.searchParams.set('s', '1');
  return u.toString();
}

const THERMO_JOBS = 'https://jobs.thermofisher.com/global/en';

/**
 * The cities a job is in, of the places it lists in this country. Thermo
 * Fisher writes most of its Finnish jobs as plain "Finland", which names no
 * city, and that is the answer given: none. Asking the job's own page instead
 * names a role offered across Europe after Paisley, Oslo and eleven more —
 * true of the job, and no use on a list of jobs in Finland.
 */
function citiesIn(country: string, locations: string[]): string[] {
  const tail = new RegExp(`(?:^|,\\s*)${country}$`, 'i');
  return citiesFromList(
    locations
      .filter((place) => tail.test(place.trim()))
      .map((place) => place.trim().replace(tail, '').split(',')[0] ?? '')
      .join(','),
  );
}

/**
 * Every job Thermo Fisher has open in Finland.
 *
 * Its newsletter ("Explore Careers at Thermo Fisher Scientific") lists no job
 * at all: it links to worldwide searches by trade — "software" alone is some
 * eight hundred jobs, in Brno, Bangalore and the United States. What a reader
 * of a Finnish job list wants from it is this page instead, so the mail is
 * taken as word that the company is hiring and the page is what is read.
 *
 * A job is addressed by its id alone: the site answers /job/<id> with or
 * without the title after it, and the title can change.
 */
export const THERMO_FISHER_FINLAND: JobListing = {
  url: `${THERMO_JOBS}/search-results?qcountry=Finland`,
  company: 'Thermo Fisher Scientific',
  positions(html) {
    return (phenomSearch(html)?.jobs ?? []).map((job) => ({
      url: `${THERMO_JOBS}/job/${encodeURIComponent(job.jobId)}`,
      title: job.title,
      cities: citiesIn('Finland', job.locations),
    }));
  },
  nextPage: phenomNextPage,
};
