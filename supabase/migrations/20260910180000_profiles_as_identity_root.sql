-- Make public.profiles the identity table, instead of auth.users.
--
-- Six public tables pointed their user columns at auth.users(id). That was
-- correct while Supabase Auth was the only way in, but it means a Clerk-native
-- user cannot exist at all: no profile, no membership, no team membership, no
-- chart preferences. Clerk sign-up dead-ends before onboarding can run.
--
-- current_user_id() already treats profiles.id as *the* user id, and every RLS
-- policy is keyed on it, so this repoints the constraints at what the app
-- already considers authoritative. profiles.id keeps its existing values, so
-- every row satisfies the new constraints unchanged -- verified beforehand:
-- zero orphans in all five child tables, and zero profiles without an auth user.
--
-- profiles.id itself becomes standalone: existing rows keep the uuid they got
-- from auth.users, while Clerk-native profiles get a fresh gen_random_uuid().
--
-- Note this drops the ON DELETE CASCADE from auth.users to profiles. Deleting a
-- user through the Supabase dashboard will no longer remove their profile.
-- cleanup_orphaned_users() is unaffected: it deletes from both tables
-- explicitly rather than relying on the cascade.

ALTER TABLE public.profiles DROP CONSTRAINT profiles_id_fkey;

ALTER TABLE public.memberships
  DROP CONSTRAINT memberships_user_id_fkey,
  ADD CONSTRAINT memberships_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.team_members
  DROP CONSTRAINT team_members_user_id_fkey,
  ADD CONSTRAINT team_members_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.work_item_chart_prefs
  DROP CONSTRAINT work_item_chart_prefs_user_id_fkey,
  ADD CONSTRAINT work_item_chart_prefs_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.gmail_connections
  DROP CONSTRAINT gmail_connections_user_id_fkey,
  ADD CONSTRAINT gmail_connections_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE public.gmail_import_queries
  DROP CONSTRAINT gmail_import_queries_user_id_fkey,
  ADD CONSTRAINT gmail_import_queries_user_id_fkey
    FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
