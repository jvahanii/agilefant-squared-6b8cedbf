// Recognising a Gmail connection that has to be made again.
//
// Dependency-free, so vitest can test it: gmail.ts itself imports from esm.sh.

/**
 * Does this failed Gmail call mean the person must connect Gmail again?
 *
 * Google answers 401 once access is withdrawn. The shared connector answers 401
 * too, with a body such as
 *   {"status":401,"message":"user must re-authorize: refresh token expired",...}
 * — which is what a connection through an OAuth app still in Google's "Testing"
 * state does after exactly seven days. That used to reach the picker as the raw
 * body instead of "Connect Gmail again".
 *
 * For the shared connector the body has to say so: a 401 from it can also mean
 * the gateway refused Agilefant's own key, which reconnecting would not fix.
 */
export function needsReconnect(kind: 'gateway' | 'google', status: number, body: string): boolean {
  if (status !== 401) return false;
  if (kind === 'google') return true;
  return /re-?authori[sz]e|refresh token|invalid_grant|token (?:has been )?(?:expired|revoked)/i.test(body);
}
