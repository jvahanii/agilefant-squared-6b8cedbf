

## Fix: Corrupted double-prefixed items can't be deleted

### Root Cause

The database contains work items (and potentially backlogs/trees) with double-prefixed IDs like `orgId::orgId::wi-574a73af`, created by an old `resetToMockData` that applied `scopeMockDataToOrganization` to already-prefixed data. When loading, `sanitizeData` strips these to `orgId::wi-574a73af`, so the store sees one item. But when deleting, only `orgId::wi-574a73af` is deleted from the DB — the double-prefixed row survives and reappears on reload.

### Fix

**1. `src/store/supabaseSync.ts` — Clean up malformed IDs on load**

In `loadFromSupabase`, after fetching all rows, detect and delete any rows with malformed (multi-segment) IDs before building the store state. A malformed ID has more than one `::` separator (e.g., `orgId::orgId::wi-x`).

```ts
// After fetching allItemRows, filter out and delete malformed ones
const malformedItemIds = allItemRows.filter(r => r.id.split('::').length > 2).map(r => r.id);
if (malformedItemIds.length > 0) {
  await supabase.from('work_items').delete().in('id', malformedItemIds);
}
const cleanItemRows = allItemRows.filter(r => r.id.split('::').length <= 2);
```

Same for backlogs and backlog_trees rows.

**2. `src/store/supabaseSync.ts` — Delete malformed variants alongside clean IDs**

In `deleteWorkItems`, also compute and delete the double-prefixed variant for each ID:

```ts
export async function deleteWorkItems(ids: string[]) {
  if (ids.length === 0) return;
  // Also delete any double-prefixed variants that may exist
  const allIds = new Set(ids);
  ids.forEach(id => {
    const parts = id.split('::');
    if (parts.length === 2) {
      allIds.add(`${parts[0]}::${id}`); // orgId::orgId::suffix
    }
  });
  const { error } = await supabase.from('work_items').delete().in('id', [...allIds]);
  if (error) console.error('deleteWorkItems:', error);
}
```

**3. Prevention** — Already handled by `ensureCleanId` which strips any ID to `orgId::rawSuffix`. No new corruption can occur. The load-time cleanup ensures any remaining legacy corruption is auto-repaired.

### Files to change
- `src/store/supabaseSync.ts` — auto-cleanup malformed IDs on load; delete double-prefixed variants on delete

