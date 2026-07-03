---
name: Configurable Boards
description: Per-backlog board columns as separate DB objects, each bound to a single work item status
type: feature
---
Board columns for a backlog live in the `public.board_columns` table (columns: `backlog_id`, `status_key`, `label`, `rank`). Each column is bound to exactly one work item status by key, but has its own user-editable label and order — renaming a column does NOT rename the status. Dropping a card into a column sets the item's status to that column's `status_key`.

Managed via `useBoardColumnsStore` (Zustand). On first board render of a backlog with zero rows, the store one-shot-migrates from legacy state: `backlogs.board_hidden_status_keys` (DB) + `board-column-order:{id}` / `board-column-labels:{id}` (localStorage). Legacy localStorage keys are cleared after successful seed. `backlogs.board_hidden_status_keys` remains for now but is no longer read.

"Hide column" is gone — the header context menu offers Rename, Add column (submenu of statuses not yet present), and Remove column. Realtime subscribes via a single client-side-filtered channel.
