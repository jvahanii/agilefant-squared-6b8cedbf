-- Add a SECURITY DEFINER function so that any authenticated user can look up
-- an organization by its slug when initiating a backlog-tree share.
--
-- The organizations SELECT RLS policy only permits members to read their own
-- org rows, which means a user cannot find an external org by slug through
-- the normal client-side query — causing the "No organization with that slug"
-- error even when the slug is valid.
--
-- Using a SECURITY DEFINER function bypasses RLS in a controlled way: only the
-- slug is accepted as input, and only id + name are returned, so no sensitive
-- data is exposed beyond what the caller already needs to complete the share.

CREATE OR REPLACE FUNCTION public.find_org_by_slug(_slug text)
RETURNS TABLE(id uuid, name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name FROM organizations WHERE slug = _slug LIMIT 1;
$$;
