// What may be believed about a posting without asking the board again.
//
// Separate from the function that stores it so the rule can be tested: the
// storage needs Deno and a service role, the rule needs neither.

/**
 * How long a posting that is still open stays believed.
 *
 * A closed one is never re-asked at all -- applications do not reopen, so that
 * answer keeps forever. An open one can close any day, so it is worth asking
 * again, but daily rather than on every press of the button.
 */
export const OPEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface Verdict {
  closed: boolean;
  deadline: string | null;
  /** Epoch milliseconds. */
  checkedAt: number;
}

/** Is this verdict still worth believing without asking again? */
export function usable(v: Verdict, now: number = Date.now()): boolean {
  return v.closed || now - v.checkedAt < OPEN_TTL_MS;
}

/**
 * The cache key.
 *
 * A hash rather than the URL itself: a job link can carry hundreds of
 * characters of tracking parameters, and a btree index refuses a key past about
 * 2.7 KB. Hashing the *fetch target* rather than the raw URL also folds the
 * many decorated forms of one LinkedIn posting onto a single entry.
 */
export async function hashTarget(target: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(target));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
