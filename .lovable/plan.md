## Root cause

The Burnups migration added a `FOR EACH ROW` trigger `trg_work_items_snapshot` on `public.work_items` that fires on **every** INSERT/UPDATE/DELETE and writes a row into `work_item_history`. On top of that, `work_item_history` was added to the `supabase_realtime` publication, so every write also produces a WAL/realtime broadcast.

Backlog create/delete is slow because it fans out into a lot of `work_items` writes:

- Deleting a backlog rewrites `backlog_assignments` (and often `parent_id`, `ranks`) on every item that was assigned to it — one history INSERT per item, per touched column-set.
- Creating a backlog itself is cheap, but the flows around it (moves, re-ranks, sanitize passes on load) update many `work_items` rows in sequence and each one now pays the trigger cost.
- The trigger fires even on updates that don't change any burnup-relevant field (e.g. `rank`, `respawn_*`, `description`), so we're writing history rows nobody will ever read.
- The realtime publication multiplies this: every history INSERT is also a WAL decode + broadcast to every subscribed client.

Combined with the existing `trim_change_log` trigger (already the #1 query by total time), this is what's pushing statement timeouts and the PGRST002 we saw earlier.

## What to change

Keep Burnups working, but make the trigger cheap and quiet:

1. **Only snapshot when a burnup-relevant field actually changed.** In `snapshot_work_item_change`, on `UPDATE` compare the fields we chart (`status`, `points`, `parent_id`, `backlog_assignments`, `title`) between `OLD` and `NEW` and `RETURN NEW` early if none of them changed. INSERT and DELETE still snapshot unconditionally. This alone eliminates the vast majority of history writes triggered by rank/board-rank/respawn/description edits.

2. **Skip snapshots during bulk structural operations.** Add a session-level guard (`SET LOCAL burnups.skip_history = 'on'`) that the trigger checks first and short-circuits on. Wrap the server-side bulk paths — `remove_tree_share_with_copy`, `restore_organization_backup`, `rename_work_items_org_prefix`, and any app-side "cascade delete backlog / move all items" flow — so their internal work_items churn doesn't generate thousands of history rows.

3. **Remove `work_item_history` from the realtime publication.** `ALTER PUBLICATION supabase_realtime DROP TABLE public.work_item_history;`. The Burnup dialog fetches history on open via `paginateSelect`; it does not need live push. Removing it kills the WAL-decode + broadcast cost per row.

4. **Add a covering index for the query the dialog actually runs.** The dialog filters `work_item_id IN (...)` ordered by `snapshot_at`. Replace `work_item_history_item_time_idx` with `(work_item_id, snapshot_at)` (already the shape) and confirm it's used; also add a partial index `WHERE existed = true` if plans show sequential scans. (Verify with EXPLAIN before adding — this step is conditional.)

5. **(Optional, follow-up) Batch history writes as statement-level, not row-level.** Convert the trigger to `AFTER ... FOR EACH STATEMENT` using transition tables (`REFERENCING NEW TABLE AS new_rows`) and do a single `INSERT ... SELECT` from the transition table. Bulk updates then produce one plan, one insert, instead of N per-row trigger invocations. This is the biggest structural win but is more invasive, so gate it behind (1)–(3) landing first.

## Expected impact

- Steps 1–3 are a single small migration and should immediately restore backlog create/delete to pre-Burnups latency for the common case (rank/description edits stop hitting history entirely, backlog deletion no longer produces N realtime broadcasts).
- Step 5 removes the remaining per-row overhead for genuine bulk status/points updates.
- No change to the Burnup UI or `chart_prefs` — the dialog keeps working exactly as today, it just sees fewer redundant rows.

## Verification

- Run `EXPLAIN (ANALYZE, BUFFERS)` on a representative "delete backlog with N items" update before and after.
- Check `pg_stat_user_tables` for `work_item_history` insert rate — should drop by an order of magnitude on typical editing sessions.
- Open a Burnup on an item that has real status changes and confirm the chart still renders the same series.
