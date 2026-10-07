// Telling that two job ads are the same job by their names.
//
// The import knows a posting by its link, and that is the wrong identity for a
// job: the same role is advertised on Duunitori, on Jobly and on the employer's
// own site, each under a link of its own, and a board that re-posts an ad gives
// it a new one. Compared by link alone, every one of those is a new job.
//
// Every imported item is named "Employer - Role", so the name is the identity
// the links lack. It is compared loosely — case, punctuation and the closing
// date an older name starts with do not matter — and one thing is allowed to
// tell two same-named ads apart: being in different cities, since an employer
// hiring the same role in Espoo and in Tampere posts it twice on purpose.
//
// Never a reason to refuse an import, only to leave a row unticked and say why.
//
// Dependency-free: shared by the Deno edge functions, the app and vitest.

/** A name with what varies between two sightings of one job taken off. */
export function nameKey(title: string | null | undefined): string {
  return (title ?? '')
    .toLowerCase()
    // "0930 Fennia - Product owner": the closing date older names start with.
    .replace(/^\s*\d{4}\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export interface NameParts {
  /** The whole name, as a key. */
  key: string;
  /**
   * The name without its closing "(…)", when it has one. An item's name ends in
   * the cities the job is in — "Fortum - Analyst (Espoo)" — so this is the name
   * the posting itself carried. It can also be part of the role ("(AI
   * Platform)"), which is why both keys are kept.
   */
  bareKey: string | null;
  /**
   * What that "(…)" lists, when it is a closed list: "(Espoo, Helsinki)". Null
   * when there is none, or when it ends "+3" — more cities than it names, so
   * nothing can be said about which.
   */
  places: string[] | null;
}

export function nameParts(title: string | null | undefined): NameParts {
  const text = (title ?? '').trim();
  const tail = text.match(/^(.*\S)\s*\(([^()]*)\)$/);
  if (!tail) return { key: nameKey(text), bareKey: null, places: null };
  const open = /\+\s*\d+\s*$/.test(tail[2]);
  const places = tail[2]
    .split(',')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  return {
    key: nameKey(text),
    bareKey: nameKey(tail[1]) || null,
    places: open || places.length === 0 ? null : places,
  };
}

/** The keys an existing item can be found under: its whole name, and without its "(…)". */
export function itemNameKeys(title: string | null | undefined): string[] {
  const { key, bareKey } = nameParts(title);
  return [...new Set([key, bareKey].filter((k): k is string => !!k && k.length >= MIN_KEY))];
}

/** Shorter than this a name is too little to go by. */
const MIN_KEY = 6;

/** Both lists name cities, and they have none in common. */
export function citiesApart(a: readonly string[] | null | undefined, b: readonly string[] | null | undefined): boolean {
  if (!a?.length || !b?.length) return false;
  const seen = new Set(a.map((c) => c.trim().toLowerCase()));
  return !b.some((c) => seen.has(c.trim().toLowerCase()));
}

/**
 * Does a posting look like the job an existing item is about?
 *
 * The posting's name is compared with the item's whole name, and with the
 * item's name less its closing "(…)". In the second case that "(…)" is the
 * item's cities, and the two are different jobs when the posting is known to
 * be somewhere else entirely.
 */
export function looksLikeSameJob(
  posting: { title: string; cities?: readonly string[] | null },
  existingTitle: string,
): boolean {
  const key = nameKey(posting.title);
  if (key.length < MIN_KEY) return false;
  const existing = nameParts(existingTitle);
  if (key === existing.key) return true;
  if (existing.bareKey && key === existing.bareKey) return !citiesApart(existing.places, posting.cities);
  return false;
}

/** An item a posting looks like, and the list it is in. */
export interface Lookalike {
  title: string;
  list: string;
}

/** The items of a tree, by every key each can be found under. */
export type NamesInTree = Map<string, Lookalike[]>;

export function rememberName(names: NamesInTree, title: string, list: string): void {
  for (const key of itemNameKeys(title)) {
    const known = names.get(key) ?? [];
    if (!known.some((k) => k.title === title && k.list === list)) known.push({ title, list });
    names.set(key, known);
  }
}

/** At most this many candidates travel with a row; the picker names one. */
const MAX_LOOKALIKES = 5;

/**
 * The items a posting's name matches. Cities are not judged here: when the
 * search answers, most postings have not been read for theirs yet, so the
 * picker makes that call with looksLikeSameJob once it knows.
 */
export function lookalikesFor(names: NamesInTree, title: string): Lookalike[] {
  const key = nameKey(title);
  if (key.length < MIN_KEY) return [];
  return (names.get(key) ?? []).slice(0, MAX_LOOKALIKES);
}
