
-- RPC function: hard-delete a user account.
-- Only superusers may call this. Superusers cannot delete themselves or other superusers.
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only superusers may call this function
  IF NOT is_superuser(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied: only superusers can delete users';
  END IF;

  -- Cannot delete self
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Cannot delete your own account via this function';
  END IF;

  -- Cannot delete other superusers
  IF is_superuser(p_user_id) THEN
    RAISE EXCEPTION 'Cannot delete another superuser account';
  END IF;

  -- Remove all memberships for this user
  DELETE FROM public.memberships WHERE user_id = p_user_id;

  -- Remove profile
  DELETE FROM public.profiles WHERE id = p_user_id;

  -- Remove auth user (requires SECURITY DEFINER)
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;
