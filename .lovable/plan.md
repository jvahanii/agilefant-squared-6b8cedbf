## Goal

Let users reassign already-logged time from one target (work item / backlog / backlog tree) to another. Available from:
- **TimeLogDialog** — a new "Move time…" action to move entries currently logged on the open target.
- **TimesheetBrowserDialog** — a new "Move…" action for selected rows in the Entries tab.

## UX

### New component: `MoveTimeDialog`

- Header: "Move time" with a summary line "Moving N entries · total Xh Ym".
- **Mode selector** at the top (only shown when opened from TimeLogDialog — Browser passes explicit selection):
  - **All entries on this target** (default, when opened from TimeLogDialog)
  - **Selected entries only** — reveals a compact scroll list of the current target's entries with checkboxes (date, duration, user, note).
- **Destination picker** with three tabs (per user's answer):
  - **Trees** — list of backlog trees in the active org (searchable).
  - **Backlogs** — list of backlogs grouped by tree (searchable).
  - **Work items** — searchable list (title match), showing parent backlog for context. Uses existing lookup pattern from `MoveToBacklogDialog`.
- Footer: **Cancel** / **Move N entries**. Destructive-style confirmation only when moving across orgs (shared trees).

### Entry points

- **TimeLogDialog**: add a small "Move…" button next to "Log time" (visible only when `itemEntries.length > 0`). Opens `MoveTimeDialog` pre-scoped to the current work item / backlog / tree.
- **TimesheetBrowserDialog**: add a checkbox column to the Entries tab plus a "Move…" toolbar button that's enabled when ≥1 row is checked. Opens `MoveTimeDialog` with the selected IDs.

## Behavior

Moving an entry rewrites its target columns:
- To **work item**: `work_item_id = <id>`, `backlog_id = null`, `tree_id = null`.
- To **backlog**: `backlog_id = <id>`, `work_item_id = null`, `tree_id = null`.
- To **tree**: `tree_id = <id>`, `work_item_id = null`, `backlog_id = null`.

`organization_id` is updated to the target's org (matters for entries on shared trees). `user_id`, `spent_date`, `duration_minutes`, `note`, `created_at` are preserved.

Realtime already covers UPDATE echoes, so all open views refresh automatically. `computeWorkItemTotalMinutes` / `computeBacklogTotalMinutes` / `computeTreeTotalMinutes` recalculate from the new assignments.

## Permissions

Per user's answer, **any org member** may move entries (not just the owner). Current RLS restricts UPDATE to entry owner or admins, so we add a SECURITY DEFINER RPC to bypass that check safely:

```
move_time_entries(entry_ids uuid[], target_kind text, target_id text)
```

- Verifies caller `is_member_of` every source `organization_id` **and** the destination's org.
- Verifies the destination exists and belongs to a reachable org (own org or a shared tree partner org).
- Updates the rows in one statement; returns the count moved.
- Grants EXECUTE to `authenticated`.

Existing per-owner UPDATE policy stays untouched — duration/note edits remain owner-only via the client dialogs.

## Files

- **New**: `src/components/MoveTimeDialog.tsx` — the dialog with tabbed picker and mode toggle.
- **New migration**: `move_time_entries` RPC + GRANT.
- **Edit** `src/store/timeEntryStore.ts` — add `moveTimeEntries(ids, target)` that calls the RPC and optimistically updates local state.
- **Edit** `src/components/TimeLogDialog.tsx` — add "Move…" button and mount `MoveTimeDialog`.
- **Edit** `src/components/TimesheetBrowserDialog.tsx` — add checkbox column, "Move…" toolbar button, and mount `MoveTimeDialog`.

## Out of scope

- Splitting one entry across multiple targets.
- Bulk editing duration/date/note (still owner-only via existing edit flow).
- Undo — a moved-back operation is a second move.
