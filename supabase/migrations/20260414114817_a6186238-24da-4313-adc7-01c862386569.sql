-- Drop the old weak LIKE-based policy
DROP POLICY IF EXISTS "Authenticated users can listen to their org channels" ON realtime.messages;

-- Create a stricter policy that checks the org ID appears as a proper
-- segment in the topic (delimited by the channel naming convention).
-- Channel patterns: "entity-realtime-{orgId}", "entity-realtime-{orgId}-partner-{partnerId}",
-- "share-data-reload-{orgId}"
-- We check that the topic contains the org UUID preceded by a hyphen and
-- followed by end-of-string or another hyphen, ensuring exact segment matching.
CREATE POLICY "Authenticated users can listen to their org channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND (
        -- Topic ends with the org ID (main channel pattern)
        (select realtime.topic()) LIKE '%-' || m.organization_id::text
        -- Or org ID appears as a middle segment (partner channel pattern)
        OR (select realtime.topic()) LIKE '%-' || m.organization_id::text || '-%'
      )
  )
  OR public.is_superuser(auth.uid())
);