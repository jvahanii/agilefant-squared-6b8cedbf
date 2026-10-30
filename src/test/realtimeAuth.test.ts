/**
 * The live-updates connection is kept on a fresh token. supabase-js sets the
 * first one as if by hand, after which realtime-js stopped renewing it, and a
 * minute later — Clerk's tokens last sixty seconds — live changes stopped
 * arriving until a reload.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { keepRealtimeAuthFresh, REALTIME_AUTH_REFRESH_MS } from "@/integrations/supabase/realtimeAuth";
import { getSupabaseAccessToken, TOKEN_LEEWAY_SECONDS } from "@/integrations/supabase/authClient";

let realtime: { setAuth: ReturnType<typeof vi.fn> };
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  realtime = { setAuth: vi.fn(async () => undefined) };
  stop = keepRealtimeAuthFresh(realtime);
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe("the live-updates token", () => {
  it("is asked for afresh well before the life a token is handed out with runs out", () => {
    expect(REALTIME_AUTH_REFRESH_MS * 2).toBeLessThanOrEqual(TOKEN_LEEWAY_SECONDS * 1000);
    vi.advanceTimersByTime(60_000);
    expect(realtime.setAuth.mock.calls.length).toBeGreaterThanOrEqual(2);
    // With no token of its own: realtime-js then asks the app's callback and stops treating the token as set by hand.
    expect(realtime.setAuth.mock.calls.every((call) => call.length === 0)).toBe(true);
  });

  it("is asked for when the tab comes back into view", () => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(realtime.setAuth).toHaveBeenCalledTimes(1);
  });

  it("is renewed by Clerk with the leeway, not Clerk's usual ten seconds", async () => {
    const getToken = vi.fn(async () => "token");
    (globalThis as { Clerk?: unknown }).Clerk = { session: { getToken } };
    try {
      await expect(getSupabaseAccessToken()).resolves.toBe("token");
      expect(getToken).toHaveBeenCalledWith({ leewayInSeconds: TOKEN_LEEWAY_SECONDS });
    } finally {
      delete (globalThis as { Clerk?: unknown }).Clerk;
    }
  });

  it("is not asked for by the clock while a hidden tab has let go of the socket", () => {
    stop();
    const closed = { setAuth: vi.fn(async () => undefined), isConnected: () => false };
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    stop = keepRealtimeAuthFresh(closed);
    vi.advanceTimersByTime(60_000);
    expect(closed.setAuth).not.toHaveBeenCalled();
    // Back in view it is asked for at once, so the socket reopens signed in.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(closed.setAuth).toHaveBeenCalledTimes(1);
  });

  it("stops being asked for once stopped", () => {
    stop();
    vi.advanceTimersByTime(60_000);
    expect(realtime.setAuth).not.toHaveBeenCalled();
  });
});
