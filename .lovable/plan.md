## Root cause

The item "Exit" that appears in *both* backlogs isn't the same DB row — there are three separate `work_items` rows all titled "Exit" that share the same `parent_id` (the "Employed…" MWB, `41af4c8f`):

| id | tree assignment | backlog assignment |
|---|---|---|
| `wi-8f6905f7` | `bt-47861693` | `bl-45de20e8` (No next steps) — this is the one you moved |
| `c17fc55f…` | `54a41273…` (legacy, tree no longer exists) | `bl-02aa81f7` (legacy, backlog no longer exists) |
| `wi-3c75f3bb` | `bt-d80652b9` | `bl-a46f86f7` |

`sanitizeData` correctly drops the stale assignment for `c17fc55f…` in memory, so it isn't assigned to any tree at all. **But the tree panel still renders it under the MWB parent in Funnel & todo**, because `WorkItemTreePanel`'s child-rendering pass (line 1335) only filters children by `getEffectiveParentId(child, treeId) === parent` — it never checks that the child is actually assigned to the current backlog/tree. Line 1356's `childBacklogId = child.backlogAssignments[treeId] ?? backlogId` then falls back to the parent's backlog, so the orphan visually inherits Funnel & todo.

Same untreed-child leak exists in the DB for many other items: 20+ `work_items` rows reference tree/backlog IDs that no longer exist in `backlog_trees` / `backlogs`. All are legacy duplicates whose parent still lives in Funnel & todo — that's why the backlog looks "full" and specifically why this doesn't happen in trees that don't have such legacy siblings.

## Fix

Two-part fix: presentation + data cleanup. The presentation fix alone is enough to make Funnel & todo look right; the data cleanup makes the DB self-consistent so future features don't repeat the bug.

### 1. Presentation: filter children by tree membership

`src/components/WorkItemTreePanel.tsx`:

- In the expanded-children block (around line 1335) add a filter: keep a child only if `child.backlogAssignments[treeId]` is defined AND is in the current view's backlog set (`allBacklogIds` / `backlogIdSet`). Same rule the root filter already uses at line 2382.
- Apply the identical filter inside `visibleItemIds` traversal (line 2401) so Tab / arrow navigation matches what is rendered.
- Drop the `?? backlogId` fallback at line 1356 — after the filter, `child.backlogAssignments[treeId]` is guaranteed to be present. Same for line 1390's `targetBacklogId` computation.

`src/components/BoardView.tsx`: audit the analogous child-rendering path; apply the same tree/backlog-membership filter if it uses `childrenIds` directly.

Net effect: an item shows up under a parent in a given tree only when it *itself* is assigned to a backlog visible in that tree.

### 2. Data cleanup migration

One-off SQL migration (via `supabase--migration`) scoped to `public.work_items`:

- Rebuild each row's `backlog_assignments` JSON: for every `(treeId → backlogId)` pair, keep it only if `treeId` exists in `backlog_trees` AND `backlogId` exists in `backlogs` AND that backlog's `tree_id = treeId`. Write the cleaned JSON back.
- Delete `work_item_backlog_ranks` rows whose `backlog_id` is not in `backlogs`.
- For any `work_items` row that ends up with `backlog_assignments = '{}'`: leave it in place (don't auto-delete — user may want to recover it). Log the count in the migration description so the user can review afterwards in the SQL editor.

This purges the phantom "Exit" (`c17fc55f…`) style rows from ever being rendered, whether or not the presentation filter is in place.

### 3. Prevent regression

`src/store/appStore.ts` — `moveWorkItemToBacklog` (line 1266 `moveRecursive`): only recurse into a child when the child currently has an assignment for `targetTreeId`. Today it unconditionally *adds* an assignment for the target tree to every descendant it walks, which can silently create the same class of orphan (child appearing in a tree it never belonged to). Skipping non-tree-members keeps moves scoped to the tree the user is operating in.

## Verification

- Reload the app after the migration; run `SELECT count(*) FROM work_items WHERE backlog_assignments->>'…bt-47861693' = '…bl-33bb5eb1'` — expect a smaller number matching what's actually visible in Funnel & todo.
- In the UI, open Funnel & todo — "Exit" (and other legacy duplicates) should no longer appear.
- Move a fresh branch from Funnel & todo → No next steps; hard reload; confirm nothing residual shows up in Funnel & todo.
- Run existing tests: `bunx vitest run src/test/appStore.test.ts`.
