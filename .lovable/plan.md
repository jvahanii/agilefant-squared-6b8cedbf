

## Paste Work Items from Clipboard

**What**: Add a "Paste Items" button to the backlog panel header that reads plaintext from the clipboard (one item per line) and bulk-creates work items in the currently selected backlog.

### Approach

1. **Add a "Paste Items" button** next to existing backlog action buttons in `WorkItemTreePanel.tsx`
   - Uses `navigator.clipboard.readText()` to read clipboard content
   - Splits by newline, trims, filters empty lines
   - Calls `addWorkItem` for each line sequentially, with incrementing ranks starting after the last existing item

2. **Rank calculation**: Find the max rank among existing root items in the selected backlog, then assign `maxRank + 1`, `maxRank + 2`, etc. to avoid rank-shifting overhead on every insert.

3. **Alternatively, add a bulk `addWorkItems` action** to `appStore.ts` that creates all items in one state update and one `upsertWorkItems` DB call — much more efficient for large pastes. This avoids N separate state updates and N separate DB calls.

### Recommended: Bulk approach

- **`appStore.ts`**: Add `bulkAddWorkItems(titles: string[], parentId, backlogId, treeId)` that creates all items in a single `set()` call and single `upsertWorkItems()` DB call
- **`WorkItemTreePanel.tsx`**: Add a clipboard icon button in the backlog header bar. On click, read clipboard, parse lines, call `bulkAddWorkItems`
- Show a toast with count of items created

### Files to change
- `src/store/appStore.ts` — add `bulkAddWorkItems` action
- `src/components/WorkItemTreePanel.tsx` — add paste button in backlog header

