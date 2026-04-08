
CREATE OR REPLACE FUNCTION public.cleanup_orphaned_users(p_user_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
BEGIN
  -- Only superusers may invoke this function
  IF NOT is_superuser(auth.uid()) THEN
    -- Also allow if the caller is one of the users being cleaned up (self-delete scenario)
    IF NOT (auth.uid() = ANY(p_user_ids)) THEN
      RAISE EXCEPTION 'Permission denied: only superusers can clean up orphaned users';
    END IF;
  END IF;

  FOREACH _uid IN ARRAY p_user_ids
  LOOP
    -- Skip superusers
    IF is_superuser(_uid) THEN
      CONTINUE;
    END IF;

    -- Skip users who still have memberships
    IF EXISTS (SELECT 1 FROM public.memberships WHERE user_id = _uid) THEN
      CONTINUE;
    END IF;

    -- Delete profile
    DELETE FROM public.profiles WHERE id = _uid;

    -- Delete auth user (requires SECURITY DEFINER)
    DELETE FROM auth.users WHERE id = _uid;
  END LOOP;
END;
$$;
