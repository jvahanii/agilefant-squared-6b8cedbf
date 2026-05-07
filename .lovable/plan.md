## Diagnosis

- The Agilefant org has exactly **one** backup row in `organization_backups` (manual, 2026-04-21). The UI is correct — it shows everything that's there.
- `cron.job` is **empty**. The `daily-backup` edge function exists and is wired to accept service-role calls, but no `pg_cron` schedule was ever created to invoke it. That's why no automatic snapshots have been produced.
- Adjacent issue: `trim_organization_backups()` exists as a trigger function but is not attached to any trigger, so the "30-day retention" promise in the UI isn't enforced either.

## Plan

### 1. Schedule the daily backup via pg_cron
Create a cron schedule that POSTs to the `daily-backup` edge function once per day, authenticated with the service role key so the function's existing auth check passes.

- Enable `pg_cron` and `pg_net` extensions if not already on.
- Insert a `cron.schedule(...)` row that runs daily (e.g. `15 3 * * *` UTC) and calls
  `https://hwwjwkdbautfkhpxuord.supabase.co/functions/v1/daily-backup`
  with `Authorization: Bearer <service_role_key>`.
- Use the Supabase **insert tool** (not a migration) since the SQL contains the service role key and must not be replayed on remixes.

### 2. Attach the retention trigger
Add an `AFTER INSERT` trigger on `organization_backups` that runs `trim_organization_backups()`, so old (>30 days) snapshots actually get pruned. Done via migration.

### 3. (Optional) one-off manual run to confirm
After the cron is in place, invoke `daily-backup` once manually via `supabase--curl_edge_functions` to verify it produces a fresh row for Agilefant and any other orgs.

### 4. UI: nothing to change
The `BackupsCard` already fetches and renders every row for the active org with no limit. The reason "only one shows up" is that only one exists. No frontend change needed.

## Technical notes

- The cron SQL must be inserted (not migrated) because it embeds the project URL and service role key.
- Edge function `daily-backup` already accepts `Bearer <SUPABASE_SERVICE_ROLE_KEY>` and iterates all orgs calling `create_organization_backup(_kind => 'auto')`, so no function code changes are needed.
- The trigger creation is a normal schema change → migration.
