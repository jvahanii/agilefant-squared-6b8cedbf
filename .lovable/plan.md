## Goal

Make the "Loading…" screen disappear noticeably faster on app start and org switch, without changing behavior.

## Findings

Three concrete bottlenecks in the current loading path:

1. **Duplicate full load on every org switch.** `App.tsx` subscribes to `useOrgStore` and calls `appStore.loadFromSupabase()` whenever `activeOrgId` changes. `Index.tsx` *also* calls `loadData()` in a `useEffect` on the same `activeOrgId`. Both fire on first mount, so the entire dataset is fetched twice in parallel — doubling DB load and often doubling perceived wait time.

2. **Serialized Supabase queries in `loadFromSupabase`** (`src/store/supabaseSync.ts`):
   - `auth.getSession()` → `shares` query → `[ownTrees, sharedTrees]` → `[backlogs, ownItems]` → `incomingShared items` → `outgoingShared items` → `loadWorkItemBacklogRanks`.
   - Several of these are independent and can run together:
     - `shares`, own trees, own work items, own backlogs (by `organization_id`), and the change log can all start immediately in parallel.
     - Hyperlinks + change log are loaded *after* the main load completes; they can start in the same parallel batch.

3. **Full-screen "Loading…" blocker.** `Index.tsx` renders only a spinner until `isLoading` is false. The app chrome (header, sidebars) could mount immediately with skeletons for trees/items, making the app feel responsive within a few hundred ms even if data is still streaming.

## Plan

### Step 1 — Remove the duplicate load
Pick one owner for "load data when active org changes". Keep the `useOrgStore.subscribe` block in `App.tsx` (it runs before child effects, avoiding the GitHub-target flash noted in the existing comment) and **delete** the redundant `loadData()` call from the `activeOrgId` effect in `src/pages/Index.tsx`. Keep the rest of that effect (teams, settings, time entries) since those stores are not pre-loaded by the subscribe.

### Step 2 — Parallelize independent queries in `loadFromSupabase`
Refactor `src/store/supabaseSync.ts` to issue independent queries in one `Promise.all`:

- `shares`, own `backlog_trees`, own `work_items`, own `backlogs` (filter by `organization_id` instead of `tree_id`) — all fire immediately.
- After that batch resolves, fire shared-trees + incoming/outgoing partner work-items + ranks in a second `Promise.all`.

Also lift `loadHyperlinksForWorkItems` and `loadChangeLog` out of `appStore.loadFromSupabase` and run them inside the same overall `Promise.all` as the main load (they only need the org id and the resolved work-item id list, so chain them as a second wave).

### Step 3 — Render the shell during load
In `src/pages/Index.tsx`, mount `<AppLayout />` immediately and pass `isLoading` down so individual panels show lightweight `<Skeleton />` placeholders instead of the full-screen spinner. Keep the existing full-screen spinner only for the very first paint when nothing is in memory yet (e.g. when `organizationId` is not yet set).

### Step 4 — Verify
- Manually: open the app, watch network tab → confirm only one wave of `work_items`/`backlogs` fetches per org switch, and that the parallel queries overlap.
- Run `bunx vitest run` to make sure existing store tests still pass.
- Sanity-check the Bells & Whistles page still loads correctly.

## Technical details

- The `backlogs` query currently uses `.in('tree_id', allTreeIds)` which forces serialization on the trees query. Switching to `.eq('organization_id', organizationId)` returns the same own-org backlogs and removes the dependency; shared-tree backlogs are already implicitly handled because shared trees are loaded separately and their backlogs are fetched by tree id in the second wave (already the case).
- The `subscribe` in `App.tsx` already calls `setOrganizationId` + `loadFromSupabase` before the route mounts, which is exactly the head-start the existing comment relies on — Step 1 just removes the duplicate, not the head-start.
- Skeletons can reuse `@/components/ui/skeleton` which is already in the project.

## Out of scope

- No DB schema changes.
- No new indexes (can be a follow-up if profiling shows a slow query after these wins).
- No changes to realtime sync or auth flow.
