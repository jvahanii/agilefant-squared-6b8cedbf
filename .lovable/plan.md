## Goal
When deleting a work item, backlog, or backlog tree that has time entries logged (directly or on descendants), prompt the user first. If they choose to preserve the time, open the existing `MoveTimeDialog` to reassign those entries before proceeding with the deletion.

## Flow

```text
User triggers delete
        │
        ▼
Collect affected time entries (self + descendants)
        │
   any entries?
   ┌────┴────┐
   no        yes
   │         ▼
   │   ActionPrompt: "N time entries are logged here"
   │     • Move time entries…      (default)
   │     • Delete without moving   (destructive)
   │     • Cancel
   │         │
   │   ┌─────┼───────────────┐
   │   move  delete-anyway   cancel
   │   ▼         ▼             ▼
   │  MoveTimeDialog  proceed  abort
   │   (on success) → proceed
   ▼
Original delete runs
```

Deleting without moving leaves the DB rows: `time_entries.work_item_id/backlog_id/tree_id` FKs are `ON DELETE SET NULL` (or similar) so entries become unattached — same as today. The prompt just gives users a chance to preserve attribution.

## Scope of "affected entries"

- **Work item delete**: entries with `workItemId === id`. (Work items have no descendants that carry their own time; children are separate items handled by their own cascade.)
- **Backlog delete**: entries with `backlogId === id` OR `workItemId ∈ items assigned to this backlog (only)`. For simplicity of the first pass, include only entries directly on the backlog plus entries on work items whose *only* backlog assignment is this one (i.e. items that will actually disappear). Items still assigned elsewhere keep their entries untouched.
- **Tree delete**: entries with `treeId === id` OR on any backlog under the tree OR on work items reachable only via this tree.

If exhaustive descendant scanning becomes complex for backlog/tree, fall back to "entries directly on this container" for v1 and note the limitation — most usage logs to the container itself or to items visible via one tree.

## Implementation

### 1. Helper — `src/lib/timeUtils.ts`
Add `collectAffectedTimeEntryIds(target, { workItems, backlogs, trees, timeEntries })` returning `string[]`. One function, three branches by target kind, using the scoping rules above.

### 2. New component — `src/components/DeleteWithTimeGuard.tsx`
Small wrapper that, given a target and an `onConfirmedDelete` callback:
1. Computes affected entry IDs.
2. If zero → call `onConfirmedDelete()` immediately.
3. Else → render `ActionPrompt` with the three options.
4. On "Move" → open `MoveTimeDialog` with `source={ kind: 'selection', entryIds }`; after it closes successfully, call `onConfirmedDelete()`.
5. On "Delete without moving" → `onConfirmedDelete()`.
6. On "Cancel" → close.

Exposed as an imperative helper (`useDeleteWithTimeGuard()` hook returning `requestDelete(target, onConfirmed)`) mounted once at `AppLayout` level so any caller can trigger it without wiring dialogs locally.

### 3. Wire into existing delete call sites
Replace direct `deleteWorkItem` / `deleteBacklog` / `deleteBacklogTree` invocations with `requestDelete({ kind, id }, () => deleteX(id))` in:
- `WorkItemTreePanel.tsx` (context menu + keyboard delete)
- `BacklogTreePanel.tsx` (backlog + tree context menus)
- `AppLayout.tsx` (any global delete shortcut)
- `MobileAttributesSheet.tsx` if it exposes delete

Multi-select delete: aggregate affected entries across all selected targets, show a single prompt, then run deletes.

### 4. No DB changes
`MoveTimeDialog` and `move_time_entries` RPC already exist and cover the reassignment.

## Out of scope
- Changing FK cascade behavior on `time_entries`.
- Undo of the delete after move.
- Auto-moving to the parent container (explicit user choice via existing picker).
