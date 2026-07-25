## Goal

Make the work-item tree panel snappy with 200+ items. Today every node re-renders on every store change (any edit, any selection, any time entry, any label update), because each node subscribes to the *entire* `workItems`, `backlogs`, `selectedWorkItemIds`, `hyperlinks`, `labels`, `byEntity`, and `timeEntries` maps. There's also no virtualization, and each node walks its full subtree to compute time totals.

Scope is limited to the list/tree rendering path — no schema, RPC, or business-logic changes.

## Plan

### 1. Narrow every per-node store subscription

In `WorkItemNodeContent` (and mirror in `BacklogNode` / the tree header row):

- `s.workItems` → don't subscribe to the map at all. Keep `s.workItems[workItemId]` (already narrow). Replace the general `workItems` reference used by `computeWorkItemTotalMinutes` and `sortedChildren` with narrow reads via `useAppStore.getState()` inside callbacks, or dedicated child-id selectors.
- `s.backlogs` → replace with a small selector that returns just what this node needs (the backlog path segments and the assigned-backlog display list). For the common case only `backlogs[backlogId]` is needed; grab that specifically.
- `s.selectedWorkItemIds` → replace with two narrow selectors: `isSelected = useAppStore(s => s.selectedWorkItemIds.includes(workItemId))` (already there) and a `selectionCount` when multi-select behavior needs it. Read the full array via `useAppStore.getState()` inside handlers, not as a subscription.
- `s.hyperlinks` → already narrowed to length; fine.
- Labels store: replace `s.labels` + `s.byEntity` full-map subscriptions with `s.byEntity[key]` and `s.labels` looked up lazily. `orgLabels` (used only inside the label picker) moves to a lazy `useMemo` computed from `getState()` when the picker opens, or is lifted to the parent panel and passed via context so it's computed once for the tree.
- Team store: `s.workItemTeams[workItemId]` (already narrow) is fine; `s.teams` moves to context (computed once at the panel).
- Time entries: replace `useTimeEntryStore(s => s.timeEntries)` with a shared cached selector — see step 3.

Effect: an edit to item X only re-renders node X, not all 200.

### 2. Memoize `WorkItemNode`

Wrap `WorkItemNode` in `React.memo` with a shallow prop comparison. All the store data now comes through narrow selectors, so the props (`workItemId`, `treeId`, `backlogId`, `depth`, flags) are stable and memo is effective. Same for `BacklogNode`.

### 3. Cache per-item time totals

`computeWorkItemTotalMinutes(workItemId, workItems, timeEntries)` walks the subtree on every render of every node. With 200 items and time logging enabled that's O(N²)-ish per keystroke.

Add a memoized selector in `timeEntryStore`:

- Build `totalsByWorkItemId: Record<string, number>` once per `(timeEntries, workItems)` change, using a single bottom-up pass over the work-item map.
- Expose `useWorkItemTotalMinutes(id)` that subscribes to `totalsByWorkItemId[id]` (a scalar), not to the raw `timeEntries` map.

Same treatment for `computeBacklogTotalMinutes` and `computeTreeTotalMinutes` (used in `BacklogTreePanel` and tree header). One pass, scalar subscription per node.

### 4. Virtualize the flat visible list

The tree renders recursively today. Flatten the currently-visible nodes (respecting `expandedWorkItems`) into a single array in the panel and render it with `@tanstack/react-virtual` (already used by `BoardView`).

- Panel builds `visibleRows: Array<{ kind: 'wi'|'backlog', id, depth, parentBacklogId, treeId }>` from `expandedWorkItems` + current search/filter state.
- `useVirtualizer` with a reasonable `estimateSize` and dynamic measurement via `measureElement` (the board already does this).
- Row component becomes the outer positioning wrapper; inside it renders the existing `WorkItemNode` / `BacklogNode` without their own children — children come from later rows in the flat list.

This caps DOM cost at whatever's on screen (~20–30 rows) regardless of list length.

### 5. Small hygiene fixes uncovered along the way

- Remove the hook-inside-`useMemo`-deps antipattern on line 307 (`useBacklogStatusesStore((s) => s.statusesByBacklog)` inside a deps array). Replace with a top-level subscription to the specific `statusesByBacklog[backlogId]` entry.
- Hoist `orgLabels` and `teams` computation from every node to the panel via a small React context, so it's O(1) work per tree instead of O(N).

### 6. Verification

- Add a temporary render counter in `WorkItemNode` in dev, load a tree with 200 items, edit one title, confirm only one node re-renders (previously all 200).
- Profile with the React DevTools Profiler before/after on a 200-item tree: expect commit time to drop from hundreds of ms to under ~20 ms for a single-item edit, and initial mount cost bounded by the viewport once virtualization lands.
- Run the existing vitest suite (`appStore.test.ts`, `paginationGuard.test.ts`) to confirm no store contract changed.
- Manually exercise: keyboard multi-select, drag-and-drop reorder, expand/collapse, inline rename, search — all of which depend on the flat visible list being correct.

### Order of landing

Steps 1–3 give the biggest per-edit win and are low-risk. Step 4 (virtualization) is the biggest structural win for very long lists and is the largest single change; land it after 1–3 so the diff is smaller and easier to review. Step 5 is a small cleanup that rides along with step 1.

### Technical details

- No database, RPC, or types changes.
- New file: a `timeEntryStore` selector module for the cached totals maps (or extend the existing store — reader's choice at implementation time).
- New file: shared row-context (`orgLabels`, `teams`, effective-statuses cache) inside `WorkItemTreePanel.tsx`.
- Virtualization reuses `@tanstack/react-virtual`, already installed.
