
## Goal

Sweep every `supabase.from(...).select(...)` in the codebase and convert any query that could realistically return more than 1,000 rows to use the paginated `loadAllRows` / `loadAllRowsIn` helpers (already used in `loadDataFromSupabase`). This eliminates the class of "silently truncated read → missing data" bug that recently caused new items to disappear.

## Approach

1. Extract the pagination helpers (`loadAllRows`, `loadAllRowsIn`) from `supabaseSync.ts` into a shared module `src/integrations/supabase/pagination.ts` so every caller can use them.
2. Classify each `.select()` call site into one of:
   - **Bounded** (single row / by id / small enum / count-only) → leave as-is, add a short `// bounded:` comment where non-obvious.
   - **Potentially unbounded** (org-scoped list, tree-scoped list, cross-org aggregation) → convert to paginated fetch.
3. Convert the risky sites (see list below), keeping return shapes identical so callers don't change.
4. Add a lightweight ESLint-style guard: a unit test in `src/test/` that greps the source for `.select(` calls on a denylist of tables (`work_items`, `work_item_backlog_ranks`, `work_item_board_ranks`, `work_item_hyperlinks`, `work_item_financials`, `work_item_snoozes`, `label_assignments`, `time_entries`, `change_log`, `backlogs`, `backlog_statuses`) and fails if any such call is not wrapped by the pagination helper. This prevents regressions.

## Sites to convert (unbounded / org-wide reads)

`src/store/supabaseSync.ts`
- L886, L908 — `work_item_backlog_ranks` full-org read
- L1024, L1044 — `work_item_board_ranks` full-org read
- L1116, L1136 — `work_item_hyperlinks` batched reads (already sliced but each `.in(...)` slice may still return >1k; verify slice size ≤ safe limit or paginate)
- L130–L158 — backlog_trees / backlogs / shares (org-scoped; paginate)

`src/store/labelsStore.ts`
- L139–L140 — `labels` and `label_assignments` across all `orgIds`

`src/store/financialsStore.ts`
- L82, L136 — `work_item_financials` org-wide

`src/store/snoozeStore.ts`
- L146 — `work_item_snoozes` org-wide

`src/store/timeEntryStore.ts`
- L75 — `time_entries` org-wide
- L155 — `time_entries` follow-up read

`src/store/changeLog.ts`
- L42 — `change_log` (already has explicit `.limit()` for UI; verify and leave, or paginate the "export all" path if one exists)

`src/store/targetsStore.ts`
- L55, L100 — `tree_financial_targets` org-wide

`src/store/backlogStatusesStore.ts`
- L135 — org-wide via inner join; paginate

`src/pages/TeamSettings.tsx`
- L187 (memberships), L300 (backlog_trees by org), L308/333/368/376/383 (delete-flow reads)

`src/pages/ManagerScreen.tsx`
- L115–L118 — cross-org lists for the manager dashboard (superuser view can exceed 1k as tenants grow)

`src/components/GithubIntegrationsCard.tsx`, `src/components/WhatsappIntegrationsCard.tsx`, `src/hooks/useYouTubeChannels.ts`
- Org-scoped integration lists; unlikely to exceed 1k but cheap to paginate for consistency.

## Sites intentionally left as-is (bounded)

- Anything filtered by primary key (`.eq('id', …).maybeSingle()` / `.single()`)
- `count: 'exact', head: true` queries
- `is_superuser` / profile lookups by user id
- Auth-related single-row reads

## Technical notes

- `loadAllRows(query, pageSize = 1000)` iterates using `.range(from, to)` until a short page is returned.
- For `.in('col', ids)` reads on large id sets, chunk `ids` into ≤500-item slices AND paginate within each slice.
- Preserve `.order(...)` on the query so ranges are deterministic across pages.
- No schema or business-logic changes; return shapes stay identical, so downstream store logic and tests remain untouched.

## Verification

- Existing `src/test/appStore.test.ts` E2E tests must still pass.
- New regression test: source-scan guard described above.
- Manual smoke: load an org with >1k `work_item_backlog_ranks` rows and confirm every item retains its list position after refresh.
