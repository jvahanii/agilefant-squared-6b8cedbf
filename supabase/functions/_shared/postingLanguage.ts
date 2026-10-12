// Keeping what a job ad said about needing Finnish.
//
// A fact about the ad, not about any work item: it is kept under the address
// of the ad, and a public page of job ads looks it up through the links its
// items carry (get_published_link_features). Nothing here is anyone's private
// data — it is one line read from a public ad.
//
// Keyed by a hash of the address exactly as the work item stores it, because
// that is the one thing both sides have: the importer writes the link with the
// address it read, and the database can hash the link it holds.

import { hashTarget } from './postingCache.ts';
import type { LanguageVerdict } from './languageRequirement.ts';

// Structural, for the same reason gmailImport.ts uses one: the client's type
// comes from a Deno URL import that the app's typecheck cannot follow.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

/** As much of the ad's own words as is worth keeping to explain a verdict. */
const EVIDENCE_MAX = 300;

/** How many hashes one lookup asks about; a URL has room for only so many. */
const LOOKUP_CHUNK = 100;

/** The key an address is kept under: SHA-256 of it, as the database computes it too. */
export function languageKey(url: string): Promise<string> {
  return hashTarget(url);
}

/** One row per address, from whatever was learnt. Pure, so it can be tested. */
export async function languageRows(
  entries: readonly { url: string; language?: LanguageVerdict | null }[],
  now: Date = new Date(),
): Promise<{ url_hash: string; finnish: string | null; basis: string | null; evidence: string | null; read_at: string }[]> {
  const rows = new Map<string, { url_hash: string; finnish: string | null; basis: string | null; evidence: string | null; read_at: string }>();
  for (const entry of entries) {
    // Absent means the page was never read: nothing learnt, nothing to keep.
    if (entry.language === undefined) continue;
    const url_hash = await languageKey(entry.url);
    rows.set(url_hash, {
      url_hash,
      finnish: entry.language?.finnish ?? null,
      basis: entry.language?.basis ?? null,
      evidence: entry.language?.evidence?.slice(0, EVIDENCE_MAX) ?? null,
      read_at: now.toISOString(),
    });
  }
  return [...rows.values()];
}

/**
 * Keep what these ads said. Best-effort: a verdict that could not be stored
 * costs a filter its answer for one ad, and must never cost an import or a
 * check its result.
 */
export async function rememberLanguage(
  admin: Admin,
  entries: readonly { url: string; language?: LanguageVerdict | null }[],
): Promise<void> {
  try {
    const rows = await languageRows(entries);
    if (rows.length === 0) return;
    const { error } = await admin.from('posting_language').upsert(rows, { onConflict: 'url_hash' });
    if (error) console.error('posting language: could not store:', error.message);
  } catch (e) {
    console.error('posting language: could not store:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Which of these addresses have already been read for their language —
 * whatever the ad turned out to say, nothing included. An address not in the
 * answer is worth a request; one in it is not.
 */
export async function urlsReadForLanguage(admin: Admin, urls: readonly string[]): Promise<Set<string>> {
  const read = new Set<string>();
  try {
    const keyOf = new Map<string, string[]>();
    for (const url of new Set(urls)) {
      const key = await languageKey(url);
      keyOf.set(key, [...(keyOf.get(key) ?? []), url]);
    }
    const keys = [...keyOf.keys()];
    for (let at = 0; at < keys.length; at += LOOKUP_CHUNK) {
      const { data, error } = await admin
        .from('posting_language')
        .select('url_hash')
        .in('url_hash', keys.slice(at, at + LOOKUP_CHUNK));
      if (error) {
        console.error('posting language: could not read:', error.message);
        continue;
      }
      for (const row of data ?? []) for (const url of keyOf.get(row.url_hash) ?? []) read.add(url);
    }
  } catch (e) {
    console.error('posting language: could not read:', e instanceof Error ? e.message : String(e));
  }
  return read;
}
