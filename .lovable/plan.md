# Reconnect list and board ordering

## The rule

List rank and board rank stay **separate stored data**, but they must never contradict each other for **siblings that share the same status**:

If A is above B in the list, and both have the same status, then A must be above B in that status column on the board — and the reverse after a board drag.

Everything else stays independent: items of different statuses can sit in any order in the list, and board columns keep their own spacing/positions.

## What is broken today

- A board drag inside a column overwrites the affected items' **list ranks with the raw column index** (`AppLayout.tsx`, board reorder branch) — this scrambles list order because the column index has nothing to do with the item's position among all its list siblings.
- A drop on empty column space pushes the item to the **end of the list** as well.
- `reorderWorkItemInBoard` in the store writes only board ranks (no list reconciliation) — so two different code paths handle a board drag inconsistently.
- A list reorder never touches board ranks at all, so a list drag leaves the board contradicting the list.
- Result: the two views appear unconnected, and sometimes list order changes for no visible reason.

## The fix

Add one shared reconciliation helper (new file `src/lib/rankSync.ts`) with two directions, both operating on a single (tree, backlog, parent) sibling group:

1. `boardRanksFromList(siblings, backlogId)` — group siblings by status; within each status group, assign board ranks in list order (sequential integers). Used after any list reorder / list add / move.
2. `listRanksFromBoard(siblings, backlogId, statusKey, newColumnOrder)` — keep the list positions (slots) currently occupied by that status group, then re-fill those slots with the items in the new column order. Items of other statuses never move in the list. Used after any board reorder.

Then:
- **List reorder** (`reorderWorkItemAmongSiblings`) and **alphabetical sort**: after computing list ranks, run direction 1 and persist the board rank rows.
- **Board reorder** (`reorderWorkItemInBoard`): after computing board ranks, run direction 2 and persist list rank rows.
- **Status change** (`setWorkItemStatus`, and cross-column board drops): the item joins a new column — derive its board rank from direction 1 for that column so it lands where its list position says it should.
- **`AppLayout.handleDragEnd`**: delete the ad-hoc rank math in the board branches and delegate to the store actions (`reorderWorkItemInBoard`, `setWorkItemStatus`) so there is exactly one implementation. Drop-on-empty-column = append to that column via status change + reconciliation, with **no** list rank change.
- **New items** (`addWorkItem`, board add): keep list rank from the insertion point, then derive board rank via direction 1 instead of the current ad-hoc interpolation.

## Verification

- Unit tests in `src/test/appStore.test.ts`: list reorder keeps same-status board order consistent; board reorder permutes only the same-status list slots and leaves other statuses' list positions untouched; status change places the card correctly without moving the item in the list.
- Manual check in the preview on a backlog with mixed statuses: reorder in list, confirm board columns follow; reorder in board, confirm list order of that status follows and other rows don't move; refresh to confirm both persisted.
