## Configurable Board Views

### Labs toggle
- Add a new `Labs` card in `BellsAndWhistlesSection` with switch `boardsEnabled` (default off).
- Extend `OrgSettings` + `organization_settings` table with `boards_enabled boolean default false`.
- All board UI, nav, and data loading are no-ops when the flag is off.

### Data model (new tables, all org-scoped, RLS via existing helpers)
1. `boards` — id, organization_id, name, scope (`'tree' | 'custom'`), tree_id (nullable, used when scope='tree'), filter_json (used when scope='custom': item filters by tree, label, assignee, status, parent, text), created_by, created_at, updated_at, rank.
2. `board_columns` — id, board_id, name, color, rank, rule_json (predicate: status in [...], label in [...], assignee in [...], parent_id in [...], custom unmatched bucket flag).
3. `board_card_ranks` — id, board_id, column_id, work_item_id, rank (per-column ordering, mirrors `work_item_backlog_ranks`).

GRANTs to `authenticated` + `service_role`; RLS: org-member OR tree-accessible (when scope='tree'); writes require org membership. Enable realtime publication on all three.

### Hierarchy on board (default proposal — will iterate)
Render every item whose context matches the board (leaves and parents alike) as cards, with a small depth chip (`L1/L2/…`) and a parent breadcrumb on the card. Parents stay visible because they often hold status themselves. We can switch to "leaves only" or "expandable nested" later without schema change (rendering choice only).

### Columns
Fully custom. Each column has a rule (e.g. `status = in_progress`, `label = bug AND assignee = me`). A card lands in the first column whose rule it satisfies; an optional "Unmatched" bucket catches the rest. Column editor is a side sheet with rule chips.

### Card actions
- Drag between columns → mutate the attribute(s) that satisfy the target column's rule (status, label add/remove, assignee). When a column rule is ambiguous (multi-predicate), prompt once which mutation to apply and remember per column.
- Inline-edit title (double-click, like tree).
- Click → opens the existing item dialog (`MobileAttributesSheet` / desktop dialog).
- Within a column, drag reorders → writes `board_card_ranks`.

### Entry points
- Per-tree: a `Board` toggle next to the existing tree view in `WorkItemTreePanel` header. Lists boards with scope=tree for that tree, plus "+ New board for this tree".
- Global: new top-level nav entry `Boards` (only when flag on) listing all org boards (tree + custom), grouped by scope.

### Persistence / sharing
Per-organization. Visible to every org member; any member can edit (matches existing labels/statuses model). No per-user private boards in this iteration.

### Files (high-level)
- DB migration: new tables + GRANTs + RLS + realtime + `organization_settings.boards_enabled`.
- `src/store/boardsStore.ts` — Zustand store: load boards/columns/ranks for active+partner orgs, CRUD, optimistic updates, realtime sync hook in `useRealtimeSync`.
- `src/components/BoardsView.tsx` — column grid, dnd-kit dragging (reuse existing sensors config), virtualization for large columns.
- `src/components/BoardCard.tsx` — card with title, status pill, labels, assignees, depth chip, breadcrumb.
- `src/components/BoardEditorDialog.tsx` — name, scope, tree picker / filter builder, column list with rule editor.
- `src/components/ColumnRuleEditor.tsx` — chip-based predicate builder reusing label/status/team pickers.
- `src/pages/Boards.tsx` + route in `App.tsx` for global Boards section.
- `WorkItemTreePanel.tsx` — view toggle (Tree | Board) when tree-scoped boards exist or `boardsEnabled`.
- `BellsAndWhistlesSection.tsx` — Labs card with `boardsEnabled` switch.
- `orgSettingsStore.ts` — `boardsEnabled` field + setter + realtime mapping.
- `Index.tsx` — when boards on, kick `useBoardsStore.load([...orgIds])`.

### Out of scope for this iteration
- WIP limits, swimlanes, board templates, per-user private boards, board export.
- Confirm hierarchy choice (leaves only vs. all-as-cards vs. expandable nested).
