

## Problem

Two TypeScript build errors in `src/store/supabaseSync.ts` at lines 194 and 269. The `withSessionRetry` wrapper expects `operation` to return a `Promise<{ error: ... }>`, but `supabase.from('work_items').upsert(...)` returns a `PostgrestFilterBuilder` (a builder/thenable, not a standard Promise). This causes the build to fail, meaning **no work item saves actually execute** — the app compiles with errors and the upsert calls silently fail.

Backlog trees and backlogs work because their upsert functions don't use `withSessionRetry`.

## Fix

Append `.select()` (or `.then(r => r)`) to the upsert calls inside `withSessionRetry` callbacks to convert the `PostgrestFilterBuilder` into a proper `PostgrestResponse` (which is a standard Promise).

### Changes in `src/store/supabaseSync.ts`

**Line 194** — single work item upsert:
```typescript
const { error } = await withSessionRetry(() => supabase.from('work_items').upsert(row as any).select());
```

**Line 269** — bulk work items upsert:
```typescript
const { error } = await withSessionRetry(() => supabase.from('work_items').upsert(rows as any).select());
```

Both changes simply add `.select()` after `.upsert(...)`, which finalizes the query builder into a proper Promise that satisfies the `withSessionRetry` type signature.

