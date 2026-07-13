## Goal

Split work-item ordering into two fully independent ranks: **list rank** (existing, per backlog) and **board rank** (new, per backlog). Reordering in one view never touches the other.

## Data model

Add a per-backlog board rank alongside the existing per-backlog list rank.

- New table `work_item_board_ranks` mirroring `work_item_backlog_ranks`:
  - `organization_id`, `work_item_id`, `backlog_id`, `rank double precision`, timestamps
  - Unique on `(work_item_id, backlog_id)`, same RLS + GRANTs pattern as the list-rank table
- `WorkItem.ranks` stays as the list rank map. Add `WorkItem.boardRanks: Record<backlogId, number>`.
- Realtime + snapshot/restore extended to cover the new table.

## Migration of existing data

For every `(backlog_id, status)` group, seed `work_item_board_ranks.rank` by taking the current list rank order within that group and re-numbering 0..N-1. Runs once in the SQL migration.

## Store changes (`appStore.ts`, `supabaseSync.ts`)

- Load/write `boardRanks` alongside `ranks`. Reuse the pending-upserts + auto-heal machinery, duplicated for the board table.
- New actions:
  - `reorderBoardItems(backlogId, statusKey, orderedIds)` — writes only `boardRanks`.
  - `setWorkItemStatus` no longer implicitly changes list rank (already true); when moving between columns, it also assigns a board rank at the drop position (top / after neighbour) without touching `ranks`.
- List reorder paths (`reorderWorkItems`, drag in `WorkItemTreePanel`, keyboard move) touch only `ranks`.
- `addWorkItem` / WhatsApp / respawn / duplicate:
  - List rank: unchanged (top of list, or explicit rank when provided).
  - Board rank: **after the selected board card** in the target column if the user is in board view and a card is selected in that column; otherwise **top of the column**. A new optional `boardRank?: number` argument on `addWorkItem` carries the caller's choice; default = top.
- `moveWorkItemToBacklog` seeds a fresh board rank at the top of the target column (and drops the old backlog's entry).

## BoardView

- Sort cards in each column by `boardRanks[backlogId]` (fallback to `ranks[backlogId]` only for items still missing a board rank post-migration).
- Drag-between/within columns calls the new `reorderBoardItems` and, when the column changed, `setWorkItemStatus`. No writes to `ranks`.
- Inline "add card" computes the board rank from the currently selected card in that column (after it), else top; passes it as `boardRank` to `addWorkItem`.
- Column-level "move to top/bottom" acts on board rank only.

## List view

No behavioural change beyond: reordering never writes `boardRanks`.

## Realtime + integrity

- `useRealtimeSync` subscribes to `work_item_board_ranks` and merges into `boardRanks`.
- `dataIntegrity` gains a duplicate-board-rank healer analogous to the list-rank one, grouped by `(backlog_id, status)`.

## Out of scope

- Cross-view syncing of any kind.
- Changing how statuses themselves are stored (already per-backlog).
- List-view UI.

## Technical notes

- `WorkItem.boardRanks` defaults to `{}`; selectors fall back to `ranks[backlogId] ?? 0` so pre-migration clients still render sensibly.
- Board rank inserts use the same "midpoint between neighbours, else neighbour±1" scheme already used for list ranks in `BoardView.tsx`.
- Snapshot/restore edge functions (`build_organization_snapshot`, `restore_organization_backup`) updated to include the new table.
