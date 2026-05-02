
-- 1. Defense-in-depth: revoke direct column-level write access on profiles.is_superuser
--    The trigger check_profile_update already blocks changes, but column-level revocation
--    provides an additional barrier independent of RLS/trigger logic.
REVOKE UPDATE (is_superuser) ON public.profiles FROM authenticated, anon, public;
REVOKE INSERT (is_superuser) ON public.profiles FROM authenticated, anon, public;

-- 2. Tighten realtime.messages topic authorization to prevent substring/pattern
--    bypass where a crafted topic like '<otherOrg>-<myOrg>' would satisfy the
--    previous '%-' || org_id LIKE pattern.
--    New rule: topic must follow the structured form 'org-<orgId>' or
--    'org-<orgId>-<suffix>'. This requires an explicit prefix that cannot
--    be forged from another UUID.
DROP POLICY IF EXISTS "Authenticated users can listen to their org channels" ON realtime.messages;

CREATE POLICY "Authenticated users can listen to their org channels"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.user_id = auth.uid()
      AND (
        (SELECT realtime.topic()) = ('org-' || m.organization_id::text)
        OR (SELECT realtime.topic()) LIKE ('org-' || m.organization_id::text || '-%')
      )
  )
  OR public.is_superuser(auth.uid())
);
