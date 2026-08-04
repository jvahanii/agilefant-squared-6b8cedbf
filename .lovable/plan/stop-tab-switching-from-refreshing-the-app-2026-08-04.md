# Stop tab switching from refreshing the app

Switching to the Agilefant tab currently triggers a catch-up refetch whenever the tab was hidden for more than 20 seconds. That is far too often — normal tab switching should never cause a visible refresh.

## New behavior

Tab visibility alone stops being a resync trigger. A catch-up fetch happens only when there is actual evidence that realtime events were missed:

- The realtime socket is genuinely dead (still down on a second heartbeat tick).
- A realtime channel had a real outage and then resubscribed.
- The browser went offline and came back online.
- The tab was hidden for a genuinely long time (10 minutes or more), where the socket is almost certainly gone and a silent catch-up is worth it.

On a short-to-medium blur (anything under the long threshold), coming back only verifies/reopens the socket — no data fetch, no loading state.

## Technical changes

`src/hooks/useResyncOnWake.ts`
- Raise the hidden-duration threshold from `STALE_AFTER_MS = 20_000` to a new `HIDDEN_RESYNC_AFTER_MS = 600_000` (10 min).
- `onVisibility` on becoming visible: below the threshold, call `ensureSocketConnected()` only. Above it, resync as today (full when past `FULL_RESYNC_OUTAGE_MS`).
- `onFocus`: drop the resync branch entirely — focus only calls `ensureSocketConnected()`. Keep `hiddenSinceRef` bookkeeping in `onVisibility` so the two handlers don't double-fire.
- Keep the heartbeat and online/offline paths unchanged.

`src/lib/realtimeHealth.ts`
- No behavior change needed; `requestResync` keeps the 30 s floor and hidden-tab skip.

`src/pages/Index.tsx` and `src/App.tsx`
- Their `visibilitychange` handlers stay: they only re-fetch when the app is actually stuck (`isLoading` still true, or store empty / `loadingProgress === -1`), which is a broken-state recovery, not a routine refresh.

`src/test/realtimeHealth.test.ts`
- Add/adjust coverage asserting a short hidden period followed by visibility does not request a resync, and that a long hidden period still does.
