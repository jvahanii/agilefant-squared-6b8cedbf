/**
 * Filters for a public list of job ads.
 *
 * A public page shows whatever list it was made from, and most lists are not
 * job ads: these filters are switched on per link (published_link_settings.
 * job_filters), for the one page they make sense on.
 *
 * Everything is judged from what the page already has — an item's name, its
 * dates and its first link — because that is all a public page is sent. An
 * item imported as a job ad is named "Employer - Role (cities)", and it is the
 * role the name filters read: an employer called "Senior Living Oy" is not a
 * senior role, and a job in "Staffanstorp" is not a staff one.
 *
 * Pure, so the rules can be tested and tuned without a page.
 */

export interface JobLike {
  title: string;
  /** yyyy-mm-dd, or nothing. */
  deadline?: string | null;
  /** yyyy-mm-dd, or nothing. */
  createdOn?: string | null;
  links?: readonly { url: string }[];
}

export type JobChip =
  | "noFinnish"
  | "noSenior"
  | "noStaff"
  | "noManager"
  | "trainee"
  | "developer"
  | "newThisWeek"
  | "notExpired";

/**
 * The chips, in the order shown. The ones that start on are the ones that
 * leave things out — and leave in what is still open; the ones that narrow
 * the list to a kind of job start off, for the visitor to choose.
 */
export const JOB_CHIPS: readonly { id: JobChip; label: string; hint: string; startsOn: boolean }[] = [
  { id: "noFinnish", label: "No Finnish", hint: "Leave out jobs whose title is in Finnish", startsOn: true },
  { id: "noSenior", label: "No senior", hint: "Leave out senior roles", startsOn: true },
  { id: "noStaff", label: "No staff", hint: "Leave out staff-level roles", startsOn: true },
  { id: "noManager", label: "No manager", hint: "Leave out manager roles", startsOn: true },
  { id: "trainee", label: "Trainee", hint: "Only trainee and intern roles", startsOn: false },
  { id: "developer", label: "Developer", hint: "Only developer roles", startsOn: false },
  { id: "newThisWeek", label: "New this week", hint: "Only jobs added in the last seven days", startsOn: false },
  { id: "notExpired", label: "Not expired", hint: "Leave out jobs whose deadline has passed", startsOn: true },
];

/** The chips a page opens with. */
export function startingChips(): Set<JobChip> {
  return new Set(JOB_CHIPS.filter((chip) => chip.startsOn).map((chip) => chip.id));
}

/**
 * The role an item's name states: what follows the employer, less the cities
 * the name ends with. "Fortum - Senior Analyst (Espoo)" is "Senior Analyst".
 * A name with no employer in front is all role.
 */
export function roleOf(title: string): string {
  const withoutCities = title.replace(/\s*\([^()]*\)\s*$/, "");
  const dash = withoutCities.search(/\s[-–—]\s/);
  return (dash >= 0 ? withoutCities.slice(dash).replace(/^\s[-–—]\s/, "") : withoutCities).trim();
}

// Letters English does not use, and Finnish (and Swedish) does.
const NORDIC_LETTER = /[äöå]/i;

// Endings Finnish job titles are built from, on words long enough for the
// ending to mean something: asiantuntija, kehittäjä, suunnittelija, johtaja,
// analyytikko, päällikkö, konsultti, arkkitehti, koordinaattori, insinööri,
// asiakkuus, kehitys, myynti, palvelu, hallinto, järjestelmä.
const FINNISH_ENDING =
  /(?:ija|aja|äjä|kko|kkö|ntti|ltti|hti|ttori|nööri|isti|uus|yys|itys|ytys|nti|inen|sto|stö|nto|ntö|uri|eri|ille|oille|ksia)$/;
const MIN_ENDING_WORD = 7;

// Whole words that settle it by themselves, whatever their length or ending.
// ("Tieto" is not among them: it is also an employer, and turns up in English
// role names as one.)
const FINNISH_WORDS = new Set([
  "ja", "tai", "sekä", "tiimi", "myyjä", "asiakas", "tuote", "hankinta", "kehitys", "johto", "tutkija", "opettaja",
  "lehtori", "sihteeri", "hoitaja", "johtaja", "neuvoja", "ohjaaja", "valmentaja", "vuoro", "osa", "yksikön",
  "vanhempi", "nuorempi", "hanke", "laatu", "vapaa", "avoin", "suomi", "englanti", "ruotsi",
]);

// Pieces Finnish job titles are compounded from. Finnish runs words together —
// "Turvallisuusvastaava", "Projektivastaava", "Yliaktuaari" — so these count
// wherever in a word they appear.
const FINNISH_STEMS = [
  "vastaava", "asiantuntija", "suunnittelija", "konsultti", "koordinaattori", "arkkitehti", "tarkastaja",
  "analyytikko", "ohjelmisto", "ohjelmoija", "palvelu", "myynti", "talous", "hallinto", "turvallisuus", "aktuaari",
  "harjoittelija", "opiskelija", "hakemus", "rekrytointi", "markkinointi", "tuotanto", "asennus", "asentaja", "huolto",
  "kunnossapito", "rakennus", "muotoilu", "natiivi", "projekti", "neuvoja", "asiakas",
];

