## Problem

Clicking a search result jumps to the right backlog but doesn't expand the work‑item branch, so the target item stays hidden inside a collapsed parent.

## Root cause

In `src/components/WorkItemTreePanel.tsx`, the `onNavigate` handler on search‑result rows (around lines 2727‑2742) walks ancestors with `wi.parentId` — the **global** parent. Work items support per‑tree parent overrides via `wi.parentIds[treeId]` (see `getEffectiveParentId` in `src/types/models.ts`). When an item lives under a different parent in a specific tree (e.g. "Supercell several positions" sits under "Viikkosuunnitelma → Ke 17" only in that tree's hierarchy), the global `parentId` chain doesn't include those ancestors, so none of them get added to `expandedWorkItems` and the row stays collapsed out of view.

The label-filter results list (around line 2768+) uses the same `SearchResultItem` and has the same bug — fix both call sites.

## Fix

In both navigate handlers, use the per‑tree effective parent when walking the ancestor chain:

```ts
import { getEffectiveParentId } from "@/types/models";
...
let wi = state.workItems[item.id];
while (wi) {
  const pid = getEffectiveParentId(wi, treeId);
  if (!pid) break;
  expandedWorkItems.add(pid);
  wi = state.workItems[pid];
}
```

No other behaviour changes — backlog ancestor expansion, selection, scroll, and snooze wake‑up all stay as they are.

## Files

- `src/components/WorkItemTreePanel.tsx` — update the work‑item ancestor walk in the search-results `onNavigate` and in the label-filter-results `onNavigate`; add `getEffectiveParentId` import if not already present.
