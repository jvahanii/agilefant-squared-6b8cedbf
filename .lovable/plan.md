
## Diagnosis (verified against DB)

The item the user is reparenting is `zenit morning wood ajossa` (id `…::e40418ed…`) in org Agilefant. In the database it has:

- `backlog_assignments`: only tree `54a41273…` → backlog `b49edcc3…` (single-tree item)
- `parent_id` (global): `…::wi-e7a88e47` — which is "Fat 23%=>20%"
- `parent_id_overrides`: `{ 54a41273… : …::wi-7343172d }` (per-tree override)

So its global parent is already Fat 23%=>20%, but a per-tree override redirects the parent in that very tree to `wi-7343172d`. Effective parent in the tree = `wi-7343172d`.

When the user picks Fat 23% as the new parent in `MoveToParentDialog`, `reparentWorkItem` is called with `newParentId = wi-e7a88e47`, `treeId = 54a41273…`. Because `backlogAssignments` has only one entry, `isMultiTree` is false and the single-tree branch in `src/store/appStore.ts` (~line 2874) runs. That branch:

1. Only mutates the global `parentId` (already equal to `wi-e7a88e47`, so no-op).
2. Never touches `parentIds` — the override for tree `54a41273…` still points at `wi-7343172d`.
3. Uses `item.parentId` (not `getEffectiveParentId`) to remove from the old parent's `childrenIds`, so it removes from the wrong parent list.

Result: `getEffectiveParentId(item, treeId)` still returns `wi-7343172d` after the operation, the toast fires, and the UI shows no change. In other trees the item has no override, so reparenting works.

The other "morning wood" rows in the DB confirm the same shape isn't unique — several items carry per-tree `parent_id_overrides` that the single-tree code path silently ignores.

## Fix

In `reparentWorkItem` (`src/store/appStore.ts`), make the single-tree branch (and the mirrored same-tree path) aware of per-tree overrides.

### Same-tree, single-tree reparent (line ~2874 `else` branch)

When `treeId` is provided:
- Compute `oldEffectiveParentId = getEffectiveParentId(item, treeId)` and use it (not `item.parentId`) to remove `workItemId` from the correct parent's `childrenIds`.
- Clear any per-tree override for this tree: `parentIds` for `treeId` should be deleted so the (updated) global `parentId` is what shows in this tree. Set the new global `parentId = newParentId` as today.
- If the item also lives in other trees via `parentIds` overrides for those trees, those stay untouched (only this tree's override is cleared / this tree's global-parent expectation is honoured).

When `treeId` is undefined (legacy caller), keep current behaviour.

### Same-tree, isBacklogChange path (line ~2893)

Same fix: clear `parentIds[treeId]` when updating global `parentId`, and use effective-parent when removing from old parent's `childrenIds`.

### Persistence

`upsertWorkItem` already writes both `parent_id` and `parent_id_overrides`, so clearing the override on the client is enough — the row's `parent_id_overrides` gets rewritten without the key on next sync.

### Test

Add a unit test in `src/test/appStore.test.ts` that:
1. Seeds one tree, two candidate parents A and B, and a single-tree item with `parentId = A` and `parentIds[treeId] = B`.
2. Calls `reparentWorkItem(item, A, treeId, backlogId)`.
3. Asserts `getEffectiveParentId(item, treeId) === A` and that A's `childrenIds` contains the item while B's does not.

## Out of scope

- The console `sanitizeData` warnings about backlog `1e8a657a…` missing are a separate data-integrity issue (a real backlog row is gone from that tree) and don't affect this bug.
- Multi-tree reparent path already handles per-tree parents correctly and stays as-is.

## Technical notes

Files touched:
- `src/store/appStore.ts` — two small edits inside `reparentWorkItem`'s single-tree branch.
- `src/test/appStore.test.ts` — new regression test.

No DB migration, no UI changes, no schema changes.
