## Goal
Persist the List/Board view choice per backlog in the database (shared across users), matching what we just did for board hidden columns.

## Changes

### 1. Database migration
Add to `public.backlogs`:
- `view_mode text NOT NULL DEFAULT 'list'` — either `'list'` or `'board'`.

No RLS changes needed (existing backlog policies cover it).

### 2. Types + store
- `src/types/models.ts`: add `viewMode?: 'list' | 'board'` to `Backlog`.
- `src/store/appStore.ts`: map `view_mode` in the backlog loader/mapper; add `setBacklogViewMode(backlogId, mode)` action (optimistic + DB write), mirroring `setBacklogHiddenStatusKeys`.
- `src/store/supabaseSync.ts`: include `view_mode` in the realtime CDC mapper and add `updateBacklogViewMode` writer.

### 3. UI
- `src/components/WorkItemTreePanel.tsx`: remove the `localStorage` read/write for the List/Board toggle. Read view mode from the selected backlog record; on toggle call `setBacklogViewMode`.

### 4. Cleanup
No data migration needed; stale localStorage entries are harmless.

## Technical notes
- Single column on `backlogs` keeps this simple and rides existing realtime, so switching view mode is reflected live for other viewers of the same backlog.
