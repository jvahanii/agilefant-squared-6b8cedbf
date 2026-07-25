## Plan: Speed up bulk work-item writes for Burnups

Ship both optimizations together in a single migration. No app code changes.

### 1. Skip snapshots inside cascade-delete paths (RPC-side bypass)

The app already batches deletes at the DB level, but the row-level trigger still fires for each row. Add `SET LOCAL burnups.skip_history = 'on'` to the SECURITY DEFINER functions that do bulk `work_items` churn so the existing session guard in `snapshot_work_item_change` short-circuits:

- `remove_tree_share_with_copy`
- `restore_organization_backup` (overwrite branch DELETEs many items)
- `rename_work_items_org_prefix`

For client-driven bulk deletes (the 20-item case), add a new tiny RPC `bulk_delete_work_items(_ids text[])` that sets the guard, verifies membership, and issues a single `DELETE FROM work_items WHERE id = ANY(_ids)`. The app already calls a delete flow per item today; switching that call site to the RPC gives us the guard in one place without touching every deletion path. (One small app change: `deleteWorkItem`/bulk deletion in `appStore.ts` routes multi-id deletes through the RPC.)

### 2. Convert the trigger to statement-level with transition tables

Replace `trg_work_items_snapshot` (row-level) with three statement-level triggers using `REFERENCING NEW TABLE` / `OLD TABLE`:

- `AFTER INSERT ... REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT` → one `INSERT ... SELECT` into `work_item_history` with `event='insert'`.
- `AFTER UPDATE ... REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT` → join on id, insert only rows where a burnup-relevant field changed (`status`, `points`, `parent_id`, `title`, `backlog_assignments`).
- `AFTER DELETE ... REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT` → one `INSERT ... SELECT` with `event='delete'`.

All three check `current_setting('burnups.skip_history', true) = 'on'` first and return early. This collapses N per-row trigger invocations into 1 plan + 1 insert per statement, which is the biggest structural win for any bulk operation (delete, rank recompute, status batch-update).

### 3. Verification

- `EXPLAIN (ANALYZE, BUFFERS)` on `DELETE FROM work_items WHERE id = ANY($1)` with 20 ids before/after — expect the trigger cost to drop from ~20× per-row invocations to 1 statement-level invocation.
- Check `pg_stat_user_functions` for `snapshot_work_item_change` — call count should collapse.
- Open a Burnup chart on an item with real status history and confirm the series is unchanged.
- Confirm `restore_organization_backup` overwrite mode no longer stalls on large orgs.

### Technical details

- Statement-level triggers with transition tables require Postgres 10+ (Supabase is fine).
- The new bypass GUC is already declared implicitly via `SET LOCAL` — no `ALTER DATABASE` needed.
- `work_item_history` remains out of the realtime publication (already done in the previous pass).
- Only app change: route bulk work-item deletions through the new `bulk_delete_work_items` RPC. Single-item deletes can keep going through the existing path — they already pay negligible trigger cost after step 2.
