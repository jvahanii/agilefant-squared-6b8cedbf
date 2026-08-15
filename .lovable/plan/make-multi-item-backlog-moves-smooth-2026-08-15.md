# Make multi-item backlog moves smooth

## What happens today

Every caller that moves a multi-selection loops over the items and calls the single-item move action once per item (move dialog, drag-and-drop onto a backlog, context menu). Each of those calls:

- writes a full new state snapshot (one re-render per item),
- renumbers **all** siblings in the target backlog to dense 0..n,
- renumbers **all** siblings in **every** source backlog context to dense 0..n,
- pushes its own undo entry and its own database upsert batch.

So moving 10 items produces 10 renders where the remaining rows in the source list get their ranks rewritten 10 times over. That is the jumping and shifting: rows visibly re-sort while each pass lands, and the database echoes those rank rows back over realtime afterwards.

## The fix

1. **One batched move action.** Add `moveWorkItemsToBacklog(workItemIds, targetBacklogId, targetTreeId, strategy?, sourceTreeId?)` to the store. It performs the whole multi-item move inside a single state computation: assign the moved items (and their in-tree descendants) to the target backlog, remap statuses, then commit **one** `set(...)`, **one** upsert batch, **one** rank-row deletion batch, and **one** undo entry. The existing single-item action becomes a thin wrapper over it, so no behavior changes for single moves.

2. **Stop churning the source list.** Ranks are only ever compared relative to siblings, so gaps are harmless. The batched move no longer re-densifies source backlog contexts; it just drops the moved items' rank entries. Remaining rows keep their exact rank values, so nothing shifts except the removed rows disappearing.

3. **Target side ordering, computed once.** The moved items are placed at the top of the target backlog in their current source-list order (stable, no interleaving), using fractional ranks below the current minimum instead of renumbering the whole destination. Existing destination items keep their ranks. Board ranks for the moved items are derived once via the existing rank-sync helper so board columns stay consistent.

4. **Callers use the batch.** Update the move dialog, the drag-and-drop drop handlers in the app layout, and the tree/board context menus so a multi-selection calls the batched action once instead of iterating.

## Verification

- Extend `src/test/appStore.test.ts`: moving three of five items keeps the two remaining items' ranks untouched, preserves the moved items' relative order at the top of the destination, and produces a single undo entry (one `undo()` restores all of them).
- Existing move tests in `appStore.test.ts` / `appStore.integration.test.ts` must still pass (they exercise the single-item wrapper, cross-tree move, mirror, and descendant propagation).
- Manual check in the preview: select ~10 items in a 50+ item backlog, move them via the dialog and via drag-and-drop, confirm the source list settles in one step with no visible re-sorting, and refresh to confirm ordering persisted.

## Technical notes

- Source-side densification is removed only for the move path; the existing duplicate-rank repair (`dedupWorkItemRanksInPlace`) and integrity checks still guard against colliding ranks.
- Fractional ranks are already supported (rank columns are `double precision`), so inserting below the minimum needs no schema change.
- Undo coalescing via `runBulk` stays available but is no longer required for moves.
