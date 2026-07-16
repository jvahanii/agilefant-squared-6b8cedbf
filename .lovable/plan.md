## Plan

1. **Reproduce and confirm the exact failure path**
   - In build mode, use the preview to add one item in list view and one in board view, refresh, and inspect whether the item is missing from Supabase, missing from the local store, or hidden by UI filtering.
   - Check network/console during the save so we catch any failed `work_items`, `work_item_backlog_ranks`, or `work_item_board_ranks` write.

2. **Make item creation refresh-safe**
   - Extend the existing local retry/outbox pattern beyond rank rows so a new work item’s full payload is saved to localStorage before the async Supabase write starts.
   - On app load, flush pending work-item creates/updates before loading fresh data, and merge still-pending local items into the displayed state so a refresh cannot make a newly-added item disappear.

3. **Keep the local cache consistent after adds**
   - Update or invalidate the `cached_app_data_*` entry when adding items, instead of letting a fresh browser refresh render a stale 2-minute cache that does not include the new item.
   - Ensure background refresh never overwrites visible state with older cached/server data while a local add is still pending.

4. **Tighten rank persistence**
   - Keep list rank and board rank writes ordered after the `work_items` write succeeds.
   - Add board-rank persistence to bulk/list add paths consistently, and queue board-rank retries the same way list ranks are queued.

5. **Add regression tests**
   - Cover list add, board add, immediate reload/pending-outbox merge, and cache refresh behavior so new items remain visible after refresh.

## Technical notes

- The database currently shows recent work-item rows and rank rows, so this appears more like a reload/cache/outbox/UI reconciliation issue than a basic RLS insert failure.
- I do not expect a database migration unless the reproduction reveals a policy or schema issue.