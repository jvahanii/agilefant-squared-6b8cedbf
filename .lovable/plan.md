# Make deadlines a per-tree switch, like points

## Why

Deadlines are today an organization-wide switch only (Bells & Whistles → Deadlines). The "JARNO" tree lives in an organization where that switch is off, so the mobile item sheet hides the Deadline row and the desktop menu hides "Set deadline…". Points already have a per-tree switch (`points_enabled` on `backlog_trees`, defaulting to the organization's setting); deadlines should work the same way.

## What changes

1. **Database**: add a `deadlines_enabled` boolean column to `backlog_trees` (nullable; null means "inherit the organization's setting", matching how `points_enabled` behaves).
2. **Visibility helper**: replace `useDeadlinesEnabled()` (org-only, in `src/lib/workItemDeadline.ts`) with a tree-aware version modeled on `src/lib/pointsVisibility.ts`: a tree shows deadlines when its own switch is on, or when it is unset and the organization's switch is on.
3. **Call sites**: everywhere deadlines are shown or offered now resolves the tree being viewed instead of only the organization:
   - item rows and the item context menu in `WorkItemTreePanel.tsx` (deadline chip, "Set deadline…", deadline sort modes)
   - the mobile item attributes sheet (`MobileAttributesSheet.tsx` Deadline row)
   - `TimelineView.tsx`
   - `listSortStore.ts` / `listSort.ts` deadline sort modes
   - `SavedSearchPicker.tsx` (import preview deadline display)
4. **Tree settings UI**: a "Deadlines" on/off control per tree, next to the existing per-tree points control, shown only when the organization has deadlines on.
5. **Tests**: extend the deadline tests for the inheritance rule (org off + tree on → shown; org on + tree off → hidden; tree unset → follows org).

## Technical notes

- Migration: `ALTER TABLE public.backlog_trees ADD COLUMN deadlines_enabled boolean;` — no new table, so no GRANTs needed.
- `src/lib/pointsVisibility.ts` is the template for the inheritance logic.
- Existing data is unaffected: with the column null everywhere, every tree keeps following the organization's switch, so nothing changes until someone flips a tree's switch.
- After the migration, `src/integrations/supabase/types.ts` regenerates; the tree type gains `deadlines_enabled`.
