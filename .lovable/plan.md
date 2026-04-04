
What I found

- The client is already wired for realtime:
  - `src/hooks/useRealtimeSync.ts` subscribes to `work_items`, `backlogs`, `backlog_trees`, and `work_item_hyperlinks`.
  - `src/pages/Index.tsx` and `src/components/BacklogTreePanel.tsx` separately subscribe to `backlog_tree_shares`.
- The database migrations do not match that setup yet:
  - I only found one migration adding `public.work_item_hyperlinks` to `supabase_realtime`.
  - I found no migration adding `public.work_items`, `public.backlogs`, or `public.backlog_trees` to the realtime publication.
  - I found no migration setting `REPLICA IDENTITY FULL` on any of those tables.

Assessment of Copilot’s suggestion

- The suggestion is correct for the four entity tables:
  - `work_items`
  - `backlogs`
  - `backlog_trees`
  - `work_item_hyperlinks`
- I would extend it slightly:
  - also verify/add `backlog_tree_shares` to the realtime publication, because the app subscribes to it in two places and I found no migration proving it is published.

Implementation plan

1. Create one database migration to align Supabase Realtime with the client subscriptions.
2. In that migration:
   - add missing subscribed tables to `supabase_realtime`
   - set `REPLICA IDENTITY FULL` on the entity tables used by the realtime store updates
   - verify/add `backlog_tree_shares` publication support as needed
3. Make the publication changes idempotent so the migration does not fail if a table is already in the publication.
4. Leave the existing client realtime code as-is unless testing still shows failures afterward, because the store handlers and subscriptions are already present.

Technical details

- Planned SQL shape:
  - safe `ALTER PUBLICATION supabase_realtime ADD TABLE ...` checks for:
    - `public.work_items`
    - `public.backlogs`
    - `public.backlog_trees`
    - `public.work_item_hyperlinks`
    - likely `public.backlog_tree_shares`
  - `ALTER TABLE ... REPLICA IDENTITY FULL` for:
    - `public.work_items`
    - `public.backlogs`
    - `public.backlog_trees`
    - `public.work_item_hyperlinks`
- Why this is needed:
  - publication membership is required for Supabase Realtime to emit changes at all
  - `REPLICA IDENTITY FULL` is important for reliable `UPDATE`/`DELETE` payloads, especially since the client uses `payload.old` for deletes
- I would not manually edit `src/integrations/supabase/types.ts`; it should stay generated from the database schema.

Validation after implementation

- Test in two tabs for:
  - create/update/delete a work item
  - create/update/delete a backlog
  - create/update/delete a backlog tree
  - add/edit/delete a hyperlink
  - add/remove a tree share and confirm both share-related reload listeners react
