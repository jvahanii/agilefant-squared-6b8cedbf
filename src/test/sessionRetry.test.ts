/**
 * withSessionRetry recovers from an expired-JWT or RLS error by retrying the
 * operation once. It used to gate that retry behind a successful
 * `supabaseAuth.auth.refreshSession()` — which is fine for a Supabase session
 * and useless for a Clerk one, because there is no Supabase session to refresh.
 * The refresh always failed, so the retry never ran and an error that would have
 * healed itself was surfaced to the user instead.
 *
 * These tests pin the behaviour that matters: the retry happens even when the
 * refresh fails, and non-auth errors are still returned untouched rather than
 * being retried blindly.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const refreshSession = vi.fn(async () => ({ error: { message: "Auth session missing!" } }));

vi.mock("@/integrations/supabase/authClient", () => ({
  supabaseAuth: { auth: { refreshSession: () => refreshSession() } },
  getSupabaseAccessToken: async () => null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ select: () => ({}) }),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  },
}));

vi.mock("@/integrations/supabase/pagination", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paginateSelect: async (run: any) => run(0, 999),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/persistDebug", () => ({ notifyPersistDebug: vi.fn() }));

import { withSessionRetry } from "@/store/supabaseSync";

type OpResult = { error: { message?: string; code?: string } | null };

beforeEach(() => {
  refreshSession.mockClear();
});

describe("withSessionRetry", () => {
  it("retries once after an auth error even though the refresh failed", async () => {
    // The Clerk case: refreshSession rejects because there is no Supabase
    // session, but the data client mints a fresh token per request, so the
    // second attempt is the one that succeeds.
    const results: OpResult[] = [{ error: { code: "PGRST301", message: "JWT expired" } }, { error: null }];
    const operation = vi.fn(async () => results.shift()!);

    const result = await withSessionRetry(operation);

    expect(operation).toHaveBeenCalledTimes(2);
    expect(result.error).toBeNull();
  });

  it("retries on an RLS violation", async () => {
    const results: OpResult[] = [{ error: { code: "42501", message: "row-level security" } }, { error: null }];
    const operation = vi.fn(async () => results.shift()!);

    const result = await withSessionRetry(operation);

    expect(operation).toHaveBeenCalledTimes(2);
    expect(result.error).toBeNull();
  });

  it("returns a successful operation without refreshing anything", async () => {
    const operation = vi.fn(async (): Promise<OpResult> => ({ error: null }));

    const result = await withSessionRetry(operation);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(result.error).toBeNull();
  });

  it("does not retry an error that has nothing to do with auth", async () => {
    const operation = vi.fn(async (): Promise<OpResult> => ({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    }));

    const result = await withSessionRetry(operation);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(refreshSession).not.toHaveBeenCalled();
    expect(result.error?.code).toBe("23505");
  });

  it("surfaces the second failure when the retry fails too", async () => {
    const operation = vi.fn(async (): Promise<OpResult> => ({
      error: { code: "PGRST301", message: "JWT expired" },
    }));

    const result = await withSessionRetry(operation);

    expect(operation).toHaveBeenCalledTimes(2);
    expect(result.error?.code).toBe("PGRST301");
  });
});
