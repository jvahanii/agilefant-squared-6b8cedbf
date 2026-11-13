/**
 * A superuser's rights hold only in a session signed in with a second factor
 * (Google, or a password with an authenticator-app code): is_superuser in the
 * database decides, from the fva claim in Clerk's session token. Everything
 * that grants superuser rights has to ask it — the app through
 * my_superuser_status, edge functions through requireAppUser — because
 * profiles.is_superuser says only that the account is a superuser's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { fetchIsSuperuser, forgetSuperuser } from "@/lib/superuser";

const root = process.cwd();
const migration = readFileSync(
  join(root, "supabase", "migrations", "20261112150000_superuser_needs_second_factor.sql"),
  "utf8",
);

function files(dir: string, skip: string[] = []): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return skip.includes(name) ? [] : files(p, skip);
    return /\.tsx?$/.test(name) ? [p] : [];
  });
}

beforeEach(() => {
  rpc.mockReset();
  forgetSuperuser();
});

describe("a superuser signed in without a second factor", () => {
  it("is not one in this session, and the app is told why", async () => {
    rpc.mockResolvedValue({ data: { is_superuser: false, needs_second_factor: true }, error: null });
    const status = await fetchIsSuperuser("u1");
    expect(rpc).toHaveBeenCalledWith("my_superuser_status");
    expect(status).toMatchObject({ isSuperuser: false, needsSecondFactor: true });
  });

  it("is one again once the sign-in had a second factor", async () => {
    rpc.mockResolvedValue({ data: { is_superuser: true, needs_second_factor: false }, error: null });
    expect(await fetchIsSuperuser("u1")).toMatchObject({ isSuperuser: true, needsSecondFactor: false });
  });

  it("is not one when the status cannot be read", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await fetchIsSuperuser("u1")).toMatchObject({ isSuperuser: false, needsSecondFactor: false });
  });
});

describe("is_superuser in the database", () => {
  it("does not trust Clerk's fva claim", () => {
    // The rule based on it was reverted (20261113090000): on this instance a
    // password-only session showed a second factor and a Google sign-in did
    // not, so it locked the superuser out. The newest definition decides.
    const dir = join(root, "supabase", "migrations");
    const newest = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .filter((s) => /CREATE OR REPLACE FUNCTION public\.is_superuser\(/.test(s))
      .pop() ?? "";
    const fn = newest.slice(newest.indexOf("FUNCTION public.is_superuser"));
    expect(fn).not.toMatch(/fva/);
  });

  it("still refuses to delete a superuser's account in any session", () => {
    // Through is_superuser a password-only session would not count, and the
    // account it protects could be deleted with the password alone.
    expect(migration).toContain("'IF public.is_superuser(_me) THEN'");
    expect(migration).toMatch(/SELECT p\.is_superuser FROM public\.profiles p WHERE p\.id = _me/);
  });

  it("lets only signed-in users ask for their own status", () => {
    expect(migration).toMatch(/REVOKE EXECUTE ON FUNCTION public\.my_superuser_status\(\) FROM PUBLIC, anon;/);
  });
});

describe("nothing grants superuser rights from the profile alone", () => {
  it("in the app or the edge functions", () => {
    const sources = [...files(join(root, "src"), ["test"]), ...files(join(root, "supabase", "functions"))];
    const offenders = sources.filter((p) => /select\(\s*['"][^'"]*\bis_superuser\b/.test(readFileSync(p, "utf8")));
    expect(offenders.map((p) => p.slice(root.length + 1))).toEqual([]);
  });

  it("edge functions take it from requireAppUser, which asks the database as the caller", () => {
    const auth = readFileSync(join(root, "supabase", "functions", "_shared", "auth.ts"), "utf8");
    expect(auth).toMatch(/caller\.rpc\('is_superuser', \{ _user_id: userId \}\)/);
  });
});
