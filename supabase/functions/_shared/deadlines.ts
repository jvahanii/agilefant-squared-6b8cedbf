// Application deadlines.
//
// Two sources, in order of preference:
//
//   1. The mail itself. Only the Finnish boards state one -- Duunitori
//      ("haku päättyy 20.9.", "Hakuaika 11.9 - 11.3.") and Työmarkkinatori
//      ("Haku päättyy 27.09.2026 19.00"). Free and reliable.
//   2. The posting's own description, which has to be fetched. Descriptions
//      phrase dates far more variously than digests do -- "application deadline
//      is September 30th", "viimeistään 28.9.2026" -- hence the month names.
//
// A wrong parse is worse than none, because the date becomes part of the work
// item's name. Everything here fails closed.
//
// Dependency-free: shared by the Deno edge functions and vitest.

/** Day-first, as every Finnish source writes it: 20.9. or 27.09.2026 */
const DAY_MONTH = String.raw`(\d{1,2})\.(\d{1,2})\.?(?:\s*(\d{4}))?`;

/**
 * A submission word, then the preposition that governs the date: "please submit
 * your application with your updated CV and cover letter via Careers site by
 * September 25th 2026".
 *
 * Both halves are required, and neither would do alone. "By September 25th" on
 * its own is as likely to be a start date as a deadline. A submission word on
 * its own can sit a whole clause away from a date it has nothing to do with --
 * which is why the earlier patterns kept the two within 40 characters, and why
 * this sentence, with 58 characters of CV and careers site in between, was read
 * as having no deadline at all. Anchoring the far end on the preposition is what
 * makes the longer gap safe.
 *
 * The gap excludes full stops, so the match cannot cross out of its sentence and
 * pick up the start date in the next one.
 */
const SUBMIT_BY = String.raw`(?:deadline|appl(?:y|ies|ication|ications)|submit|send)[^.\n]{0,120}?\b(?:by|before|until|no later than)\s+`;

/** Numeric patterns. Capture order is day, month, optional year. */
const NUMERIC_PATTERNS: RegExp[] = [
  // "haku päättyy 20.9." / "Haku päättyy 27.09.2026 19.00"
  new RegExp(String.raw`haku(?:aika)?\s*päättyy\s*${DAY_MONTH}`, "i"),
  // "jätä hakemus viimeistään 28.9.2026".
  // Spelled out rather than \w*, which does not match "ä" in JavaScript.
  new RegExp(String.raw`viimeist[a-zäöå]*\s*${DAY_MONTH}`, "i"),
  // "jätä hakemuksesi rekrytointijärjestelmämme kautta 30.9.2026 klo 16 mennessä".
  // Public-sector postings often phrase it with no deadline word at all, only the
  // postposition. "Mennessä" means "by", and the date it governs stands directly
  // before it, so anchoring on the postposition is both safer and simpler than
  // guessing at lead-ins. A clock time is what usually comes between the two.
  new RegExp(String.raw`${DAY_MONTH}(?:\s*klo\s*\d{1,2}(?:[.:]\d{2})?)?\s*menness[aä]`, "i"),
  // Duunitori's listing header: "Published 10.9. (Ends 30.9.)", and the Finnish
  // "Julkaistu 10.9. (Päättyy 30.9.)". The parentheses are required rather than
  // matching a bare "ends", which would read a contract's end date -- "the
  // contract ends 31.12." -- as an application deadline. They also keep the
  // published date, which sits immediately before, out of the match.
  new RegExp(String.raw`\(\s*(?:ends|closes|päättyy|umpeutuu)\s*:?\s*${DAY_MONTH}\s*\)`, "i"),
  // "Hakuaika 11.9 - 11.3." -- a range, so the deadline is the second date.
  new RegExp(String.raw`hakuaika\s*\d{1,2}\.\d{1,2}\.?\s*[-–—]\s*${DAY_MONTH}`, "i"),
  // "apply by 30.9.2026", "submit your application by 30.9.2026"
  new RegExp(SUBMIT_BY + DAY_MONTH, "i"),
];

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).join("|");

/**
 * Month-name phrasings, anchored on a deadline word so an unrelated date in the
 * body -- a start date, an event -- is not mistaken for one. The gap allows a
 * short lead-in ("deadline is", "deadline:") but not a whole sentence.
 */
const NAMED_PATTERNS: Array<{ re: RegExp; monthFirst: boolean }> = [
  {
    // "application deadline is September 30th", "apply by Sept 30, 2026"
    re: new RegExp(
      // The day must not be the front of a year: without the lookahead,
      // "deadline: 30 September 2026" matches as September + day 20.
      String.raw`(?:deadline|apply|applications?)[^.\n]{0,40}?\b(${MONTH_NAMES})\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?`,
      "i",
    ),
    monthFirst: true,
  },
  {
    // "deadline: 30 September 2026"
    re: new RegExp(
      String.raw`(?:deadline|apply|applications?)[^.\n]{0,40}?\b(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_NAMES})\.?(?:,?\s*(\d{4}))?`,
      "i",
    ),
    monthFirst: false,
  },
  {
    // "submit your application ... by September 25th 2026"
    re: new RegExp(
      SUBMIT_BY + String.raw`(${MONTH_NAMES})\.?\s+(\d{1,2})(?!\d)(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?`,
      "i",
    ),
    monthFirst: true,
  },
  {
    // "submit your application ... by 25 September 2026"
    re: new RegExp(
      SUBMIT_BY + String.raw`(\d{1,2})(?:st|nd|rd|th)?\s+(${MONTH_NAMES})\.?(?:,?\s*(\d{4}))?`,
      "i",
    ),
    monthFirst: false,
  },
];

