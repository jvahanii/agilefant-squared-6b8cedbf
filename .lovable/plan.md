## Short answer

Yes — very likely. The sync work itself is cheap, but the *catch-up resync* it added is not: `requestResync` in `src/lib/realtimeHealth.ts` re-fetches the entire dataset (`loadFromSupabase`) plus ~8 sibling stores (teams, work-item teams, labels, statuses, snoozes, settings, time entries, financials, targets). On a big org that's a burst of large queries followed by wholesale store replacement, which re-renders the long lists and boards.

What confirms it from the code:

- `markChannelStatus` keeps **one global** healthy flag shared by the own-org channel and every partner-org channel. Any single channel reporting `CLOSED` / `CHANNEL_ERROR` flips it unhealthy, and then the *next* `SUBSCRIBED` of *any* channel reports "recovered" and fires a full resync.
- `useRealtimeSync`'s effect is keyed on `activeOrgId` + `treeIdsKey`, so whenever the accessible tree set changes the channels are torn down and rebuilt — the teardown/rebuild cycle is exactly the pattern that produces `CLOSED` → `SUBSCRIBED` and therefore a spurious full resync on top of the load that is already running.
- `useResyncOnWake`'s `focus` handler resyncs whenever `isSocketConnected()` reads false, with no stale-window and no debounce of its own (the 5 s coalescing window in `requestResync` is short relative to how long a full reload takes), so ordinary tab focus can queue extra full reloads.

## The fix

### 1. Don't treat teardown as an outage (`src/lib/realtimeHealth.ts`, `src/hooks/useRealtimeSync.ts`)
- Track health **per channel** (keyed by channel topic) instead of one module-level boolean; "recovered" means *that* channel went unhealthy and came back.
- Mark a channel as intentionally closed before `removeChannel` in the effect cleanup so its `CLOSED` status never counts as an outage.
- Suppress "recovered" resyncs for a channel that has never successfully subscribed yet (first join after mount is not a recovery).

### 2. Make resync cheap and rare
- Raise the coalescing window (5 s → ~30 s) and add a hard floor between two resyncs, so bursts of channel churn cannot chain full reloads.
- Skip a resync entirely when a full app load is already in flight (`appDataLoadInFlight` / the background-refresh promise in `appStore`) — today a resync can pile on top of the initial load.
- Skip while the tab is hidden; defer to the next visibility change instead.

### 3. Narrow what a resync actually re-fetches
- Default resync = work items/backlogs/trees only (`loadFromSupabase`). The satellite stores (labels, statuses, financials, targets, teams, snoozes) change far less often and are the bulk of the extra request volume; refresh those only on a *long* outage (e.g. offline > 2 min or socket down > 2 min), not on every focus.

### 4. Tighten the wake triggers (`src/hooks/useResyncOnWake.ts`)
- `focus` should only resync when the tab was actually hidden past the stale window, or when the socket has been observed closed for more than one heartbeat — not on the first `isSocketConnected()` false reading (which is also true briefly during normal reconnect).
- Keep the 60 s heartbeat, but have it reconnect the socket first and only resync if the socket is still down on the following tick.

## Verification

- Extend `src/test/realtimeHealth.test.ts`: per-channel recovery (channel A closing must not make channel B's `SUBSCRIBED` a recovery), intentional-close suppression, no resync while a load is in flight, and the longer debounce.
- Manual: with the network tab open, switch org / expand a shared tree and confirm exactly one dataset fetch (no second resync burst); background the tab for 30 s and confirm one catch-up fetch on return.

## Technical notes

No database or schema changes — the migration from the sync work (publication membership, `REPLICA IDENTITY FULL`) stays as-is; it only affects payload contents, not client cost. All changes are in `realtimeHealth.ts`, `useRealtimeSync.ts`, `useResyncOnWake.ts`, plus a small exported "is a load in flight" accessor on `appStore`.
