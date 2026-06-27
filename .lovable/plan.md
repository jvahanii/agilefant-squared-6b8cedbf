## Plan

1. **Confirm the exact mismatch**
   - Compare the migration versions currently in the connected Supabase ledger with the migration files in the repository.
   - Check whether GitHub is running against the same connected Supabase project or a separate preview/test database.

2. **Fix the repository-side issue that can cause this error**
   - Inspect `supabase/migrations` for duplicate migration versions.
   - There is a duplicate local version: `20260403054300` appears in two files. Supabase migration history is version-based, so this can confuse preview checks even if the live ledger has that version marked applied.
   - Rename one of the duplicate migration files to a unique timestamp if it has not already been applied as a distinct remote version.

3. **Repair the remote migration ledger only if needed**
   - If the remote ledger still has versions that do not exist locally, remove those ledger-only versions.
   - If local versions are missing from the remote ledger, mark them as applied.
   - Keep this limited to `supabase_migrations.schema_migrations`; do not alter application tables or data.

4. **Verify after the change**
   - Re-query the ledger and local filenames to confirm they match exactly by migration version.
   - Run a read-only app/database smoke check to confirm the connected app can still boot against the schema.
   - Ask you to re-run the GitHub Supabase Preview check; if it still fails, use the new failure text to identify whether GitHub is using a separate preview database environment that I cannot directly repair from the connected Supabase project.