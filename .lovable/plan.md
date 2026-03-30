## Fix: Sibling prompt not consistently appearing after child creation

**Problem**: After creating an item, the code dispatches `shortcut:add-sibling-workitem` via `queueMicrotask`. However, the newly created item's`WorkItemNode` component hasn't mounted and registered its event listener yet, so the event is lost. This is a race condition — sometimes React renders fast enough, sometimes not.

**Fix**: Replace `queueMicrotask` with `setTimeout(..., 50)` to give React enough time to mount the new item node and register its event listeners. Apply to both the `hasChildren` and `!hasChildren` `onSubmit` handlers in `WorkItemTreePanel.tsx`, and to the equivalent handler in `BacklogTreePanel.tsx`.

### Changes

`**src/components/WorkItemTreePanel.tsx**`

- **Lines 566-568** and **lines 581-583**: Replace `queueMicrotask(() => { ... })` with `setTimeout(() => { ... }, 50)` in both `isAdding` `onSubmit` callbacks.

`**src/components/BacklogTreePanel.tsx**`

- Same pattern: find the equivalent `queueMicrotask` dispatch of `shortcut:add-sibling-backlog` and replace with `setTimeout(..., 50)`.

### Files to change

- `src/components/WorkItemTreePanel.tsx` — 2 edits (replace `queueMicrotask` → `setTimeout`)
- `src/components/BacklogTreePanel.tsx` — same fix for backlog sibling prompt