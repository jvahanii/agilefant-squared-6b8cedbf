
## Diagnosis

I queried the reported backlog directly ("MWB Uuden duunin saaminen", 182 items). Findings:

- **Ranks are corrupted at the database level.** Within a single (backlog, parent) sibling group there are many duplicate ranks — e.g. under parent "NOT THIS TIME": rank 20 has 3 items, and ranks 0, 1, 3, 7, 12, 13, 16, 17, 23, 24, 26, 27, 28, 29 each have 2 items. Similar duplication exists under other parents in this backlog. Because the client sorts by `(rank, id)` with `rank` as the primary key, duplicated ranks give the sort no stable answer, so items visibly swap places between refreshes / tab switches. New items also collide because their assigned rank is picked from a store that already contains duplicates.
- **Parents are intact in the DB.** Every effective parent (global `parent_id` merged with the per-tree `parent_id_overrides` for this tree) resolves to a real work item — no ghosts. So "parents disappear" is almost certainly a *client-side* symptom, most likely a realtime update path that strips `parent_id_overrides` after a sibling edit. I want to re-verify the sync code paths as part of the fix, not blindly patch again.

So: yes, part of this is a database problem (the duplicate ranks), and part is a client sync problem worth re-auditing.

## Fix

### 1. One-shot database cleanse (migration)

Re-rank every `(backlog_id, effective_parent_id)` sibling group across the whole DB so ranks are consecutive `0..N-1`, ordered by current rank then id as a deterministic tie-break. Run it as one migration that:
- Reads current ranks from `work_item_backlog_ranks`.
- Groups by `(backlog_id, effective_parent_in_that_tree)` where `effective_parent_in_that_tree = COALESCE(parent_id_overrides -> tree_id, parent_id)`.
- Rewrites `work_item_backlog_ranks.rank` with dense integer ranks per group.
- Wrapped in a transaction so all-or-nothing.

### 2. Prevent rank collisions on write

In `src/store/appStore.ts` `addWorkItem` and the reorder paths:
- When inserting at `insertRank`, compute the shift set from a fresh selector snapshot and always shift *strictly*: any sibling with `rank >= insertRank` gets `rank + 1`. Today one add path uses `>= insertRank`, another path (line 522) uses `>= insertRank` but the write is not queued behind the previous add, so two rapid adds can both pick the same rank.
- Enqueue the sibling shift + new-item rank into the existing `enqueueWorkItemMutation` FIFO so back-to-back adds cannot interleave.
- Add a client-side guard: after computing new ranks for a group, assert they are unique; if not, densify the group before writing.

### 3. Client auto-heal on load

In `src/store/dataIntegrity.ts`'s "Duplicate Rank" cleanser: it already densifies per `(tree, backlog, parent)`. Wire the auto-integrity check (`useAutoIntegrityCheck`) to also run this specific cleanser on load for the active org (silent, no toast unless something changed) so users who already have corrupted data see it self-heal on next visit.

### 4. Re-audit parent-override sync (no code change unless a bug is confirmed)

Re-read `supabaseSync.ts` `rowToWorkItem`, the realtime CDC handler in `appStore.ts`, and every place that upserts a `work_items` row. Confirm that `parent_id_overrides` is:
- Always read into the store (never dropped to `undefined`).
- Never sent as `null`/missing in partial updates that would clobber other trees' overrides.
- Preserved when a realtime `UPDATE` payload arrives with the column absent.

If a real regression is found, patch it; otherwise report back that this path is clean and the "parent disappears" symptom should be resolved by the rank cleanse alone (sort instability was making items appear at unexpected positions, which is easy to mistake for "moved to root").

## Out of scope

- Switching to fractional / lexorank-style ranks. Considered but rejected for this pass — the current integer scheme works if writes are serialized and unique. Can revisit if collisions recur.
- Any UI changes.

## Technical notes

- Migration touches `public.work_item_backlog_ranks` only; no schema change, just data.
- Rank writes already funnel through `enqueueWorkItemMutation` for updates; the gap is on the *initial* insert of a new work item where the sibling shift and the new row race.
- `useAutoIntegrityCheck` currently gates on manual trigger; we'll add a "silent duplicate-rank pass" that runs once per session per org.
