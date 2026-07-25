## Goal

Deleting ~20 selected items from a 200-item list hangs or takes many seconds. Fix the two synchronous hotspots on the delete path.

## Root causes (verified)

1. **`snapshot()` deep-clones everything on every mutation.** `src/store/appStore.ts:398` uses `JSON.parse(JSON.stringify(...))` over `workItems`, `backlogs`, `backlogTrees`, `hyperlinks`, *and* `changeLog` (capped at 5000 entries). `pushUndoEntry` runs this on every `set()` that pushes undo — including `deleteWorkItemsBulk`. With 200 items and a long changeLog this single call is the dominant cost. Because our reducers already produce new object references for anything they change, a shallow snapshot is sufficient for undo.

2. **`collectAffectedTimeEntryIds` is O(targets × timeEntries) per delete.** `src/hooks/useDeleteWithTimeGuard.ts` loops over each target and re-scans all time entries inside (`src/lib/timeUtils.ts:133`). For a 20-item bulk delete that's 20 full scans of `timeEntries` + 20 subtree walks and 20 full scans of `workItems`.

Secondary contributors on the same click:
- `handleDeleteClick` at `WorkItemTreePanel.tsx:355` bypasses the time-guard entirely when none of the selected items are multi-assigned, so time entries owned by deleted items never prompt the move dialog. Not a perf bug, but worth noting.
- `internalLog` (`appStore.ts:1056`) copies the full `changeLog` on each entry; only one call happens per bulk delete, so this is fine once (1) is fixed.

## Plan

### 1. Make `snapshot()` shallow (biggest win)

In `src/store/appStore.ts`:
- Replace the `JSON.parse(JSON.stringify(...))` clones with shallow copies:
  - `workItems: { ...state.workItems }`
  - `backlogs: { ...state.backlogs }`
  - `backlogTrees: { ...state.backlogTrees }`
  - `hyperlinks: { ...state.hyperlinks }`
- Keep the existing shallow copies for `selectedBacklogIds`, `selectedWorkItemIds`, `changeLog`, and the `Set` copies for expanded state.
- All reducers in this file already spread (`{ ...state.workItems, [id]: ... }`) or build a fresh object before mutating, so entries the snapshot references are never mutated in place. Undo/redo continues to restore the correct prior map by identity.

Audit before landing: grep the file for direct mutation patterns (`workItems[x] =`, `.push(`, `delete workItems[`, `childrenIds.push`) to confirm no reducer mutates a shared child object; wrap the two or three spots (if any) that do so in a spread. This is the only correctness risk.

### 2. Compute affected time entries in one pass for bulk deletes

In `src/lib/timeUtils.ts`, add a `collectAffectedTimeEntryIdsBulk(targets, data)` that:
- Unions the doomed work-item subtree(s), doomed backlog subtree(s), and doomed tree id(s) once.
- For work-item targets, also computes the "doomed if only-assignment-in-deleted-tree" set exactly like the single-target case, but sharing one pass over `workItems`.
- Does one pass over `Object.values(timeEntries)` classifying each entry against the unioned sets.

Update `src/hooks/useDeleteWithTimeGuard.ts` to call the bulk helper when given an array target. Keep the single-target path unchanged.

### 3. Route bulk deletion through the time guard consistently

In `WorkItemTreePanel.tsx` `handleDeleteClick` (line ~355), always call `guardedDeleteBulk(targets, label, () => deleteWorkItemsBulk(idsToProcess))` instead of skipping the guard when nothing is multi-assigned. This closes a real correctness gap (time entries on deleted items get silently orphaned today) and reuses the fast bulk collector from step 2 so there is no perf regression.

### 4. Verification

- Type-check: `bunx tsgo --noEmit`.
- Run existing tests: `bunx vitest run src/test/appStore.test.ts`.
- Manual perf sanity: with 200 items, select 20 via shift-click and press Delete. Confirm the click resolves within ~100 ms and the row count drops immediately. Repeat with a few thousand entries in `changeLog` to exercise the snapshot fix.
- Undo/redo one delete step to confirm the shallow snapshot restores state correctly.

### Order of landing

Steps 1 and 2 are independent and each fix a different linear-time-per-target cost; land them together. Step 3 is a small correctness follow-up that piggybacks on step 2.

### Technical notes

- No database, schema, or RPC changes.
- No changes to virtualization or memoization from the previous perf pass.
- Files touched: `src/store/appStore.ts`, `src/lib/timeUtils.ts`, `src/hooks/useDeleteWithTimeGuard.ts`, `src/components/WorkItemTreePanel.tsx`.
