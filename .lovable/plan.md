## Plan

1. **Reproduce with evidence first**
   - Use the live preview with the injected logged-in session.
   - Add one item in list view and one in board view, refresh immediately, and capture:
     - whether the `work_items` row exists,
     - whether its rank rows exist,
     - whether the referenced tree/backlog exists,
     - whether the UI is showing cached-only data or fresh Supabase data.

2. **Fix stale-cache item creation**
   - The logs show `sanitizeData` dropping assignments because referenced tree/backlog IDs are missing after reload.
   - Update the cache/load flow so users cannot add items against stale cached trees/backlogs that are no longer present in Supabase.
   - When fresh data arrives, do not overwrite the cache/state with a server snapshot that drops newly-added local items unless the target tree/backlog is confirmed missing and the user is shown a save failure.

3. **Make add persistence truly atomic**
   - Persist the new work item, list rank, and board rank through one ordered save path instead of separate fire-and-forget calls.
   - Keep the local item in the pending outbox until all required rows are confirmed saved.
   - If any part fails, keep the item visible as pending and retry rather than letting refresh hide it.

4. **Stop Supabase auth-lock request storms**
   - The current runtime error shows concurrent Supabase auth/session access stealing the same lock, aborting downstream loads.
   - Add a shared session-ready/in-flight load guard so initial app data loads, target loads, and refresh retries do not stampede Supabase auth.
   - Retry non-critical store loads that fail with the lock/AbortError instead of treating them as final failures.

5. **Tighten reload reconciliation**
   - On reload, merge pending work items only after validating their tree/backlog against the latest Supabase data.
   - If a pending item’s target tree/backlog is absent from Supabase, surface a clear save error and remove the pending queue entry only after the user-visible state is consistent.

6. **Add regression coverage**
   - Add tests for:
     - list add followed by reload,
     - board add followed by reload,
     - cached stale tree/backlog add path,
     - pending outbox retained until work item + list rank + board rank all save,
     - auth-lock/duplicate-load guard behavior.

## Technical notes

- This likely is no longer only a board-rank issue.
- The current signals point to two root causes: stale cached tree/backlog data being used for adds, and Supabase auth-lock contention causing some refresh/load calls to abort.
- I do not expect a database migration unless reproduction proves an RLS/policy failure on insert.