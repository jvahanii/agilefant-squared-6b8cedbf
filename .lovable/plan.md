## Diagnosis

Two distinct bugs, both rooted in code that compares the *global* `parentId` where it should compare the *effective per-tree parent* (`getEffectiveParentId(wi, treeId)`).

### Bug A — "Sometimes does nothing"
`src/components/AppLayout.tsx` line 915, inside the drag reorder path:

```ts
if (wi.parentId !== targetParentId) {
  reparentWorkItem(id, targetParentId, treeId, backlogId);
  ...
}
```

For an item that has a per-tree parent override in `treeId`, `wi.parentId` (global) does not describe where the item actually lives in this tree. If the effective parent in this tree already differs from `targetParentId` but the global `parentId` happens to equal `targetParentId`, the guard falsely returns "already there" and skips the reparent. The reorder step then runs against the wrong sibling group and nothing visibly moves.

### Bug B — "Copies of the same item appear"
Inside `reparentWorkItem` in `src/store/appStore.ts`, the single-tree (`!isMultiTree`) branch computes the destination rank by scanning siblings whose *global* parent equals `newParentId`:

- line 2265: `if (wi.parentId !== newParentId) continue;`
- line 2338: `if (wi.parentId !== newParentId) continue;`

Other items sitting under `newParentId` in this tree via a per-tree override are skipped by that filter, so `maxRank + 1` collides with a rank an override-sibling already owns. Since the tree sorts by `(rank, id)`, two items with the same rank stack at the same visual slot — one appears to be a duplicate of the other until a refresh reshuffles the tie-break.

The same class of bug shows up in the dedup pass for descendant migration (lines 2306 groups by `wi.parentId ?? null` instead of the effective per-tree parent), producing rank collisions after cross-backlog reparents.

## Fix

All edits are frontend-only. No schema change, no new state.

### 1. `src/components/AppLayout.tsx`
- In the drag reorder branch (~line 912-920), replace the `wi.parentId !== targetParentId` check with `getEffectiveParentId(wi, treeId) !== targetParentId`. Import `getEffectiveParentId` from `@/types/models` if it isn't already.

### 2. `src/store/appStore.ts` — `reparentWorkItem`
Replace every `wi.parentId !== newParentId` sibling filter inside the same-tree branches with the effective per-tree parent check, using the `treeId` in scope:

- Line 2265 (single-tree, isBacklogChange rank scan): `if (getEffectiveParentId(wi, treeId!) !== newParentId) continue;`
- Line 2338 (single-tree, same-backlog rank scan): use `getEffectiveParentId(wi, tId)` since the loop already iterates `[tId, blId]`.
- Line 2306 (dedup grouping after descendant migration in single-tree branch): key by `getEffectiveParentId(wi, treeId!) ?? null` instead of `wi.parentId ?? null`, matching what the multi-tree branch at line 2193 already does.

### 3. Optional guard: densify after reparent
After the reparent finishes, run the existing "densify per (tree, backlog, effective parent)" logic on the affected sibling group in memory before `upsertWorkItems`. This is the same one-line reuse already used by the auto-heal path from the previous fix pass; it prevents any residual collision from surviving to the DB if a stale in-memory rank existed before the operation.

## Verification

- Run `bunx vitest run src/test/appStore.test.ts` to confirm existing reparent tests still pass.
- Manual: reproduce the reported case — drag a per-tree-overridden item onto a new parent in the tree that owns the override, and confirm it moves. Reparent an item in a backlog that had prior rank collisions and confirm no visual duplicate remains.

## Out of scope

- Cross-tree drag/mirror path is untouched — it already uses `getEffectiveParentId`.
- No changes to `MoveToParentDialog`, which routes through the same store method and inherits the fix.
- No DB migration; a project-wide rank densification already ran in the previous pass.
