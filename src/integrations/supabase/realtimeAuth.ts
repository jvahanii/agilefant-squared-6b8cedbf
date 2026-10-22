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
 * to every joined channel when it changed, and clears the by-hand flag. It is
 * asked here every few seconds rather than left to the heartbeats: they come
 * every twenty-five, and a token renewed just after one could run out before
 * the next — watched happening, the channel dropped and rejoined. The token
 * itself is renewed with half its life left (authClient.ts), so a check this
 * often always hands it over in time. Also whenever the tab comes back into
 * view, since a hidden tab's timers are slowed. Asking is cheap: Clerk
 * answers from its cache until it renews.
 */

/** Well inside the thirty seconds a token is handed out with. */
export const REALTIME_AUTH_REFRESH_MS = 10_000;

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
