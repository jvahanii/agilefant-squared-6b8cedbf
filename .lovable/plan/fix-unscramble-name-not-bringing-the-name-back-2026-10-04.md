# Fix "Unscramble name…" not bringing the name back

## What we know
- 5 items are locked, all by you, in one organization.
- When you unscramble, the database hands back the real name. The app ignores it. It only clears the lock marker and waits for the live update to put the new title on screen.
- If that live update gets skipped (your own change on the same device, or mobile pausing in the background), the item keeps showing the scrambled words. The lock icon is gone, so it looks like nothing happened.

This cause is likely but not confirmed yet. Step 1 confirms it.

## Steps
1. Reproduce: unscramble one locked item, then check two things. Does the database row hold the real title? Is the lock row gone? That tells us whether the problem is in saving or in showing.
2. Fix showing: when an item is unscrambled, write the returned real name straight into the item on screen and into the offline cache. Don't wait for the live update.
3. Fix silent outcomes: if no item qualifies, or the database refuses, show a clear message instead of just closing the dialog.
4. Check that the mobile attributes sheet uses the same path. It already calls the same dialog, so the fix covers both.

## Technical details
- `WorkItemTreePanel.tsx` `runUnscramble`: take `data` from the `unscramble_work_item` RPC (returns text) and apply it via the store's local title patch (no DB write, since the RPC already wrote it). Also patch the cached work items.
- When `ids` is empty, return `{ error: "Nothing to unscramble here" }`.
- Add a test: unscramble updates the title locally even when no realtime event arrives.
