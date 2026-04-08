-- Patch cleanup_orphaned_users to never delete superuser accounts.
-- A superuser must not be removed even if they have no remaining memberships.

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
    -- Never delete superuser accounts
    IF is_superuser(v_user_id) THEN
      CONTINUE;
    END IF;

    -- Only delete users who have no memberships in any organization
    IF NOT EXISTS (
      SELECT 1 FROM public.memberships WHERE user_id = v_user_id
    ) THEN
      DELETE FROM auth.users WHERE id = v_user_id;
    END IF;
  END LOOP;
END;
$$;
