// The cities a job posting says it is in, and how they are shown in the name
// of the item imported from it.
//
// Read from the posting page itself: job-alert mail names a place for some
// boards and not others, and never for more than one. Three sources, in order,
// the first that answers wins:
//
//   1. schema.org JobPosting data (Duunitori, Jobly, The Hub, most company
//      career sites). Only the posting's own jobLocation is read: the page may
//      also describe the employer, whose head office is not where the job is.
//   2. LinkedIn's guest page: the first "topcard" line, "Espoo, Uusimaa,
//      Finland". The line after it is the applicant count.
//   3. SuccessFactors / jobs2web career sites (Nordea, Fortum, Wärtsilä):
//      jobGeoLocation, "Helsinki, FI, 00500".
//
// Dependency-free apart from the URL helpers: shared by the Deno edge
// functions, the browser posting reader and vitest.

import { decodeEntities } from './urls.ts';

/**
 * Places that turn up where a city belongs but are not one. Regions (Jobly
 * lists "Uusimaa" beside "Helsinki"), countries, and ways of saying "anywhere".
 * A foreign city is still a city: Nordea posts roles in Gdańsk.
 */
const NOT_A_CITY = new Set(
  [
    // Finnish regions, in Finnish and Swedish.
    'uusimaa', 'nyland', 'varsinais-suomi', 'egentliga finland', 'satakunta', 'kanta-häme', 'egentliga tavastland',
    'pirkanmaa', 'birkaland', 'päijät-häme', 'päijänne-tavastland', 'kymenlaakso', 'kymmenedalen',
    'etelä-karjala', 'södra karelen', 'etelä-savo', 'södra savolax', 'pohjois-savo', 'norra savolax',
    'pohjois-karjala', 'norra karelen', 'keski-suomi', 'mellersta finland', 'etelä-pohjanmaa', 'södra österbotten',
    'pohjanmaa', 'österbotten', 'keski-pohjanmaa', 'mellersta österbotten', 'pohjois-pohjanmaa', 'norra österbotten',
    'kainuu', 'kajanaland', 'lappi', 'lappland', 'ahvenanmaa', 'åland',
    // Countries and codes.
    'finland', 'suomi', 'fi', 'fin', 'sweden', 'sverige', 'norway', 'denmark', 'estonia', 'germany', 'poland',
    'europe', 'eu', 'emea', 'nordics',
    // Anywhere at all.
    'remote', 'etätyö', 'etä', 'hybrid', 'hybridi', 'anywhere', 'useita paikkakuntia', 'koko suomi', 'multiple locations',
  ],
);

/** One place name, cleaned: entities decoded, postcodes and spacing dropped. */
function cleanPlace(raw: string): string {
  return decodeEntities(raw)
    .replace(/\b\d{5}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep real city names, once each, in the order given. */
function keepCities(places: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of places) {
    const place = cleanPlace(raw);
    const key = place.toLowerCase();
    if (!place || /\d/.test(place) || NOT_A_CITY.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(place);
  }
  return out;
}

/** addressLocality of each of the posting's own locations, from schema.org data. */
function fromStructuredData(html: string): string[] {
  const places: string[] = [];
  const blocks = html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const [, block] of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block);
    } catch {
      continue;
    }
    const nodes = ([] as unknown[]).concat((data as { '@graph'?: unknown })?.['@graph'] ?? data);
    for (const node of nodes) {
      const posting = node as { '@type'?: unknown; jobLocation?: unknown };
      const type = ([] as unknown[]).concat(posting?.['@type'] ?? []);
      if (!type.includes('JobPosting')) continue;
      for (const location of ([] as unknown[]).concat(posting.jobLocation ?? [])) {
        const locality = (location as { address?: { addressLocality?: unknown } })?.address?.addressLocality;
        // One field sometimes holds several: "Helsinki, Espoo".
        if (typeof locality === 'string') places.push(...locality.split(/[,;/]/));
      }
    }
  }
  return places;
}

/** The first part of a "City, Region, Country" line, from the page markup. */
function fromMarkup(html: string): string[] {
  const linkedIn = [...html.matchAll(/class="[^"]*topcard__flavor--bullet[^"]*"[^>]*>([\s\S]*?)</g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim())
    .find(Boolean);
  // The applicant count shares the class, so the location is taken only when it
  // is the first line and does not look like one.
  if (linkedIn && !/\bapplicants?\b|\bhakija/i.test(linkedIn)) return [linkedIn.split(',')[0]];

  const geo = [...html.matchAll(/class="jobGeoLocation"[^>]*>([^<]*)</g)].map((m) => m[1].trim()).find(Boolean);
  if (geo) return [geo.split(',')[0]];
  return [];
}

/** The cities a posting page says the job is in; empty when it names none. */
export function citiesFromPage(html: string): string[] {
  const structured = keepCities(fromStructuredData(html));
  return structured.length > 0 ? structured : keepCities(fromMarkup(html));
}

/** How many cities a name shows before summing up the rest as "+N". */
const CITIES_SHOWN = 2;

/** Does the title already name this place, as a word of its own? */
function names(title: string, place: string): boolean {
  const escaped = place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}])${escaped}($|[^\\p{L}])`, 'iu').test(title);
}

/**
 * The item name with its cities after it: "Fortum — Analyst (Espoo)",
 * "Verohallinto — ICT-asiantuntija (Helsinki, Joensuu)", and past two,
 * "HR with you — Open Application (Helsinki, Tampere +3)".
 *
 * Left alone when there is no city, or when the title already names one of
 * them — Nordea's titles end "- Helsinki, FI, 00500" of their own accord. That
 * also makes it safe to run twice: a name that has had its cities added names
 * the first of them.
 */
export function withCities(title: string, cities: readonly string[] | undefined): string {
  const list = cities ?? [];
  if (list.length === 0 || list.some((city) => names(title, city))) return title;
  const shown = list.slice(0, CITIES_SHOWN).join(', ');
  const more = list.length - CITIES_SHOWN;
  return `${title} (${shown}${more > 0 ? ` +${more}` : ''})`;
}
