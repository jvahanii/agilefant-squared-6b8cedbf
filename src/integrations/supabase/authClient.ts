/**
 * Supabase Auth, kept separate from the data client.
 *
 * The data client is configured with `accessToken` so it can carry Clerk
 * tokens, and supabase-js responds to that option by replacing `.auth` with a
 * proxy that throws on any property access. Email/password sign-in, password
 * recovery and sign-out therefore cannot go through it, and live here instead.
 *
 * Keeping this means Supabase Auth remains a working way in for as long as we
 * want it — if Clerk sign-in fails on the deployed site, /auth/legacy still
 * works and the data client falls back to the session created here. Delete this
 * file, and the accessToken fallback below, once Clerk is trusted.
 */
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';
import { brokeredPreviewStorage } from './previewAuthStorage';

const SUPABASE_URL = 'https://hwwjwkdbautfkhpxuord.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3d2p3a2RiYXV0ZmtocHh1b3JkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNzkwNDAsImV4cCI6MjA4OTk1NTA0MH0.PN9xhG95nXlaUJn5DmtoQJ62yn3XJWOsHvZyQF8Zq2I';

const authLocks = new Map<string, Promise<void>>();

const authLock = async <R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> => {
  const previous = authLocks.get(name) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current, () => current);
  authLocks.set(name, tail);

  await previous.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
    if (authLocks.get(name) === tail) authLocks.delete(name);
  }
};

/**
 * The only client that manages a Supabase session. The data client no longer
 * does — in accessToken mode its auth is disabled — so there is exactly one
 * refresher and no two-client race over the shared storage.
 */
export const supabaseAuth = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: brokeredPreviewStorage(),
    persistSession: true,
    autoRefreshToken: true,
    lock: authLock,
  },
});

/**
 * The token the data client should present, preferring Clerk.
 *
 * Returning null is meaningful: supabase-js then falls back to the anon key, so
 * an unauthenticated visitor still gets a working client rather than an error.
 */
export async function getSupabaseAccessToken(): Promise<string | null> {
  // Clerk attaches itself to window once ClerkProvider has loaded. Read it
  // defensively: with a production key on a non-matching origin it never
  // finishes loading, and that must not break signing in the old way.
  try {
    const clerk = (globalThis as { Clerk?: { session?: { getToken: () => Promise<string | null> } } }).Clerk;
    const clerkToken = await clerk?.session?.getToken();
    if (clerkToken) return clerkToken;
  } catch {
    // Fall through to the Supabase session.
  }

  const { data } = await supabaseAuth.auth.getSession();
  return data.session?.access_token ?? null;
}
