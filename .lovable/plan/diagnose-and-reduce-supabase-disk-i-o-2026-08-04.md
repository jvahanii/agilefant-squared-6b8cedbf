# Diagnose and reduce Supabase disk I/O

## Verdict: it is not the burnups

`work_item_history` (the burnup table) holds **1,318 rows / 872 kB total**, with 3 sequential scans and 90 index scans in its whole lifetime. It is one of the smallest, least-touched tables in the database. It is not the cause.

## What the database statistics actually show

Measured from `pg_stat_user_tables` and `pg_stat_statements`:

| Table | Seq scans | Rows read via seq scans | Index on `organization_id`? |
| --- | --- | --- | --- |
| `memberships` | 22,352,590 | 44,233,613 | no |
| `change_log` | 10,655 | 43,344,607 | yes (org, created_at) |
| `work_items` | 13,427 | 10,411,005 | no |
| `work_item_backlog_ranks` | 3,087 | 8,829,698 | no |
| `backlog_tree_shares` | 344,520 | 4,106,005 | no |
| `backlogs` | 13,392 | 3,352,866 | no |
| `work_item_hyperlinks` | 5,546 | 1,188,620 | no |

Three causes, in order of impact:

1. **`memberships` is scanned 22 million times.** Every RLS policy on every table re-evaluates a membership lookup per row, and `memberships` has no index supporting those lookups. This single table accounts for the largest share of buffer reads in the database, and it multiplies with every other read the app performs.
2. **Whole-org table reads with no matching index.** The app's loader pulls entire org datasets (`work_items`, `work_item_backlog_ranks`, `backlogs`, `work_item_hyperlinks`, `backlog_statuses`) filtered by `organization_id`, but those tables have no `organization_id` index — so each load sequentially scans the whole table. `pg_stat_statements` shows the `work_items` org-filtered select alone at 1,237 calls / 470 ms mean / 582 s total, and `work_item_backlog_ranks` at 4,137 calls / 521 s total.
3. **Write amplification from realtime replica identity.** 13 tables are set to `REPLICA IDENTITY FULL`, including the hottest write targets (`work_item_backlog_ranks`: 89,186 updates; `work_items`: 73,352 updates). Full replica identity writes the complete old row image into WAL on every update — several times the WAL volume of the default identity, and WAL is disk I/O.

Two secondary contributors: `change_log` is read as an unbounded org-wide list (2,048 calls, 364 s total) even though the UI shows a page of recent entries; and the daily backup job writes ~5 MB of JSONB snapshots per day (33 orgs/day, 1,048 snapshots / 36 MB retained), the largest table in the database.

## Plan

### 1. Index the RLS hot path (biggest win)
Add indexes that let membership checks be index lookups instead of full scans — `memberships (user_id, organization_id)` and `memberships (organization_id)`. Then confirm the RLS helper functions are `STABLE` `SECURITY DEFINER` so Postgres can cache their result per statement instead of re-running per row.

### 2. Index the org-scoped loader reads
Add `organization_id` indexes on `work_items`, `work_item_backlog_ranks`, `backlogs`, `work_item_hyperlinks`, and `backlog_tree_shares (organization_id)`. These match the exact predicates the app's paginated loader issues, turning repeated full scans into index range scans.

### 3. Reduce replica identity to what realtime needs
Switch `REPLICA IDENTITY FULL` back to `DEFAULT` (primary key) on the high-update tables — `work_item_backlog_ranks`, `work_item_board_ranks`, `work_items` — keeping FULL only where the realtime handlers genuinely need old-row values. Before changing each table, verify against `src/hooks/useRealtimeSync.ts` that no handler depends on the `old` payload for it.

### 4. Bound the change-log read
Read `change_log` with an explicit recent-window limit (e.g. most recent N entries, or last 30 days) instead of the full org history, and add a retention cleanup so the table stops growing without bound.

### 5. Trim backup storage churn
Keep the daily snapshot but shorten retention (e.g. last 14 dailies plus weekly/monthly rollups) so the backup table stops accumulating ~5 MB/day of JSONB writes and deletes.

### 6. Verify
After each migration, re-check `pg_stat_user_tables` seq-scan counts and `pg_stat_statements` mean times for the same queries, and run `EXPLAIN (ANALYZE, BUFFERS)` on the org-filtered `work_items` and `memberships` lookups to confirm the new indexes are used.

## Technical notes

Steps 1–3 and the retention parts of 4–5 are database migrations (indexes, `ALTER TABLE ... REPLICA IDENTITY`, cleanup functions). Step 4's read change touches the change-log fetch in the app's store code. No burnup/history changes are needed.
