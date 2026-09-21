# Choose the status per imported item in the job search picker

## What changes

In the saved-search picker dialog (the one that lists job ads found in Gmail), each ticked row gets a small status dropdown. Whatever is chosen there becomes the new work item's status. Rows left alone keep **Not started**, exactly as today.

- The dropdown lists the statuses of the backlog the item will land in (its own set, or inherited from a parent backlog — the same statuses the board shows as columns). Every backlog always has at least Not started and Done, so the list is never empty.
- The dropdown only appears on rows that are ticked for import; unticked rows stay as they are.
- It works the same for "Import selected" and "Import & auto-place". With auto-place, an item lands in the dated or undated list — if the chosen status doesn't exist in that list's set, the item falls back to Not started rather than failing.
- Scheduled (automatic) imports are untouched: they keep creating items as Not started.
- The picker is shared between job-ad and plain-link imports, so plain-link imports get the same dropdown — no extra cost, one consistent dialog.

## Technical details

- `src/components/SavedSearchPicker.tsx`: new `statusByKey` state (`rowKey → status key`), a per-row `<select>` rendered when `selected[key]` is true, options from `getEffectiveStatuses(backlogId)` (already in `src/store/backlogStatusesStore.ts`). For jobs mode the options come from the search's target backlog; auto-place rows use the same dropdown, with server-side fallback per actual destination. `pickedLinks()` attaches the chosen status to each link (omitted when `not_started`, keeping the payload unchanged for the default).
- `src/lib/gmailPreview.ts`: `PreviewLink` gains optional `status?: string`.
- `supabase/functions/_shared/extract.ts`: `ExtractedLink` gains optional `status?: string`.
- `supabase/functions/_shared/gmailImport.ts`: `importLinksAsWorkItems` validates each link's `status` against the target backlog's effective status keys (queried from `backlog_statuses`, walking up `backlogs.parent_id`, falling back to the five defaults) and inserts it instead of the hardcoded `'not_started'`; unknown/missing keys fall back to `'not_started'`. Scheduled import passes no status, so its behaviour is unchanged.
- Deploy the changed shared function code (it is used by `gmail-connector`).

## Verification

- Typecheck (`tsgo`) plus the existing Gmail import test suites (`gmailImport*`, `savedSearchPicker`).
- New test: links carrying a status are created with it; an unknown status falls back to `not_started`.
