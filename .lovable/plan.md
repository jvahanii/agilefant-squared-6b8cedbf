# Per-Tree Points Toggle

Allow each backlog tree to opt out of points, even when points are enabled at the organization level. Default: a tree inherits the org setting (enabled if org is enabled).

## Rules

- Org points OFF → points hidden everywhere (unchanged).
- Org points ON, tree not overridden → points shown for that tree (default).
- Org points ON, tree overridden to disabled → points hidden for that tree's backlogs, boards and items.
- We only expose "disable for this tree" (matching the request). If the org later turns points off, the tree-level override becomes moot.

## Data model

Add `points_enabled BOOLEAN NULL` to `backlog_trees` (null = inherit). Extend the `BacklogTree` type with `pointsEnabled?: boolean | null` and wire it through the tree sync/serialization paths in `supabaseSync.ts` and `appStore.ts`.

## Effective-points helper

Add `isPointsEnabledForTree(orgId, tree)` next to the existing `isPointsEnabled` in `orgSettingsStore.ts` (or a small `src/lib/pointsVisibility.ts`) returning `orgPointsEnabled && tree.pointsEnabled !== false`.

## UI wiring

Replace the current `pointsVisible = orgSettings.pointsEnabled` reads with the tree-aware helper in:

- `src/components/BoardView.tsx` (already has `treeId`)
- `src/components/WorkItemTreePanel.tsx` (has active tree in scope)
- `src/components/BacklogTreePanel.tsx` (iterate per tree row; each backlog knows its `treeId`)
- `src/components/MobileAttributesSheet.tsx` (accept `treeId` from callers; both usages already know it)

`BellsAndWhistlesSection` keeps the org-level switch as-is.

## Toggle placement

Add a "Points" switch to the backlog-tree context menu (same menu as Burnups / statuses gear in `BacklogTreePanel.tsx`), shown only when org points are enabled and the user has manage rights. Persists via a new `setTreePointsEnabled(treeId, enabled | null)` action on `appStore` that updates state and upserts to Supabase.

## Migration

Single migration adding the nullable column with no backfill (null = inherit = current behavior).

## Out of scope

- No change to how points values are stored on items; only visibility flips.
- No per-backlog (sub-backlog) override — request is per tree.
