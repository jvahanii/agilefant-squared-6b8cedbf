## What's happening

Items in this tree live under "Employed in a better job…" via the per-tree parent override map (`work_items.parent_id_overrides`) — their global `parent_id` is `null`. When you add a new item or hyperlink, Supabase realtime fires updates that flow through `applyRealtimeWorkItem` in `src/store/appStore.ts`. That handler rebuilds the local `WorkItem` from the row but **never reads `parent_id_overrides` and never preserves the existing `parentIds`**, so every realtime UPDATE silently strips the override map. Items then collapse to their global `parent_id` (null = root), which matches your screenshot.

The bug is self-reinforcing: once `parentIds` is `undefined` locally, the next save writes `parent_id_overrides: {}` back to the DB (see `supabaseSync.ts` lines 457 / 570 / 753), permanently losing the overrides server-side. That's why the items don't snap back after a refresh.

## Fix

1. **`src/store/appStore.ts` → `applyRealtimeWorkItem`**
   - Parse `row.parent_id_overrides` exactly like `supabaseSync.ts` does (object → `Record<string, string|null>`, otherwise `undefined`); fall back to the current `state.workItems[id]?.parentIds` if the field is absent from the payload.
   - Include `parentIds` on the rebuilt `WorkItem`.
   - When the override map changes, update `childrenIds` for both the old and new override parents (same logic as for the global `parentId` reparent block), so the tree view stays in sync without a reload.

2. **`src/store/supabaseSync.ts` (defensive)**
   - In the three upsert paths that write `parent_id_overrides: item.parentIds ?? {}`, only include the field when `item.parentIds !== undefined`. This stops a stale-local-state write from blanking the DB column. Existing intentional clears already pass an explicit `{}`/value, so behavior there is unchanged.

3. **One-off data repair**
   - Inspect the affected work items (`MWB Uuden duunin saaminen` tree) with `supabase--read_query` to see which children now have `parent_id = null` AND empty `parent_id_overrides`. If they should sit under "Employed in a better job…" in that tree, restore the override via `supabase--insert`. Confirm with the user before running the repair.

## Verification

- After the fix, edit any item in that tree (e.g. rename) and confirm via console / DB that `parent_id_overrides` is still populated and the tree shape is preserved.
- Add a hyperlink to a child and confirm no sibling jumps to root.
- `tsgo` clean; existing `appStore.test.ts` still passes.

No UI changes.
