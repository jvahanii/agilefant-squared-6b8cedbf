/**
 * Which Agilefant profile a Clerk account was last found to belong to.
 *
 * Opening the app waited, after Clerk, on a lookup that turns the Clerk account
 * into this app's profile: a token from Clerk and a query to the database, two
 * round trips in a row. On a phone that is what made one start quick and the
 * next slow. The answer almost never changes, so it is remembered here, used at
 * once on the next start, and checked again behind it.
 *
 * Remembering it grants nothing: every query still carries the real Clerk
 * token, and the database's own rules decide what it may see. At worst a stale
 * answer shows the wrong profile's empty screen for the moment the check takes.
 */

const PREFIX = "agilefant.profileFor.";

export function rememberedProfileFor(clerkUserId: string): string | null {
  try {
    return localStorage.getItem(PREFIX + clerkUserId);
  } catch {
    // Storage can be blocked: a private window, a sandbox. Then nothing is
    // remembered and the start waits for the lookup, as it always did.
    return null;
  }
}

export function rememberProfileFor(clerkUserId: string, appUserId: string | null): void {
  try {
    if (appUserId) localStorage.setItem(PREFIX + clerkUserId, appUserId);
    else localStorage.removeItem(PREFIX + clerkUserId);
  } catch {
    // As above: remembering is a speed-up, never a requirement.
  }
}

/** On signing out: the next person on this device starts from nothing. */
export function forgetRememberedProfiles(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing to forget where nothing could be stored.
  }
}
