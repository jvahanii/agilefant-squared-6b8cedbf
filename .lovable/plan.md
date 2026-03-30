

## Fix: Duplicate ranks when creating items

### Root Cause

Two sources of duplicate ranks:

1. **Work items**: Callers pass `item.childrenIds.length` or `rootWorkItems.length` as the rank for "append at end" operations (lines 564, 872, 892 in `WorkItemTreePanel.tsx`). If ranks have gaps or `childrenIds` is stale, this collides with existing ranks. The store's `addWorkItem` only shifts items with `rank >= finalRank`, so if the computed rank already exists but isn't the expected "end" position, duplicates occur.

2. **Backlogs**: `addBacklog` uses `siblings.length` as the rank (line 583 in `appStore.ts`), which has the same stale-length problem.

### Fix

**`src/store/appStore.ts`** — Make rank computation robust in the store itself:

1. **`addWorkItem`** (line 335-336): When `requestedRank` is undefined, compute `maxRank + 1` among siblings instead of defaulting to 0:
   ```ts
   let finalRank: number;
   if (requestedRank != null) {
     finalRank = requestedRank;
   } else {
     let maxRank = -1;
     Object.values(state.workItems).forEach((wi) => {
       if (wi.parentId === parentId && wi.backlogAssignments[treeId] === backlogId) {
         if (wi.rank > maxRank) maxRank = wi.rank;
       }
     });
     finalRank = maxRank + 1;
   }
   ```

2. **`addBacklog`** (line 583): Replace `siblings.length` with computed max rank:
   ```ts
   let maxRank = -1;
   Object.values(state.backlogs).forEach((bl) => {
     const isSibling = parentId ? bl.parentId === parentId : (!bl.parentId && bl.treeId === treeId);
     if (isSibling && bl.rank > maxRank) maxRank = bl.rank;
   });
   const newBacklog: Backlog = { id, name, parentId, childrenIds: [], treeId, rank: maxRank + 1 };
   ```

**`src/components/WorkItemTreePanel.tsx`** — Simplify callers to not pass rank for "append at end":

3. **Line 564**: Change `addWorkItem(title, workItemId, backlogId, treeId, item.childrenIds.length)` → `addWorkItem(title, workItemId, backlogId, treeId)` (let store compute)

4. **Line 872**: Change `addWorkItem(title, null, selectedBacklogId, selectedTreeId, item.rank + 1)` → keep as-is (this is "insert after", needs explicit rank)

5. **Line 892**: Change `addWorkItem(title, null, selectedBacklogId, selectedTreeId, rootWorkItems.length)` → `addWorkItem(title, null, selectedBacklogId, selectedTreeId)` (let store compute)

### Files to change
- `src/store/appStore.ts` — robust rank computation in `addWorkItem` and `addBacklog`
- `src/components/WorkItemTreePanel.tsx` — remove explicit "append" ranks, let store handle it

