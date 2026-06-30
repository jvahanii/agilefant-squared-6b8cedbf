Root cause: GitHub Supabase Preview still fails because the remote migration ledger and the repository migration folder are not aligned.

Current mismatch I found:

```text
Remote has, but local repo does not:
- 20260630152703   boards attempt
- 20260630201434   boards revert as recorded remotely

Local repo has, but remote does not:
- 20260630201435_ce55f08b-e878-406b-a15a-cdc511728722.sql
```

Why this happens:
- The failed boards work left migration history entries in `supabase_migrations.schema_migrations`.
- The revert migration exists locally with timestamp `20260630201435`, but the remote ledger recorded it as `20260630201434`.
- Supabase Preview compares remote migration versions to local filenames, so even though the schema itself was reverted, the migration history still fails validation.

Plan to fix:
1. Confirm the final live schema has no boards artifacts: no `boards`, `board_columns`, `board_card_ranks`, and no `organization_settings.boards_enabled`.
2. Remove the board-related versions from the remote migration ledger:
   - `20260630152703`
   - `20260630201434`
3. Remove the local board-revert migration file `20260630201435_ce55f08b-e878-406b-a15a-cdc511728722.sql`, because it only exists to undo a feature we are removing from history.
4. Re-check local migration versions against the remote ledger and verify there are no differences.
5. Smoke-check the app boots after the schema/history cleanup.

Technical detail: this does not change application data or re-create boards. It only aligns Supabase's migration bookkeeping with the repository after the boards schema was already dropped.