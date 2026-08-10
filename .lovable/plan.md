# Fix duplicated Gmail-imported items in "No" at least for the first time...

## What is actually going on

This is not caused by the recent rank/list-board fixes. The duplicates come from the Gmail link import.

Verified in the database (organization `agilefant`, backlog `"No" at least for the first time...`):

- 41 groups of work items share the exact same hyperlink URL and the same backlog assignment — 122 rows where 41 should exist (81 redundant copies). Some links exist 3x, a few 6x.
- The duplicated items have **no** matching row in the import dedup table (`gmail_imported_links`) for their URL at all.
- Their creation history shows pairs inserted 0.3 seconds apart within the same scheduled run (e.g. 2026-08-07 09:00:08).

Root cause: `supabase/functions/_shared/gmailImport.ts` creates the work items, ranks and hyperlinks **first** and writes the dedup rows **last**. The dedup table has a unique index on (organization, gmail message id, url). When one link in a batch conflicts (overlapping/re-run import, or the same link seen twice), the whole dedup insert fails and throws — the already-created work items stay, but nothing is recorded as imported. Every later run therefore re-imports the same links again, adding another copy each time.

## The fix

1. **Make the import claim-first and conflict-safe** (`gmailImport.ts`):
   - Pre-generate the work item id per link, then insert into `gmail_imported_links` first using an upsert that ignores duplicates and returns the rows that were actually inserted.
   - Create work items / list ranks / board ranks / hyperlinks only for the links this run successfully claimed. Everything else counts as skipped.
   - If item creation then fails, delete the dedup rows just claimed so the link can be retried cleanly.
   - Remove the batch-wide throw behaviour so a single conflicting link can never block or duplicate the rest.

2. **De-duplicate the existing data** (one-off data change, agilefant only):
   - Group items by (organization, hyperlink URL, backlog assignments), keep the oldest copy in each group, delete the rest — 81 rows.
   - Before deleting, verify no copy being removed has logged time, labels, financials, children, or team assignments; if any does, keep that copy instead of the oldest and report it rather than silently losing data.
   - Delete via the existing bulk path so the burnup history triggers stay suppressed.
   - Also record the surviving item's URL in `gmail_imported_links` where the record is missing, so the scheduler stops re-importing those links.

3. **Guard against recurrence**: add a test around the claim-first import covering (a) a link already imported, (b) a duplicate inside one batch, (c) a partial conflict batch — asserting no duplicate work items are created.

## Notes

Deletion of the 81 redundant rows is irreversible. I will run the grouping as a report first and show you the counts (and any group where the oldest copy is not the one being kept) before executing the delete.
