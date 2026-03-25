
-- 1. Create app_role enum
CREATE TYPE public.app_role AS ENUM ('owner', 'admin', 'member');

-- 2. Create organizations table
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Create memberships table
CREATE TABLE public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id)
);

-- 4. Create profiles table for user info
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  avatar_url text,
  is_superuser boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. Add organization_id to existing data tables
ALTER TABLE public.backlog_trees ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.backlogs ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.work_items ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

-- 6. Security definer functions for RLS

-- Check if user is a member of an organization
CREATE OR REPLACE FUNCTION public.is_member_of(_user_id uuid, _org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships WHERE user_id = _user_id AND organization_id = _org_id
  )
$$;

-- Check if user is superuser
CREATE OR REPLACE FUNCTION public.is_superuser(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = _user_id AND is_superuser = true
  )
$$;

-- Check if user has a specific role in an org
CREATE OR REPLACE FUNCTION public.has_org_role(_user_id uuid, _org_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships WHERE user_id = _user_id AND organization_id = _org_id AND role = _role
  )
$$;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7. RLS policies for profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT TO authenticated USING (id = auth.uid() OR public.is_superuser(auth.uid()));

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

CREATE POLICY "System can insert profiles" ON public.profiles
  FOR INSERT WITH CHECK (true);

-- 8. RLS policies for organizations
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read their orgs" ON public.organizations
  FOR SELECT TO authenticated USING (
    public.is_member_of(auth.uid(), id) OR public.is_superuser(auth.uid())
  );

CREATE POLICY "Authenticated users can create orgs" ON public.organizations
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admins can update orgs" ON public.organizations
  FOR UPDATE TO authenticated USING (
    public.has_org_role(auth.uid(), id, 'owner') OR public.has_org_role(auth.uid(), id, 'admin') OR public.is_superuser(auth.uid())
  );

CREATE POLICY "Owners can delete orgs" ON public.organizations
  FOR DELETE TO authenticated USING (
    public.has_org_role(auth.uid(), id, 'owner') OR public.is_superuser(auth.uid())
  );

-- 9. RLS policies for memberships
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can read org memberships" ON public.memberships
  FOR SELECT TO authenticated USING (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );

CREATE POLICY "Admins can manage memberships" ON public.memberships
  FOR INSERT TO authenticated WITH CHECK (
    public.has_org_role(auth.uid(), organization_id, 'owner')
    OR public.has_org_role(auth.uid(), organization_id, 'admin')
    OR public.is_superuser(auth.uid())
    OR user_id = auth.uid() -- allow self-join when creating org
  );

CREATE POLICY "Admins can update memberships" ON public.memberships
  FOR UPDATE TO authenticated USING (
    public.has_org_role(auth.uid(), organization_id, 'owner') OR public.is_superuser(auth.uid())
  );

CREATE POLICY "Admins can delete memberships" ON public.memberships
  FOR DELETE TO authenticated USING (
    public.has_org_role(auth.uid(), organization_id, 'owner')
    OR public.is_superuser(auth.uid())
    OR user_id = auth.uid() -- users can leave
  );

-- 10. Drop old public RLS policies on data tables and replace with org-scoped ones

-- backlog_trees
DROP POLICY IF EXISTS "Public read access" ON public.backlog_trees;
DROP POLICY IF EXISTS "Public insert access" ON public.backlog_trees;
DROP POLICY IF EXISTS "Public update access" ON public.backlog_trees;
DROP POLICY IF EXISTS "Public delete access" ON public.backlog_trees;

CREATE POLICY "Org members can read" ON public.backlog_trees
  FOR SELECT TO authenticated USING (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );
CREATE POLICY "Org members can insert" ON public.backlog_trees
  FOR INSERT TO authenticated WITH CHECK (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );
CREATE POLICY "Org members can update" ON public.backlog_trees
  FOR UPDATE TO authenticated USING (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );
CREATE POLICY "Org members can delete" ON public.backlog_trees
  FOR DELETE TO authenticated USING (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );

-- backlogs
DROP POLICY IF EXISTS "Public read access" ON public.backlogs;
DROP POLICY IF EXISTS "Public insert access" ON public.backlogs;
DROP POLICY IF EXISTS "Public update access" ON public.backlogs;
DROP POLICY IF EXISTS "Public delete access" ON public.backlogs;

CREATE POLICY "Org members can read" ON public.backlogs
  FOR SELECT TO authenticated USING (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );
CREATE POLICY "Org members can insert" ON public.backlogs
  FOR INSERT TO authenticated WITH CHECK (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );
CREATE POLICY "Org members can update" ON public.backlogs
  FOR UPDATE TO authenticated USING (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );
CREATE POLICY "Org members can delete" ON public.backlogs
  FOR DELETE TO authenticated USING (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );

-- work_items
DROP POLICY IF EXISTS "Public read access" ON public.work_items;
DROP POLICY IF EXISTS "Public insert access" ON public.work_items;
DROP POLICY IF EXISTS "Public update access" ON public.work_items;
DROP POLICY IF EXISTS "Public delete access" ON public.work_items;

CREATE POLICY "Org members can read" ON public.work_items
  FOR SELECT TO authenticated USING (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );
CREATE POLICY "Org members can insert" ON public.work_items
  FOR INSERT TO authenticated WITH CHECK (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );
CREATE POLICY "Org members can update" ON public.work_items
  FOR UPDATE TO authenticated USING (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );
CREATE POLICY "Org members can delete" ON public.work_items
  FOR DELETE TO authenticated USING (
    public.is_member_of(auth.uid(), organization_id) OR public.is_superuser(auth.uid())
  );

-- 11. Function to read all memberships for profile display (avoids recursion)
CREATE OR REPLACE FUNCTION public.get_user_memberships(_user_id uuid)
RETURNS TABLE(organization_id uuid, organization_name text, organization_slug text, role app_role)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.organization_id, o.name, o.slug, m.role
  FROM public.memberships m
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.user_id = _user_id
$$;

-- 12. Allow profiles to be read by org members (for team settings)
CREATE POLICY "Org members can read member profiles" ON public.profiles
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.memberships m1
      JOIN public.memberships m2 ON m1.organization_id = m2.organization_id
      WHERE m1.user_id = auth.uid() AND m2.user_id = profiles.id
    )
    OR public.is_superuser(auth.uid())
    OR id = auth.uid()
  );
