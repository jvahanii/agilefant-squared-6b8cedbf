# Single Undo for Multi-Select Operations

## Problem

When several work items (or backlogs) are selected and the user triggers an action — status change, delete, move-to-backlog, label assign/unassign, reparent, snooze, etc. — the UI calls the per-item store mutator inside a `forEach`. Each mutator independently pushes a snapshot to `undoStack`, so undoing a 10-item bulk action takes 10 Ctrl+Z presses.

There are ~30 such bulk call sites across `WorkItemTreePanel`, `BacklogTreePanel`, `AppLayout`, `MoveToParentDialog`, `MoveToBacklogDialog`, `LabelPicker`.

## Solution

Introduce a batching wrapper in `src/store/appStore.ts` and wrap every bulk call site with it. One bulk action = one snapshot = one undo.

### Store changes (`src/store/appStore.ts`)

1. Add a module-level `undoBatchDepth` counter and `undoBatchSnapshotTaken` flag (not part of zustand state, just module locals).
2. Add `runBulk(fn: () => void): void` to the store API:
   - On entry, if depth is 0, capture one snapshot of current state and set `undoBatchSnapshotTaken = true`. Increment depth.
   - Run `fn()`.
   - On exit, decrement depth. When depth returns to 0, push the captured snapshot to `undoStack` (trimmed to `MAX_UNDO`) and clear `redoStack`, then reset the flag.
   - Wrap in try/finally so a thrown error still resets depth.
3. Change every existing `undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)]` push inside the ~30 mutators to be conditional: if `undoBatchDepth > 0`, skip the push (the wrapper already snapshotted). Cleanest is a small helper `pushUndo(state)` that returns either the new array or `state.undoStack` unchanged when batching.

### Call-site changes

Wrap each multi-id `forEach` with `runBulk`. Affected files and approximate lines:

- `src/components/WorkItemTreePanel.tsx` — 596, 649, 1010 (status changes), 1081 (move-to-backlog), 1114, 1116 (label assign/unassign)
- `src/components/AppLayout.tsx` — 246, 278 (delete bulk), 295, 305, 314, 323, 332 (status shortcuts), 580, 587 (delete shortcut), 755, 776, 781, 794, 812, 825 (drag-and-drop multi-move), 911
- `src/components/MoveToParentDialog.tsx` — 146, 163
- `src/components/MoveToBacklogDialog.tsx` — 64, 111
- `src/components/LabelPicker.tsx` — 108, 111, 127
- `src/components/BacklogTreePanel.tsx` — any `forEach` over selected backlog ids (audit during implementation)

Each wrap is mechanical:

```ts
runBulk(() => {
  selectedWorkItemIds.forEach((id) => setWorkItemStatus(id, newStatus));
});
```

### Tests (`src/test/appStore.test.ts`)

Add a focused test: select 3 items, call `runBulk(() => ids.forEach(id => setWorkItemStatus(id, 'done')))`, assert `undoStack.length` grew by exactly 1, and a single `undo()` reverts all 3 items.

## Out of scope

- No change to redo behavior beyond the standard "new action clears redo" — that already happens once via the wrapper.
- No change to single-item operations; they still snapshot per call exactly as today.
- Drag-and-drop already groups its DB writes; only the undo-stack push is being coalesced.
