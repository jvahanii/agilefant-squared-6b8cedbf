# Rate and mirror already-imported postings in the job import dialog

## What changes

In the job import picker, rows that are unticked **because the posting is already imported** (the "already in …" label) get the same stars and mirror switch that ticked rows have — but they act on the existing work item instead of a future import:

- **Stars** show the existing item's current rating. Clicking sets or clears that item's rating right away, the same as rating it on its row in the list. No new item is created.
- **Mirror switch** shows whether the existing item is already in the mirror list, and switching it mirrors the existing item there (never removes the existing mirror even when switched off), again without importing anything.
- Rows unticked for any other reason — closed, past deadline, a repeat, or unticked by hand — stay as they are: there is no item to act on.
- Ticked rows are unchanged: their stars and mirror switch still apply to the item the import will create.

## Technical details

All in `src/components/SavedSearchPicker.tsx`; no server or schema changes.

- Build a `Map<normalizedUrl, workItemId>` for the search's tree from `useAppStore` `workItems` + `hyperlinks`, using the same URL matching the picker's `alsoInByUrl` already relies on (`postingUrlsIn` per list of the tree).
- For an unticked row with `l.alreadyImported` and a matched item id, render the stars/mirror row (currently gated on `selected[key]`) in an "existing item" mode:
  - Stars: `rating={itemsNow[itemId]?.rating}`, `onRate={(r) => setWorkItemRating(itemId, r)}` (existing store action, `appStore.ts:3345`).
  - Mirror: checked when the item is already placed in `mirrorTarget` (per `moveWorkItemsToBacklog`'s mirror semantics); toggling calls `moveWorkItemsToBacklog([itemId], mirrorTarget.backlogId, mirrorTarget.treeId, "mirror", search.tree_id)` to add, and the corresponding unplace/remove-from-backlog path to remove — mirroring here never moves the item out of its current list.
- If the URL matches no item (e.g. items not loaded yet), the row keeps its current look — no stars, no switch.

## Verification

- Typecheck (`bunx tsgo -p tsconfig.app.json --noEmit`).
- Extend `src/test/savedSearchPicker.test.tsx`: an already-imported unticked row shows stars reflecting the existing item's rating; rating it calls `setWorkItemRating` on that item; the mirror switch mirrors the existing item without importing; a row unticked by hand shows neither.
- Run the picker test file.