
# Burnups (Cumulative Flow Diagrams)

Adds a per-org Labs toggle "Burnups" that unlocks stacked-by-status cumulative flow charts for backlog trees, backlogs, and individual work-item branches, based on either item count or points.

## 1. Labs toggle

- Add `burnups_enabled boolean not null default false` to `organization_settings`.
- Extend `orgSettingsStore` with `burnupsEnabled` state + setter, mirroring the existing `boardsEnabled` pattern.
- Add a "Burnups" switch card in `BellsAndWhistlesSection.tsx` (Labs section) using `TrendingUp`/`AreaChart` icon.

## 2. History storage (on-demand snapshots)

New table `work_item_history` capturing every meaningful change:

```
work_item_history
  id            uuid pk
  work_item_id  text (FK-less, matches work_items.id format)
  organization_id uuid
  recorded_at   timestamptz default now()
  event         text check in ('created','updated','deleted','restored')
  status        text        -- status key at this point in time
  points        int         -- points at this point in time (nullable)
  exists_flag   boolean     -- false on delete events
  parent_id     text        -- effective parent captured for branch rollups
  backlog_assignments jsonb -- {treeId: backlogId} snapshot
```

- Indexes on `(work_item_id, recorded_at)` and `(organization_id, recorded_at)`.
- RLS: same access model as `work_items` (member of org OR accessible via shared tree). Grants to `authenticated` + `service_role`.
- Written by a Postgres trigger on `work_items` (AFTER INSERT/UPDATE/DELETE) so snapshots are guaranteed for every write path (client, RPC, restore, respawn). Trigger records a row only when a tracked column changes: `status`, `points`, `parent_id`, `backlog_assignments`, or existence.
- Backfill: seed one row per current work item at migration time (event `'created'`, `recorded_at = now()`) so charts have a starting point.

## 3. View-preference persistence

New table `work_item_chart_prefs` keyed by `(organization_id, scope_type, scope_id)` where:
- `scope_type` ∈ `'tree' | 'backlog' | 'work_item'`
- `metric` ∈ `'count' | 'points'`
- `range_days` int, `stacked` bool (future-proof)

Store both the user's explicit metric choice and a null value meaning "auto". Zustand store `chartPrefsStore.ts` mirrors it; loaded lazily when a chart opens.

## 4. Chart dialog

New `BurnupChartDialog.tsx` opened from context menus on:
- Backlog tree header (`BacklogTreePanel.tsx`) — scope = whole tree
- Backlog row (`BacklogTreePanel.tsx`) — scope = backlog subtree
- Work item (`WorkItemTreePanel.tsx` + `BoardView.tsx`) — scope = item branch

Dialog content:
- Header: scope name, metric toggle (Items / Points), date range picker (default last 30 days, daily buckets).
- Body: stacked area chart via Recharts (`AreaChart`, one `Area` per effective status in stack order). Colors pulled from `backlog_statuses` for the scope (root backlog for tree/backlog scope; nearest effective statuses for item branches via the item's primary backlog).
- Legend shows status labels; hovering a day shows counts/points per status.

## 5. Metric selection defaults

Resolver `resolveDefaultMetric(scope)`:
- If org `pointsEnabled` is false → `'count'`.
- Tree/backlog scope: if points selected in DB prefs → honor it; else default `'points'` when `pointsEnabled`, otherwise `'count'`.
- Item-branch scope: default `'points'` iff any descendant item in the branch has a non-null `points` at the currently-viewed timestamp, else `'count'`.
- When metric = `'points'`, items with null points count as `1` (mirrors existing rollup rule in `points-system` memory).

## 6. Aggregation logic

Client-side computation in `src/lib/burnupData.ts`:
1. Fetch `work_item_history` rows for the item set in scope (paginated via `paginateSelect`).
2. For each day in the selected range, reduce to the latest row per work item on/before that day → determines existence + status + points.
3. Filter by scope membership (branch = item + recursive descendants using `parent_id` snapshot; backlog/tree = items whose snapshot `backlog_assignments` matched at that day).
4. Group by status → sums (count or points-with-null-as-1).

Membership uses each day's historical `parent_id` / `backlog_assignments` so re-parented or moved items are attributed correctly over time.

## 7. Realtime

Extend `useRealtimeSync.ts` with a subscription on `work_item_history` INSERTs for the active org; append into an in-memory cache used by open dialogs so charts update live.

## 8. Technical details

- Recharts is already in `package.json`; no new dependencies.
- Snapshot trigger is written in a single migration together with the table + backfill + prefs table + settings column + grants + RLS + realtime publication additions.
- All new stores follow existing paginated-select and realtime patterns; unit-tested aggregation via a small vitest suite covering (a) count default, (b) branch with points, (c) null-points-as-1, (d) re-parented items across time.
- Chart dialog is lazy-imported so it doesn't affect first paint.

## Out of scope

- No burndown target lines (pure burnup/CFD).
- No email/export of charts.
- History for backlogs/trees themselves (only work items — backlog/tree existence changes are rare and current-state is sufficient for scope resolution).
