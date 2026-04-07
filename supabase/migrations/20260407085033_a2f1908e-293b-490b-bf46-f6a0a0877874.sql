-- Restrict Realtime channel subscriptions to org members only.
-- The channel name follows the pattern "entity-realtime-{org_id}".
-- postgres_changes already respects source-table RLS, but this prevents
-- unauthenticated topic enumeration for Broadcast/Presence.

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can listen to their org channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Allow if the channel topic contains an org id the user belongs to,
  -- or if it's a backlog_tree_shares channel (also org-scoped).
  EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND (select realtime.topic()) LIKE '%' || m.organization_id::text || '%'
  )
  OR public.is_superuser(auth.uid())
);