// English words that happen to end the Finnish way.
const NOT_FINNISH = new Set([
  "history", "inventory", "category", "territory", "advisory", "regulatory", "laboratory", "directory", "repository",
  "factory", "industry", "ministry", "chemistry", "registry", "dentistry", "delivery", "recovery", "machinery",
  "battery", "gallery", "mastery", "quality", "security", "integrity", "community", "university", "sustainability",
  "reliability", "identity", "opportunity", "capability", "accessibility", "responsibility", "maternity", "utility",
  "facility", "mobility", "liability", "availability", "analyst", "specialist", "scientist", "strategist", "economist",
  "artist", "receptionist", "generalist", "technologist", "biologist", "psychologist", "therapist", "pharmacist",
  "content", "management", "development", "department", "equipment", "environment", "government", "investment",
  "recruitment", "procurement", "engagement", "assessment", "improvement", "treatment", "payment", "student",
  "assistant", "consultant", "accountant", "resident", "president", "independent", "compliant", "account",
  "customer", "engineer", "designer", "manager", "developer", "officer", "partner", "controller", "container",
  "computer", "consumer", "provider", "carrier", "cashier", "courier", "premier", "frontier", "barrier", "senior",
  "junior", "interior", "exterior", "superior", "warrior",
]);

/**
 * Is this role named in Finnish? Judged a word at a time: a Nordic letter, a
 * word Finnish titles are made of, or a long word with a Finnish ending and no
 * English reading. A proxy for "this job wants Finnish" — the ad itself is not
 * on the page to read — and deliberately one that needs evidence: a role with
 * nothing Finnish about its name counts as not Finnish.
 */
export function looksFinnish(role: string): boolean {
  if (NORDIC_LETTER.test(role)) return true;
  const words = role.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.some(
    (word) =>
      FINNISH_WORDS.has(word) ||
      FINNISH_STEMS.some((stem) => word.includes(stem)) ||
      (word.length >= MIN_ENDING_WORD && FINNISH_ENDING.test(word) && !NOT_FINNISH.has(word)),
  );
}

const SENIOR = /\b(?:senior|seniori|sr)\b/i;
const STAFF = /\bstaff\b/i;
const MANAGER = /manager|päällikkö/i;
const TRAINEE = /trainee|harjoittelij|\bintern(?:ship)?\b|kesätyö|summer (?:job|worker|employee)/i;
// A business developer develops business, not software.
const DEVELOPER = /(?<!business )developer|ohjelmistokehittäjä|sovelluskehittäjä|ohjelmoija|programmer|software engineer|ohjelmistosuunnittelija/i;

const pad = (n: number) => String(n).padStart(2, "0");
/** A day on the reader's own calendar, as yyyy-mm-dd. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Does the item pass this one chip? */
export function passesChip(chip: JobChip, item: JobLike, now: Date = new Date()): boolean {
  const role = roleOf(item.title);
  switch (chip) {
    case "noFinnish":
      return !looksFinnish(role);
    case "noSenior":
      return !SENIOR.test(role);
    case "noStaff":
      return !STAFF.test(role);
    case "noManager":
      return !MANAGER.test(role);
    case "trainee":
      return TRAINEE.test(role);
    case "developer":
      return DEVELOPER.test(role);
    case "newThisWeek": {
      // Today and the six days before it. An item whose day was never
      // recorded cannot be shown to be new.
      if (!item.createdOn) return false;
      const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      return item.createdOn >= isoDay(from);
    }
    case "notExpired":
      // The day itself still counts as open; no deadline is not an expired one.
      return !item.deadline || item.deadline >= isoDay(now);
  }
}

/**
 * Where a job was found: the site of its first link, without "www." — or
 * null for an item with no link.
 */
export function sourceOf(item: JobLike): string | null {
  const url = item.links?.[0]?.url;
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/** Does the item pass every chip that is on? */
export function passesChips(item: JobLike, chips: ReadonlySet<JobChip>, now: Date = new Date()): boolean {
  for (const chip of chips) if (!passesChip(chip, item, now)) return false;
  return true;
}

/**
 * Does the item pass the filters as a whole: every chip that is on, and —
 * when any sources are ticked — being from one of them.
 */
export function passesJobFilters(
  item: JobLike,
  chips: ReadonlySet<JobChip>,
  sources: ReadonlySet<string>,
  now: Date = new Date(),
): boolean {
  if (!passesChips(item, chips, now)) return false;
  if (sources.size === 0) return true;
  const source = sourceOf(item);
  return source !== null && sources.has(source);
}

/**
 * The sources of the jobs the chips leave, most jobs first, each with how
 * many — what ticking it would show. Counted before the sources themselves
 * are applied: ticking one must not make the others read nought.
 */
export function sourceCounts(
  items: readonly JobLike[],
  chips: ReadonlySet<JobChip>,
  now: Date = new Date(),
): { source: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    if (!passesChips(item, chips, now)) continue;
    const source = sourceOf(item);
    if (source) counts.set(source, (counts.get(source) ?? 0) + 1);
  }
  return [...counts]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
}

/** How many sources are listed before "Show N more". */
export const SOURCES_SHOWN = 6;