function iso(year: number, month: number, day: number): string | undefined {
  const d = new Date(Date.UTC(year, month - 1, day));
  // Rejects 31.2 and friends: the Date would roll over into March.
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return undefined;
  return d.toISOString().slice(0, 10);
}

function startOfDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Resolve a day and month to a date. `year` is used when the text gave one;
 * otherwise the year chosen is the one that puts the deadline on or after the
 * reference date, because these sources omit the year and "11.3." in a
 * September mail means next March, not last.
 */
function resolve(
  day: number,
  month: number,
  year: number | undefined,
  ref: Date,
): string | undefined {
  if (!day || !month || month > 12 || day > 31) return undefined;
  if (year) return iso(year, month, day);
  const sameYear = iso(ref.getUTCFullYear(), month, day);
  if (sameYear && new Date(sameYear).getTime() >= startOfDay(ref)) return sameYear;
  return iso(ref.getUTCFullYear() + 1, month, day);
}

/**
 * Parse an application deadline out of `text`, as yyyy-mm-dd.
 *
 * `reference` is when the mail arrived, and decides the year where the text
 * omits it.
 */
export function parseDeadline(text: string, reference: Date | string | number): string | undefined {
  if (!text) return undefined;
  const ref = new Date(reference);
  if (Number.isNaN(ref.getTime())) return undefined;

  for (const pattern of NUMERIC_PATTERNS) {
    const m = text.match(pattern);
    if (!m) continue;
    const found = resolve(Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined, ref);
    if (found) return found;
  }

  for (const { re, monthFirst } of NAMED_PATTERNS) {
    const m = text.match(re);
    if (!m) continue;
    const month = MONTHS[(monthFirst ? m[1] : m[2]).toLowerCase()];
    const day = Number(monthFirst ? m[2] : m[1]);
    const found = resolve(day, month, m[3] ? Number(m[3]) : undefined, ref);
    if (found) return found;
  }

  return undefined;
}

/** "2026-09-20" -> "0920", the prefix an imported work item is named with. */
export function deadlinePrefix(isoDate: string | undefined): string {
  if (!isoDate) return "";
  const m = isoDate.match(/^\d{4}-(\d{2})-(\d{2})$/);
  return m ? `${m[1]}${m[2]}` : "";
}

/**
 * Phrases that state there is no closing date, as opposed to not mentioning one.
 *
 * Duunitori puts "Toistaiseksi voimassa" in the same slot where it otherwise
 * writes "haku päättyy 20.9.", so the distinction is worth keeping: a posting
 * that is open-ended is not the same as one whose deadline we simply have not
 * found.
 */
const OPEN_ENDED = [
  /toistaiseksi/i,
  /jatkuva\s*haku/i,
  /until\s+further\s+notice/i,
  /no\s+(?:application\s+)?deadline/i,
  /(?:rolling|continuous|ongoing)\s+(?:applications?|basis|recruitment)/i,
];

/** True when the text says applications stay open, rather than saying nothing. */
export function parseOpenEnded(text: string): boolean {
  if (!text) return false;
  return OPEN_ENDED.some((re) => re.test(text));
}

/**
 * Phrases meaning the posting has stopped taking applications.
 *
 * LinkedIn says both "No longer accepting applications" and "Not currently
 * accepting applications", and keeps the posting up either way — so a digest
 * mail happily links to something nobody can apply to. Worth knowing before
 * importing it as work.
 */
const CLOSED = [
  /no\s+longer\s+accepting\s+applications/i,
  /not\s+currently\s+accepting\s+applications/i,
  /applications?\s+(?:are\s+)?closed/i,
  /haku\s*(?:aika)?\s*on\s*(?:jo\s*)?päättynyt/i,
  // "Tämä työpaikkailmoitus ei ole enää voimassa." The Finnish boards withdraw
  // an ad this way rather than by saying anything about applications. Anchored
  // on the noun, so it cannot match a sentence about some other thing that has
  // expired -- an old agreement, a certificate -- inside a live posting.
  /(?:työpaikka|ilmoitus|paikka)[^.\n]{0,40}ei\s+ole\s+enää\s+(?:voimassa|haettavissa|avoinna)/i,
  // Some boards keep the address but serve a "gone" page under a 200: "Page not
  // found -- Unable to find job". A 404 is handled by status code instead.
  /unable\s+to\s+find\s+(?:this\s+)?job/i,
  /(?:job|position|vacancy|posting)[^.\n]{0,20}\bno\s+longer\s+available/i,
];

/** True when the posting says it is not taking applications any more. */
export function parseApplicationsClosed(text: string): boolean {
  if (!text) return false;
  return CLOSED.some((re) => re.test(text));
}

/**
 * Is a parsed deadline already in the past?
 *
 * A posting whose own closing date has gone by is shut whether or not it says
 * so, and boards routinely leave those up. This is the one closed-signal that
 * needs no cooperation from the page beyond the date it already stated.
 *
 * The day itself still counts as open: a deadline of "16:00 today" is not over
 * at breakfast, and the date alone cannot say when it ends. Note also that a
 * deadline parsed without a year can never land here, because `resolve` picks
 * the year that puts it in the future -- so this fires only on a date the
 * posting spelled out in full.
 */
export function deadlinePassed(
  isoDate: string | undefined,
  now: Date | string | number = Date.now(),
): boolean {
  if (!isoDate) return false;
  const at = new Date(`${isoDate}T00:00:00.000Z`).getTime();
  const today = new Date(now);
  if (Number.isNaN(at) || Number.isNaN(today.getTime())) return false;
  return at < startOfDay(today);
}
