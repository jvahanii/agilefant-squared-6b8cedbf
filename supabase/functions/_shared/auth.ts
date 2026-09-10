// Who is calling an edge function, independent of which auth system issued the
// token.
//
// The functions here used to ask Supabase Auth directly -- `auth.getUser(token)`
// -- which resolves a token against `auth.users`. A Clerk token is signed by
// Clerk and its subject is a `user_…` string that appears nowhere in that table,
// so every one of those calls failed for a Clerk session.
//
// Rather than re-implementing the Clerk-subject-to-profile mapping here, this
// asks the database the same question the RLS policies ask: `current_user_id()`.
// Calling it *as the caller* does both jobs at once. PostgREST validates the
// bearer token first -- including Clerk tokens, via the third-party auth
// provider's JWKS, which is the same path every query in the app already relies
// on -- and the function then resolves the subject through `profiles.clerk_id`.
// So the mapping lives in exactly one place, and a token this rejects is a token
// the rest of the app would reject too.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { adminClient, env } from './gmail.ts';

export interface AppUser {
  /** profiles.id -- the uuid every table keys on, never a Clerk user id. */
  id: string;
  email: string | null;
}

/**
 * Resolve the caller, or throw. Throwing rather than returning null matches how
 * these functions already handle refusal: a top-level catch turns it into the
 * error response.
 */
export async function requireAppUser(req: Request): Promise<AppUser> {
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('unauthorized: no bearer token');
  }

  const caller = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authHeader } },
  });

  // An invalid or expired token surfaces as an error; a valid token that maps to
  // no profile comes back null, the same as an anonymous request would.
  const { data: userId, error } = await caller.rpc('current_user_id');
  if (error) throw new Error(`unauthorized: ${error.message}`);
  if (!userId) throw new Error('unauthorized: no profile for this account');

  // The email is read with the service role because the caller may not be able
  // to select their own profile row under RLS before they have a membership.
  const { data: profile } = await adminClient()
    .from('profiles')
    .select('email')
    .eq('id', userId)
    .maybeSingle();

  return { id: userId as string, email: profile?.email ?? null };
}
