## Goal
Persist board hidden columns per backlog in the database (shared across all users viewing that backlog), replacing the current `localStorage` implementation.

## Changes

### 1. Database migration
Add a new column to `public.backlogs`:
- `board_hidden_status_keys text[] NOT NULL DEFAULT '{}'` — list of status keys hidden on the board view for this backlog.

Existing RLS policies on `backlogs` already cover reads and updates by org members / tree-share partners, so no policy changes are needed.

### 2. App store (`src/store/appStore.ts`)
- Extend the in-memory `Backlog` type / mapper to carry `boardHiddenStatusKeys: string[]`.
- Load it in `loadFromSupabase` and in the realtime CDC mapper in `src/store/supabaseSync.ts`.
- Add a `setBoardHiddenStatusKeys(backlogId, keys)` action that optimistically updates the store and writes to Supabase.

### 3. BoardView (`src/components/BoardView.tsx`)
- Remove the `localStorage` read/write (`board-hidden-cols:${backlogId}` key at line 177).
- Read `hiddenStatusKeys` from the backlog record via a selector.
- Hide/restore handlers call the new store action instead of `setState` + `localStorage`.

### 4. Cleanup
- One-time: no data migration required; existing localStorage values are ignored (safe to leave in the browser — they'll simply be unused).

## Technical notes
- Using a column on `backlogs` (not a separate table) keeps this a single write per toggle and rides existing realtime for `backlogs`, so other viewers see hides/unhides live.
- Array of text keys mirrors how `tree_statuses.key` is already referenced elsewhere.
