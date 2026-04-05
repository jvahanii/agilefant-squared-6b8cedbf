
-- Create teams table
CREATE TABLE public.teams (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- RLS policies for teams
CREATE POLICY "Org members can read teams" ON public.teams
  FOR SELECT TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

CREATE POLICY "Admins can insert teams" ON public.teams
  FOR INSERT TO authenticated
  WITH CHECK (
    has_org_role(auth.uid(), organization_id, 'owner') 
    OR has_org_role(auth.uid(), organization_id, 'admin') 
    OR is_superuser(auth.uid())
  );

CREATE POLICY "Admins can update teams" ON public.teams
  FOR UPDATE TO authenticated
  USING (
    has_org_role(auth.uid(), organization_id, 'owner') 
    OR has_org_role(auth.uid(), organization_id, 'admin') 
    OR is_superuser(auth.uid())
  );

CREATE POLICY "Admins can delete teams" ON public.teams
  FOR DELETE TO authenticated
  USING (
    has_org_role(auth.uid(), organization_id, 'owner') 
    OR has_org_role(auth.uid(), organization_id, 'admin') 
    OR is_superuser(auth.uid())
  );

-- Create team_members junction table
CREATE TABLE public.team_members (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id)
);

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can read team members" ON public.team_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t 
      WHERE t.id = team_id 
      AND (is_member_of(auth.uid(), t.organization_id) OR is_superuser(auth.uid()))
    )
  );

CREATE POLICY "Admins can insert team members" ON public.team_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.teams t 
      WHERE t.id = team_id 
      AND (
        has_org_role(auth.uid(), t.organization_id, 'owner')
        OR has_org_role(auth.uid(), t.organization_id, 'admin')
        OR is_superuser(auth.uid())
      )
    )
  );

CREATE POLICY "Admins can delete team members" ON public.team_members
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t 
      WHERE t.id = team_id 
      AND (
        has_org_role(auth.uid(), t.organization_id, 'owner')
        OR has_org_role(auth.uid(), t.organization_id, 'admin')
        OR is_superuser(auth.uid())
      )
    )
  );

-- Create work_item_team_assignments junction table
CREATE TABLE public.work_item_team_assignments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_item_id text NOT NULL,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (work_item_id, team_id)
);

ALTER TABLE public.work_item_team_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members and shared can read assignments" ON public.work_item_team_assignments
  FOR SELECT TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id) 
    OR is_superuser(auth.uid()) 
    OR is_work_item_accessible(auth.uid(), work_item_id)
  );

CREATE POLICY "Org members can insert assignments" ON public.work_item_team_assignments
  FOR INSERT TO authenticated
  WITH CHECK (
    is_member_of(auth.uid(), organization_id) 
    OR is_superuser(auth.uid())
  );

CREATE POLICY "Org members can delete assignments" ON public.work_item_team_assignments
  FOR DELETE TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id) 
    OR is_superuser(auth.uid())
  );
