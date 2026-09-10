/**
 * withSessionRetry recovers from an expired-JWT or RLS error by retrying the
 * operation once. It used to gate that retry behind a successful
 * `supabaseAuth.auth.refreshSession()`, which always failed for a Clerk session
 * because there was no Supabase session to refresh — so the retry never ran and
 * an error that would have healed itself reached the user instead.
 *
 * Retrying is now the whole recovery: the data client asks Clerk for a token on
 * every request, so a second attempt carries a fresh one. These tests pin that,
 * and that non-auth errors are still returned untouched rather than retried
 * blindly.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/authClient", () => ({
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


describe("withSessionRetry", () => {
  it("retries once after an auth error", async () => {
    // The data client asks Clerk for a token per request, so the second
    // attempt is the one that carries a valid one.
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

  it("does not retry a successful operation", async () => {
    const operation = vi.fn(async (): Promise<OpResult> => ({ error: null }));

    const result = await withSessionRetry(operation);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(result.error).toBeNull();
  });

  it("does not retry an error that has nothing to do with auth", async () => {
    const operation = vi.fn(async (): Promise<OpResult> => ({
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    }));

    const result = await withSessionRetry(operation);

    expect(operation).toHaveBeenCalledTimes(1);
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
