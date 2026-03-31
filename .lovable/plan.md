

## Fix: Export/Reset mock data cycle broken by double-prefixing

### Root Cause

The reset flow applies ID prefixing **twice**:

1. `resetToMockData` calls `sanitizeData(mockData, orgId)` → produces `orgId::wi-xxx`
2. Then passes result to `resetOrgData` which calls `scopeMockDataToOrganization` → produces `orgId::orgId::wi-xxx`

The inserts fail or create corrupted rows. Only the deletes succeed, so the user sees everything wiped.

Additionally, **export** outputs store data with org-prefixed IDs. If saved to `mockData.ts`, those IDs would get re-prefixed on import — another source of corruption.

### Fix

**1. Make mock data org-agnostic** — Store mock data with raw IDs only (no org prefix):

**`src/store/mockData.ts`** — Strip the `227ff1d1-36df-4f46-b97e-483ada92ccfb::` prefix from all IDs so the file contains only raw IDs like `wi-d86155ba`, `bl-5ae79cc4`, `bt-e767d87e`. Update all cross-references (parentId, treeId, backlogAssignments keys/values, rootBacklogIds, childrenIds) accordingly.

**2. Fix `resetToMockData`** — Remove the redundant `sanitizeData` call:

**`src/store/appStore.ts`** (line 867-879): Pass raw mock data directly to `resetOrgData`, which already calls `scopeMockDataToOrganization` to add the org prefix. Remove the `sanitizeData` call that was adding a prefix before scoping:

```ts
resetToMockData: async () => {
  const orgId = get().organizationId;
  if (!orgId) return;
  set({ isLoading: true });
  try {
    const mockData = generateMockData();
    await resetOrgData(orgId, mockData);  // scoping happens inside
    await get().loadFromSupabase();
    internalLog({ action: "System Reset", entityType: "data" });
  } catch (err) {
    set({ isLoading: false });
  }
},
```

**3. Fix export to strip org prefix** — So exported data can be saved directly to `mockData.ts`:

**`src/components/AppLayout.tsx`** (line ~496): Strip the org prefix from all IDs before serializing, producing org-agnostic data that matches the new `mockData.ts` format:

```ts
onClick={() => {
  const { workItems, backlogs, backlogTrees, organizationId } = useAppStore.getState();
  const strip = (id: string) => id.split('::').pop()!;
  // Transform all entities to raw IDs
  const rawItems = Object.fromEntries(Object.values(workItems).map(wi => {
    const rawId = strip(wi.id);
    return [rawId, {
      ...wi, id: rawId,
      parentId: wi.parentId ? strip(wi.parentId) : null,
      childrenIds: wi.childrenIds.map(strip),
      backlogAssignments: Object.fromEntries(
        Object.entries(wi.backlogAssignments).map(([t, b]) => [strip(t), strip(b)])
      ),
    }];
  }));
  // Same for backlogs and trees...
  const code = `// Auto-exported mock data\nexport const mockData = ${JSON.stringify({ workItems: rawItems, backlogs: rawBacklogs, backlogTrees: rawTrees }, null, 2)};\n`;
  navigator.clipboard.writeText(code);
};
```

### Files to change

- `src/store/mockData.ts` — strip org prefix from all IDs
- `src/store/appStore.ts` — remove `sanitizeData` from `resetToMockData`
- `src/components/AppLayout.tsx` — strip org prefix in export

