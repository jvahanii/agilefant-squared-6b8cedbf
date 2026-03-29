

## Fix: Add child on collapsed parent does nothing

**Problem**: When `isAdding` is set to true on a collapsed node that already has children, the inline input never renders because:
- Line 514: outer wrapper shows (due to `expanded || isAdding`)
- Line 516-568: children + input only render when `expanded && hasChildren` — fails because not expanded
- Line 571: fallback input only renders when `!hasChildren` — fails because has children

**Fix**: In the `handleAddChild` handler (line 218) and the button onClick (line 488-491), also expand the node when setting `isAdding(true)`.

### Changes

**`src/components/WorkItemTreePanel.tsx`**

1. **Line 218** — shortcut handler: change from `() => setIsAdding(true)` to also call `toggleExpand` if not expanded:
   ```ts
   const handleAddChild = () => {
     if (!expanded) toggleExpand(workItemId);
     setIsAdding(true);
   };
   ```

2. **Lines 488-491** — button onClick: same pattern:
   ```ts
   onClick={(e) => {
     e.stopPropagation();
     if (!expanded) toggleExpand(workItemId);
     setIsAdding(true);
   }}
   ```

This ensures the node is always expanded when adding a child, so the inline input renders correctly regardless of whether the node already has children.

### Files to change
- `src/components/WorkItemTreePanel.tsx` — 2 small edits

