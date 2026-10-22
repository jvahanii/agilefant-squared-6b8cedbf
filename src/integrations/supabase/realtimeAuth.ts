/**
 * Keeps the live-updates connection signed in with a fresh Clerk token.
 *
 * supabase-js hands Realtime the first token it gets as an explicit one —
 * `realtime.setAuth(token)` — and realtime-js treats an explicit token as set
 * by hand: from then on it stops asking the `accessToken` callback for a new
 * one on its heartbeats. Clerk's tokens last sixty seconds, so a minute after
 * the page loaded the connection's token had run out and Realtime quietly
 * stopped delivering changes: items, lists, and the Jira types the sync sets
 * a few seconds after a move, all seen only after a reload.
 *
 * `setAuth()` with no argument asks the callback again, sends the new token
 * to every joined channel when it changed, and clears the by-hand flag, so
 * the heartbeats keep it fresh after that. It is repeated here anyway — the
 * initial explicit call may land after ours — and whenever the tab comes
 * back into view, since a hidden tab's timers are slowed.
 */

/** Often enough that a sixty-second token is always renewed before it runs out. */
export const REALTIME_AUTH_REFRESH_MS = 20_000;

interface RealtimeWithAuth {
  setAuth(token?: string | null): Promise<void>;
}

export function keepRealtimeAuthFresh(realtime: RealtimeWithAuth): () => void {
  const refresh = () => {
    realtime.setAuth().catch((e) => console.warn("Could not refresh the live-updates token:", e));
  };
  const timer = setInterval(refresh, REALTIME_AUTH_REFRESH_MS);
  const onVisible = () => {
    if (document.visibilityState === "visible") refresh();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
