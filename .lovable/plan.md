# List / Board view for backlogs

Add a tabbed view above the work-item panel. **List** keeps today's tree UI unchanged. **Board** renders a Kanban of the selected list's leaf descendants, grouped by the tree's status definitions. Tab choice is remembered per list in `localStorage`.

## Scope

- Applies to every list (backlog) that has a selection in the right-hand work item panel.
- Board shows **all leaf descendants** (any depth) of the selected list — items with no children.
- Columns come from `useTreeStatusesStore` for the list's tree; if none defined, fall back to the 5 built-in `WORK_ITEM_STATUSES`.
- Cards show the same essentials as list rows (title, points, assignees, labels chips, hyperlink icon).
- Clicking a card opens it (same behavior as selecting a row in list view).
- Dragging a card to another column updates the item's `status`.
- Board respects current sorting/rank inside each column (rank order preserved per column).

## Out of scope

- No new columns/config UI (statuses are already editable via TreeStatusesDialog).
- No swimlanes, no WIP limits, no multi-select drag on the board (single-card drag only).
- Mobile: same tabs; board becomes a horizontally scrollable column strip.

## Files touched

- `src/components/WorkItemTreePanel.tsx` — wrap current content in a `Tabs` (`List` | `Board`). Persist active tab per `selectedBacklogId` in `localStorage` (`board-view:<backlogId>`).
- `src/components/BoardView.tsx` **(new)** — renders columns and cards for a given `backlogId`. Uses `@dnd-kit/core` (already in use — no @dnd-kit/sortable per project rules) with `DndContext` + `useDroppable` on columns and `useDraggable` on cards. On drop, calls `updateWorkItem(id, { status: newStatus })`.
- `src/components/BoardCard.tsx` **(new)** — compact card component (title, points, assignees, labels).
- Reuse existing helpers: `getEffectiveParentId`, `useTreeStatusesStore`, `useAppStore` selectors.

## Data flow

```text
selectedBacklogId ─► collect all descendants via backlog children + workItem.backlogAssignments
                    └► filter leaves (childrenIds.length === 0 within the tree)
                       └► group by status → columns from treeStatuses[treeId] || WORK_ITEM_STATUSES
```

## Persistence

- Tab: `localStorage["board-view:<backlogId>"] = "list" | "board"`, default `"list"`.

## Verification

- Switching tabs preserves selection state.
- Dragging a card between columns updates the item's status (visible in list view and DB).
- Empty columns render as drop targets.
- Board updates in realtime when others change status (existing Supabase realtime already re-renders on workItem changes).
