/**
 * Whether this browser looks signed in, from Clerk's cookies alone — read before
 * Clerk has loaded, to start fetching the app's main chunk alongside sign-in.
 *
 * This used to look for `__session`, but that is Clerk's short-lived token: it
 * lasts a minute, so after any real pause it was gone, the check said "signed
 * out", and the chunk waited for sign-in to finish. That was half of why one
 * start on a phone was quick and the next slow. `__client_uat` lasts as long as
 * the sign-in does: a time when signed in, "0" when signed out. Clerk may add a
 * suffix to its name (`__client_uat_<id>`), so both forms count.
 */
export function looksSignedIn(cookies: string): boolean {
  for (const part of cookies.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name === "__session" && value) return true;
    if ((name === "__client_uat" || name.startsWith("__client_uat_")) && value && value !== "0") return true;
  }
  return false;
}
