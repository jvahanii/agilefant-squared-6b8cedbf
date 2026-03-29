

## Auto-expand and prompt on child creation

**Goal**: When creating a child item or child backlog on a collapsed branch, automatically expand the branch, select the new child, and show the inline prompt for creating another sibling.

### Changes

#### 1. `src/components/WorkItemTreePanel.tsx` — WorkItemNode
- In the `handleAddChild` handler (line 218), besides `setIsAdding(true)`, also call `toggleExpand(workItemId)` if the node is not already expanded (`!expanded`).
- After the child is created via `addWorkItem` in the `onSubmit` callback (lines 560 and 571), the store already selects the new item (`selectedWorkItemIds: [id]`). The new item's WorkItemNode will mount with `isSelected=true`, and the sibling prompt behavior is already wired via the Enter key shortcut. However, to show the sibling prompt automatically after creation, we need to keep `isAdding` false on the parent but instead trigger `isAddingSibling` on the newly created child. 
- **Simpler approach**: After `addWorkItem` completes in the `onSubmit`, dispatch `shortcut:add-sibling-workitem` after a microtask so the newly selected/mounted child node picks it up. This reuses the existing sibling-add mechanism.

#### 2. `src/components/BacklogTreePanel.tsx` — BacklogNode
- In the `handleAddBacklog` handler (line 246), also call `toggleExpand(backlogId)` if not already expanded.
- After `addBacklog` in `onSubmit` (line 422), select the new backlog and show the sibling prompt. Since `addBacklog` doesn't currently select the new backlog, we need to:
  - Update `addBacklog` in appStore to also set `selectedBacklogIds: [id]` and `selectedTreeId: treeId`.
  - After creation, dispatch a microtask event to trigger sibling creation prompt on the new backlog.

#### 3. `src/store/appStore.ts` — addBacklog
- Update the `set()` call in `addBacklog` to also include `selectedBacklogIds: [id]` and `selectedTreeId: treeId`, so the new child backlog is automatically selected (matching how `addWorkItem` selects the new item).
- Also add the parent to `expandedBacklogs` if not already there.

#### 4. `src/store/appStore.ts` — addWorkItem  
- Add the parent to `expandedWorkItems` if `parentId` is provided and not already expanded.

### Summary of behavior
1. User triggers "add child" on a collapsed node
2. Store creates the child, expands the parent, and selects the new child
3. UI dispatches sibling-add event so the new child's inline prompt appears automatically

### Files to change
- `src/store/appStore.ts` — expand parent on child creation (both work items and backlogs), select new backlog
- `src/components/WorkItemTreePanel.tsx` — dispatch sibling prompt after child creation
- `src/components/BacklogTreePanel.tsx` — dispatch sibling prompt after child backlog creation

