/**
 * The token the data client presents on every request.
 *
 * This file used to hold a second Supabase client, the only one managing a
 * Supabase session, because supabase-js disables `.auth` on any client
 * configured with `accessToken` — so email/password sign-in, recovery and
 * sign-out could not go through the data client. Clerk is now the only way in,
 * so none of that is left; all that remains is handing over Clerk's token.
 */

/**
 * Returning null is meaningful: supabase-js then falls back to the anon key, so
 * a signed-out visitor still gets a working client rather than an error, and RLS
 * decides what they can see.
 */
export async function getSupabaseAccessToken(): Promise<string | null> {
  // Clerk attaches itself to window once ClerkProvider has loaded. Read it
  // defensively: with a production key on a non-matching origin it never
  // finishes loading, and the app should degrade to signed-out rather than
  // throw on every query.
  try {
    const clerk = (globalThis as { Clerk?: { session?: { getToken: () => Promise<string | null> } } }).Clerk;
    return (await clerk?.session?.getToken()) ?? null;
  } catch {
    return null;
  }
}
