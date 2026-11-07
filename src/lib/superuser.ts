/**
 * Whether a user is a superuser, asked once per user and shared by everyone
 * who asks. The organization menu and the scramble setting each read it at the
 * start of every load: two requests for one answer.
 */
let cached: { userId: string; promise: Promise<{ isSuperuser: boolean; error: unknown }> } | null = null;

export function fetchIsSuperuser(userId: string): Promise<{ isSuperuser: boolean; error: unknown }> {
  if (cached?.userId === userId) return cached.promise;
  // The client is imported when first asked, so a test's mock of it is the one used.
  const promise = import("@/integrations/supabase/client")
    .then(({ supabase }) => supabase.from("profiles").select("is_superuser").eq("id", userId).single())
    .then(({ data, error }) => {
      // A failed read is not kept: the next to ask reads again.
      if (error && cached?.promise === promise) cached = null;
      return { isSuperuser: (data as { is_superuser?: boolean } | null)?.is_superuser ?? false, error };
    });
  cached = { userId, promise };
  return promise;
}

/** Forget the answer (between tests, and when it may have changed). */
export function forgetSuperuser(): void {
  cached = null;
}
