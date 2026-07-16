## Goal
Fix the refresh-time React crash (`Minified React error #185`) in both production and Lovable preview without regressing the newly working item persistence.

## Root cause to address
React error #185 is an infinite update loop. The likely trigger is the new reload/cache reconciliation path combined with refresh-side effects that repeatedly re-enter `loadFromSupabase` or repeatedly apply store updates while React is mounting after refresh.

## Plan
1. **Add a single-flight guard for app data loads**
   - Ensure `loadFromSupabase()` cannot run multiple overlapping times for the same organization during refresh.
   - Return the existing in-flight promise instead of starting a second load.
   - Prevent stale completion from an older org/load from overwriting current state.

2. **Harden retry-on-empty refresh logic**
   - Update the `App.tsx` and `Index.tsx` safety retry effects so they do not call `loadFromSupabase()` repeatedly on every render when `loadingProgress === -1` or cached state is empty.
   - Track the last retried org/load state with refs and only retry once per failure transition, resetting after a successful load or org change.

3. **Make cached refresh state updates idempotent**
   - Before applying cached/fresh state snapshots, avoid setting large store objects when the same org/load snapshot is already applied.
   - Keep pending work item merge behavior intact, but prevent background refresh from repeatedly writing identical state in a way that cascades through realtime/subscription effects.

4. **Reduce refresh-time effect churn**
   - Review the reload-triggered effects in `Index.tsx` and `useRealtimeSync` and keep subscriptions tied only to stable keys (`activeOrgId`, serialized tree IDs).
   - Avoid any state update from those effects unless the new value actually differs from the current value.

5. **Add regression tests**
   - Add tests for duplicate `loadFromSupabase()` calls during initial refresh.
   - Add tests that retry guards do not loop when the store is empty or `loadingProgress === -1`.
   - Keep the existing item persistence tests passing.

6. **Verify with browser refresh**
   - Run the app in a fresh authenticated browser session where possible.
   - Refresh the main route and confirm the error boundary no longer appears.
   - Confirm newly added items still show after refresh.