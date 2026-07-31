# Cross-device sync without refresh

## What's happening today

The app does subscribe to Supabase Realtime (`src/hooks/useRealtimeSync.ts`) for work items, backlogs, trees, ranks, time entries, labels, statuses, financials and settings — and the relevant tables are in the `supabase_realtime` publication (verified). So sync *does* work while the socket is healthy.

What's missing is recovery. Verified in the code:

- No channel-status handling anywhere: `.subscribe()` is called with no callback, so `CHANNEL_ERROR`, `TIMED_OUT` and `CLOSED` are never observed and never retried.
- No `visibilitychange` / `focus` / `online` handler that resyncs data. The two existing `visibilitychange` handlers (`src/App.tsx`, `src/pages/Index.tsx`) only fire when the store is *empty* or still loading — a laptop with data already loaded does nothing on wake.

A laptop tab that has been idle (screen sleep, backgrounded, Wi-Fi blip, laptop lid closed) loses its WebSocket. Any change made on the phone during that window is broadcast to nobody, and on wake there's no re-subscribe and no catch-up fetch — so the stale state persists until a manual refresh. This matches the reported symptom exactly.

Two other gaps found while auditing:

- `teams` and `work_item_team_assignments` are subscribed to in the client but are **not** in the realtime publication, so team changes never propagate live.
- `work_item_board_ranks`, `time_entries`, `teams` and `work_item_team_assignments` have `REPLICA IDENTITY DEFAULT`, so DELETE events carry only the primary key. Board-rank and time-entry deletions may not be applied correctly on other devices.

## The fix

### 1. Realtime connection health module (new `src/lib/realtimeHealth.ts`)
- Track a single "realtime healthy" flag plus a `lastResyncAt` timestamp.
- Expose `markChannelStatus(status)` and `requestResync(reason)`.
- `requestResync` calls `useAppStore.getState().loadFromSupabase()` (plus the sibling store loaders: time entries, teams, labels, statuses, financials, targets, snoozes) behind a debounce (~5 s) so multiple triggers coalesce into one fetch.

### 2. Observe channel status in `useRealtimeSync.ts`
- Pass a status callback to every `.subscribe()`.
- On `SUBSCRIBED` after a prior failure → `requestResync('resubscribed')` to catch up on missed events.
- On `CHANNEL_ERROR` / `TIMED_OUT` / `CLOSED` → mark unhealthy and schedule a re-subscribe with backoff (remove + recreate the channel; the effect body is already factored so channels can be rebuilt).

### 3. Resync on wake (new `src/hooks/useResyncOnWake.ts`, mounted in `src/pages/Index.tsx`)
Triggers `requestResync` when:
- `visibilitychange` → visible and the tab was hidden longer than ~20 s;
- `window` `focus` after a hidden period;
- `online` event after `offline`.
Also calls `supabase.realtime.connect()` if the socket is not open, so channels rejoin immediately rather than waiting for the next heartbeat.

This keeps the existing loading-state retry logic in `App.tsx` / `Index.tsx` untouched; the new hook handles the "data present but possibly stale" case they deliberately skip.

### 4. Heartbeat safety net
A low-frequency interval (e.g. every 60 s, only while the tab is visible) checks whether the realtime socket is connected; if not, mark unhealthy, reconnect and resync. This covers silent socket death where no browser event fires.

### 5. Database migration (fixes the remaining gaps)
- `ALTER PUBLICATION supabase_realtime ADD TABLE public.teams, public.work_item_team_assignments;`
- `ALTER TABLE ... REPLICA IDENTITY FULL` for `work_item_board_ranks`, `time_entries`, `teams`, `work_item_team_assignments` so DELETE payloads include the columns the client handlers read.

## Verification

- Add a unit test for the debounce/coalescing behaviour of `requestResync`.
- Manual check: open the app in two browser contexts, background one for a minute, change a title in the other, bring the first back → the change appears without refresh.

## Technical notes

Reconnect uses capped exponential backoff (1s → 30s) and never fires while the tab is hidden, to avoid battery drain and request storms. The resync path reuses the existing paginated loaders, so no new query patterns or RLS surface is introduced.
