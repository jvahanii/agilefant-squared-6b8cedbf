## Root cause

Two related bugs introduced with the board-rank split:

1. **`work_item_board_ranks.rank` is `integer NOT NULL`** in the migration, but the runtime code inserts fractional ranks (midpoint scheme in `BoardView.handleColumnAdd` and in `AppLayout` drag handlers). Postgres rejects every such write with `invalid input syntax for type integer`. The failure surfaces as a `Failed to save board ranking` toast and, more importantly, leaves the board-rank row missing.

2. **`applyRealtimeWorkItem` rebuilds the local work-item object without a `boardRanks` field** (see `src/store/appStore.ts` around L3295–L3312). When the DB echo for the just-created work-item row arrives it overwrites the optimistic local object and strips the `boardRanks` map that `addWorkItem` had just set. Combined with (1) the DB has no board-rank row either, so the item then falls back to `ranks[blId]`. In list view the sibling reranking pushes the item's list rank around; on the next reload/echo cycle the item collides on rank with a sibling and — because the board dedup path is missing — the card either lands somewhere invisible (below the viewport of another column) or is squelched by the "existing card with same board rank" comparator that treats it as a duplicate of the previous top card and hides it in `cardsByStatus`.

The visible symptom is exactly what the user reported: the new card flashes in, the realtime echo lands, and it disappears from every view.

## Fix

### 1. Migration: change `rank` to `double precision`

New migration on `public.work_item_board_ranks`:

```sql
ALTER TABLE public.work_item_board_ranks
  ALTER COLUMN rank TYPE double precision USING rank::double precision;
```

Matches `work_item_backlog_ranks.rank` and unblocks all midpoint writes.

### 2. Preserve `boardRanks` in realtime echoes

`src/store/appStore.ts` — `applyRealtimeWorkItem`:

- Keep local `boardRanks` on the rebuilt object (same pattern already used for `ranks`, `childrenIds`, `parentIds`):
  ```ts
  boardRanks: state.workItems[id]?.boardRanks ?? {},
  ```
- No other fields change.

### 3. Always seed a board rank on new work items

`src/store/appStore.ts` — `addWorkItem`:

- Compute an effective `boardRank`:
  - If `requestedBoardRank` is a number, use it.
  - Otherwise pick "top of the target column": `min(existing boardRanks in (backlogId, targetStatus)) - 1`, defaulting to `0` when the column is empty. Fall back to `ranks[blId]` only when neither `boardRanks[blId]` nor the DB entry exists.
- Always set `newItem.boardRanks = { [backlogId]: effectiveBoardRank }`.
- Always call `upsertWorkItemBoardRankRows([{ workItemId: id, backlogId, rank: effectiveBoardRank, organizationId: orgId }])`.

This guarantees every new item has a board-rank row from the moment it exists, so echoes and reloads reproduce the correct position.

### 4. `handleColumnAdd` respects "selected card on board"

`src/components/BoardView.tsx`:

- When no `addAfterSlot` is present, look at `selectedWorkItemIds`; if exactly one is selected AND it lives in `cardsByStatus[statusKey]`, treat its index as the anchor (`afterIndex`) and reuse the existing midpoint calculation. Otherwise pass `undefined` so `addWorkItem` seeds top-of-column per (3).
- Matches the previously-agreed placement rule: "After the currently selected item on board. If none is selected on board, or the item is created in list view, then at the top of the column."

### 5. Test fixture

`src/test/appStore.test.ts`:

- Extend the existing `vi.mock('@/store/supabaseSync', ...)` factory to also export a no-op `upsertWorkItemBoardRankRows` so the reorder tests stop throwing (they currently all fail with `No "upsertWorkItemBoardRankRows" export is defined on the mock`). This is a test-only change; no runtime behavior shifts.

## Out of scope

- Cross-view sync (remains independent).
- Any list-view reorder behavior.
- Board dnd redesign — this plan only fixes the "add" regression.

## Verification

- Add item from list view → item stays after realtime echo, list view keeps it, board view shows it at top of its column.
- Add item from board column header on an empty column → appears, persists.
- Add item on a column with existing cards, with one card selected in that column → new item lands directly after the selected card and stays.
- Fractional board-rank writes (e.g. midpoint after a drag between cards) succeed in Postgres and no `Failed to save board ranking` toast fires.
- `bunx vitest run src/test/appStore.test.ts` passes.
