## Goal
Move board columns out of `tree_statuses` + `localStorage` and into their own DB table, per backlog. Each column is a distinct object with its own name and order, and points to exactly one work item status key. Renaming a column no longer renames the status; hiding a column is now just "delete the column"; reordering is a persistent `rank`.

## Data model

New table `public.board_columns`:
- `id uuid pk`
- `backlog_id uuid not null → backlogs.id on delete cascade`
- `status_key text not null` — must match a `tree_statuses.key` in the backlog's tree at render time (not FK-enforced, since keys are strings and can be renamed by the tree status editor)
- `label text not null` — column display name, defaults to the status label at creation
- `rank double precision not null` — ordering within the backlog
- `created_at`, `updated_at` timestamps + update trigger
- Index on `backlog_id`
- No uniqueness on `(backlog_id, status_key)` — allowing the same status to appear in multiple columns is out of scope, but we don't want the DB to reject a transient duplicate during reorder/rename

RLS: same pattern as `backlogs` (readable/writable by members of the owning org via existing `has_backlog_access` helper); include the standard 4-step `CREATE TABLE → GRANT → ENABLE RLS → CREATE POLICY` block, plus `ALTER PUBLICATION supabase_realtime ADD TABLE public.board_columns`.

Remove `backlogs.board_hidden_status_keys` in a follow-up (kept for now to make migration reversible; not read after this change lands).

## Auto-migration (one-shot, client-side on first load per backlog)
When a backlog is opened in board view and has zero rows in `board_columns`:
1. Read the backlog's tree statuses.
2. Read legacy `boardHiddenStatusKeys` (DB) + `board-column-order:{id}` and `board-column-labels:{id}` (localStorage).
3. Insert one `board_columns` row per non-hidden status, in the persisted order (unknown-order statuses appended by status rank), applying label overrides.
4. On success, clear the two localStorage keys.

If the user has no legacy state, seed one column per status in status rank order using the status's own label.

## Store + sync
- New `boardColumnsStore` (Zustand) keyed by `backlogId → BoardColumn[]`, with:
  - `loadForBacklog(backlogId)` (lazy, on first board render)
  - `createColumn`, `renameColumn`, `deleteColumn`, `reorderColumns(backlogId, orderedIds)`
  - `applyRealtime(event, row)` handler
- Wire into `useRealtimeSync` alongside existing tables.
- All writes are optimistic + DB write, matching `treeStatusesStore` patterns.

## UI changes (`BoardView.tsx` only)
- Replace `allColumns`/`orderedColumns` derivation with `boardColumnsStore` rows for `backlogId`.
- Column header rename writes to `board_columns.label` instead of `localStorage`.
- Column drag-reorder writes new `rank` values instead of `localStorage`.
- "Hide column" becomes "Remove column" (deletes the row). "Show hidden" menu becomes "Add column", listing statuses that don't currently have a column in this backlog; picking one creates a `board_columns` row.
- Cards are still grouped by `wi.status`; a card lands in the column whose `status_key` matches. If a status has no column, its cards are not shown (same behavior as today's hidden state).
- Dropping a card into a column sets `wi.status = column.status_key` (unchanged behavior, just sourced from the column row).

## Out of scope
- Multiple statuses per column, predicate rules, cross-backlog board definitions — the earlier Labs boards memory stays aspirational; this change is strictly the "columns as separate objects, one status each" step the user asked for.
- Dropping `backlogs.board_hidden_status_keys` — leave the column in place for one release; remove in a follow-up once migration has run everywhere.

## Technical notes
```text
board_columns
┌────────────┬─────────────┬────────────┬────────┬──────┐
│ id         │ backlog_id  │ status_key │ label  │ rank │
├────────────┼─────────────┼────────────┼────────┼──────┤
│ uuid       │ → backlogs  │ text       │ text   │ f8   │
└────────────┴─────────────┴────────────┴────────┴──────┘
```
Files touched: new migration; new `src/store/boardColumnsStore.ts`; edits to `src/hooks/useRealtimeSync.ts`, `src/components/BoardView.tsx`; small type addition. No changes to `tree_statuses`, `work_items`, or list view.
