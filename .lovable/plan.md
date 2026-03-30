

## Fix: Prompt chaining stops after 2nd child & erratic + button

### Problem 1: Chain breaks after second item
When the first child is created via `isAdding`, it dispatches `shortcut:add-sibling-workitem` which triggers `isAddingSibling` on the new child. But the `isAddingSibling` `onSubmit` handler (line 594-603) does NOT dispatch another `shortcut:add-sibling-workitem` — so the chain dies after the second item. Same issue in `BacklogTreePanel.tsx` (line 440-443).

### Problem 2: Erratic + button  
The `useEffect` registering shortcut listeners (line 216-232) has `[isSelected, workItemId]` as dependencies but references `expanded` inside `handleAddChild`. Since `expanded` isn't in the dependency array, the closure captures a stale value — sometimes `toggleExpand` fires when it shouldn't, or doesn't fire when it should.

### Changes

**`src/components/WorkItemTreePanel.tsx`**

1. **Line 232** — Add `expanded` to the `useEffect` dependency array:
   ```ts
   }, [isSelected, workItemId, expanded]);
   ```

2. **Lines 594-603** — In the `isAddingSibling` `onSubmit`, after creating the item, dispatch `shortcut:add-sibling-workitem` with a 50ms delay (same pattern as the child `onSubmit`):
   ```ts
   onSubmit={(title) => {
     addWorkItem(title, item.parentId, backlogId, treeId, item.rank + 1);
     setIsAddingSibling(false);
     setTimeout(() => {
       window.dispatchEvent(new CustomEvent("shortcut:add-sibling-workitem"));
     }, 50);
   }}
   ```

**`src/components/BacklogTreePanel.tsx`**

3. **Lines 440-443** — Same fix for backlog sibling `onSubmit`:
   ```ts
   onSubmit={(name) => {
     addBacklog(name, parentId, backlog.treeId);
     setIsAddingSibling(false);
     setTimeout(() => {
       window.dispatchEvent(new CustomEvent('shortcut:add-sibling-backlog'));
     }, 50);
   }}
   ```

4. Add `expanded` to the equivalent shortcut `useEffect` dependency array if applicable.

### Files to change
- `src/components/WorkItemTreePanel.tsx` — fix dependency array, add chaining to sibling onSubmit
- `src/components/BacklogTreePanel.tsx` — add chaining to sibling onSubmit

