
# Root-cause investigation: sign-in blocked by PGRST002 + auth 504

## What we already know

Symptoms from this session:
- `POST /auth/v1/token?grant_type=password` and `refresh_token` returned **504 upstream request timeout** repeatedly, then eventually 200.
- Right after 200, `GET /rest/v1/profiles` and `POST /rest/v1/rpc/get_user_memberships` returned **503 PGRST002** "Could not query the database for the schema cache. Retrying." — this is PostgREST unable to (re)load its schema cache from Postgres.
- Postgres logs are full of `canceling statement due to statement timeout` and a couple of `FATAL: connection to client lost`.
- App UI is stuck at "Setting up your organization…" because `loadMemberships` fails with PGRST002 and never recovers.

What is NOT the cause:
- Data volume: DB is ~30 MB total, ~3k work items, only 11 idle / 2 active connections. Not saturated.
- App code paths: sign-in flow itself works — the failing calls happen against Supabase infra.

## Likely contributing causes to verify

1. **PostgREST schema-cache thrash from recent migrations.** In the last few turns we added/altered many public-schema objects (`work_item_board_ranks`, `backlog_statuses`, `work_item_history`, `work_item_chart_prefs`, plus columns on `time_entries`, `organization_settings`). Every DDL sends `NOTIFY pgrst`, which forces PostgREST to reload its full schema cache. If DDLs land back-to-back while a reload is running, PostgREST can get stuck in a retry loop and answer PGRST002 until it settles.
2. **Trigger amplification on hot paths.**
   - `trim_change_log` runs on every `change_log` INSERT and does `DELETE ... WHERE id NOT IN (SELECT id ... ORDER BY created_at DESC LIMIT 5000)` — that's an O(n) scan per row inserted. `pg_stat_statements` shows the change_log insert as the #1 query by total time (10 830 calls, 1.3 M ms total, max 6.9 s).
   - `snapshot_work_item_change` (added this turn for Burnups) inserts into `work_item_history` on every work_items INSERT/UPDATE/DELETE, roughly doubling write work and cache pressure on that table.
3. **Auth service upstream 504s.** GoTrue itself timed out on `/token` for ~4 minutes before recovering. This overlaps with the DB stress window and can be a symptom of the same shared-infra pressure or a transient Supabase-side incident.

## Investigation plan (no code changes yet)

Step 1 — Confirm current PostgREST state
- Poll `/rest/v1/` and `/auth/v1/health` from the sandbox to see whether PGRST002 is still being returned right now, or whether it has already cleared. If it's still failing after ~15 minutes with no ongoing DDL, that's PostgREST wedged and needs a reload from the dashboard.

Step 2 — Confirm trigger cost on hot writes
- `EXPLAIN (ANALYZE, BUFFERS)` a representative `change_log` INSERT to quantify `trim_change_log` cost.
- Check `pg_stat_user_tables` for `work_item_history` write volume vs `work_items` to confirm the 1:1 amplification.

Step 3 — Look for a DDL storm signature
- `select query, calls, total_exec_time from pg_stat_statements where query ilike 'alter %' or query ilike 'create %' order by total_exec_time desc limit 20;`
- Look at recent migrations in `supabase/migrations/` to see how many DDL statements shipped in the past day.

Step 4 — Report findings
Deliver a short root-cause writeup with:
- Which of the three causes above actually contributed (with evidence).
- What is fixable in the app (e.g. batching change_log inserts, moving history capture off the hot path, guarding loadMemberships against transient PGRST002).
- What has to be done in Supabase (dashboard restart, index tweaks, or a support ticket).

Only after you approve the findings will I propose a follow-up plan that actually changes code or schema.

## Technical details

Reads used, no writes:
- `pg_stat_activity`, `pg_stat_user_tables`, `pg_stat_statements` via `supabase--read_query`.
- `postgres_logs` via `supabase--analytics_query`.
- HTTP probes of `https://hwwjwkdbautfkhpxuord.supabase.co/rest/v1/` and `/auth/v1/health` from the sandbox.
- File reads of recent migrations under `supabase/migrations/`.

No migrations, no `INSERT/UPDATE/DELETE`, no edge function deploys, no dashboard restarts in this step.
