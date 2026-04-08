-- RPC function: delete auth users who no longer belong to any organization.
-- Called after an organization is deleted so that members who were exclusively
-- in that org (and therefore have no remaining memberships) are also removed.
-- Only superusers may invoke this function.

CREATE OR REPLACE FUNCTION public.cleanup_orphaned_users(p_user_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
BEGIN
  IF NOT is_superuser(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  FOREACH v_user_id IN ARRAY p_user_ids
  LOOP
    -- Only delete users who have no memberships in any organization
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships WHERE user_id = v_user_id
    ) THEN
      DELETE FROM auth.users WHERE id = v_user_id;
    END IF;
  END LOOP;
END;
$$;
