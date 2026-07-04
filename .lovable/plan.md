
## Goal

Statuses become **per-backlog with parent inheritance**. Board columns are **fully derived** from the effective status set — reorder/add/rename/delete a column = reorder/add/rename/delete the status.

## Data model

Rename `tree_statuses` → `backlog_statuses`, scoped to a single backlog.

```
backlog_statuses(
  id uuid pk,
  backlog_id text fk backlogs.id on delete cascade,
  key text, label text, color text, rank int,
  created_at, updated_at,
  unique (backlog_id, key)
)
```

**Inheritance rule (resolved client-side):** for a backlog B, the effective status set = rows on B if any exist, otherwise walk `parent_id` up until a backlog with rows is found, otherwise fall back to the hardcoded defaults. As soon as a user edits statuses on a sub-backlog, that backlog gets its own rows (a full copy of the currently-inherited set is materialized), and it stops inheriting.

Pinned keys (`not_started`, `in_progress`, `done`) still can't be renamed/deleted and are auto-seeded whenever a backlog gets its own row set.

Retire `board_columns` — the board reads the effective statuses directly. Migration copies any custom labels/order back into `backlog_statuses` (label overrides applied, rank set from column order) before the table is dropped. Legacy `boardHiddenStatusKeys` is dropped too (columns are fully derived; hiding is done by deleting the status).

## Migration (single SQL migration)

1. Create `backlog_statuses` with GRANTs, RLS mirroring `backlogs` access, `updated_at` trigger, and a seed trigger that inserts the 3 pinned statuses when a backlog first gets any row (or on backlog insert — TBD; simplest: seed on first insert via app code, no DB trigger).
2. **Seed root backlogs** by copying each tree's `tree_statuses` rows into every root backlog of that tree (root = `parent_id IS NULL`). Sub-backlogs get no rows and inherit at read time.
3. **Fold `board_columns` overrides in** before dropping: for each root-backlog copy, if a `board_columns` row exists for that backlog+status_key, use its `label` and `rank` instead of the tree_statuses ones. For non-root backlogs that had custom board_columns, materialize a status set on that backlog from its inherited set + overrides.
4. Drop `board_columns` and `tree_statuses` tables and related realtime publications.
5. Drop the `board_hidden_status_keys` column on `backlogs` (if present).
6. Replace `seed_default_tree_statuses` / `touch_tree_statuses_updated_at` with equivalents for `backlog_statuses`.

## Frontend

- Rename `treeStatusesStore.ts` → `backlogStatusesStore.ts`. State becomes `statusesByBacklog: Record<string, BacklogStatus[]>`. Add `getEffectiveStatuses(backlogId)` that walks up `backlogs[id].parentId` to find the nearest backlog with a materialized set, else defaults.
- Add `materializeStatuses(backlogId)`: if the backlog has no rows, insert copies of the currently-effective set so future edits apply only here. Called automatically on the first create/rename/delete/reorder in an inherited backlog.
- Delete `boardColumnsStore.ts` and all usage. `BoardView` reads columns directly from `getEffectiveStatuses(backlogId)`:
  - Column order = status rank.
  - Rename column → `updateStatus({label})`.
  - Reorder columns → `reorderStatuses`.
  - Add column → status picker becomes "add new status" (create + auto-column). Adding a column that already exists elsewhere is no longer a concept.
  - Delete column → delete the status (blocked for pinned). Items with that status are re-mapped to `not_started`.
- Replace `TreeStatusesDialog` with `BacklogStatusesDialog`, opened from the backlog (not the tree). Show a subtle "Inherited from *ParentName*" banner when the backlog has no own rows, with an "Override" button that materializes.
- Update the tree context menu: remove "Statuses…"; add "Statuses…" to the backlog context menu.
- Work-item status validation: when moving/reassigning an item to a different backlog, if the item's `status` key isn't in the destination backlog's effective set, set it to `not_started` (silent, matches the answered rule). Handle in `appStore` move/assign paths (`moveWorkItemToBacklog`, drag-to-backlog reorder, cross-backlog reassignment, and paste).
- `WorkItem.status` typing already allows arbitrary keys via the string cast pattern used today; no type churn.

## Files to touch (non-exhaustive)

- New: `supabase/migrations/<ts>_per_backlog_statuses.sql`
- New: `src/store/backlogStatusesStore.ts` (replaces `treeStatusesStore.ts`)
- New: `src/components/BacklogStatusesDialog.tsx` (replaces `TreeStatusesDialog.tsx`)
- Edit: `src/components/BoardView.tsx` — drop board_columns wiring, read from effective statuses, keep drag/reorder/rename hooks pointed at status store.
- Edit: `src/components/BacklogTreePanel.tsx` / `WorkItemTreePanel.tsx` — move "Statuses…" menu item from tree to backlog.
- Edit: `src/store/appStore.ts` — auto-map status to `not_started` on cross-backlog moves; drop `boardHiddenStatusKeys` usage.
- Edit: `src/hooks/useRealtimeSync.ts` — replace `tree_statuses`/`board_columns` channels with `backlog_statuses`.
- Delete: `src/store/boardColumnsStore.ts`, `src/store/treeStatusesStore.ts`, `src/components/TreeStatusesDialog.tsx`.
- Update all imports of `getTreeStatuses` / `useTreeStatusesStore` (financials, snooze, list view, etc.) to `getEffectiveStatuses(backlogId)`; callers that only have a `treeId` will need to receive `backlogId` too — likely the majority of touch points.

## Risks / notes

- Callers that resolve statuses from only a `treeId` (e.g. list view header, financial rollups) need a `backlogId` in scope. Where a work item spans backlogs, resolve against the **current view's** backlog.
- Sub-backlogs that had customized board columns will become materialized standalone status sets, which is intentional given the answer.
- After migration, users who had renamed board columns will see the renames now attached to the status itself — expected per the requirement.
