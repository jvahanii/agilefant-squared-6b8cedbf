/**
 * Whether the signed-in user is a superuser in this session, asked once per
 * user and shared by everyone who asks. The organization menu and the scramble
 * setting each read it at the start of every load: two requests for one answer.
 *
 * Asked of the database (my_superuser_status), not read from the profile: a
 * superuser's rights hold only in a session signed in with a second factor —
 * Google, or a password with an authenticator-app code. needsSecondFactor says
 * the account is a superuser's and this session is not enough.
 */
export interface SuperuserStatus {
  isSuperuser: boolean;
  needsSecondFactor: boolean;
  error: unknown;
}

let cached: { userId: string; promise: Promise<SuperuserStatus> } | null = null;

export function fetchIsSuperuser(userId: string): Promise<SuperuserStatus> {
  if (cached?.userId === userId) return cached.promise;
  // The client is imported when first asked, so a test's mock of it is the one used.
  const promise = import("@/integrations/supabase/client")
    .then(({ supabase }) => supabase.rpc("my_superuser_status"))
    .then(({ data, error }) => {
      // A failed read is not kept: the next to ask reads again.
      if (error && cached?.promise === promise) cached = null;
      const status = data as { is_superuser?: boolean; needs_second_factor?: boolean } | null;
      return {
        isSuperuser: status?.is_superuser === true,
        needsSecondFactor: status?.needs_second_factor === true,
        error,
      };
    });
  cached = { userId, promise };
  return promise;
}

/** Forget the answer (between tests, and when it may have changed). */
export function forgetSuperuser(): void {
  cached = null;
}
