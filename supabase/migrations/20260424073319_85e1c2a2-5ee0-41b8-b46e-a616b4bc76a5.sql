-- YouTube channels (per-organization)
CREATE TABLE public.youtube_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  rank integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_youtube_channels_org ON public.youtube_channels(organization_id);

CREATE TABLE public.youtube_video_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  rank integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_youtube_video_links_org ON public.youtube_video_links(organization_id);

CREATE TABLE public.youtube_search_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  keywords text NOT NULL,
  search_order text NOT NULL DEFAULT 'relevance',
  enabled boolean NOT NULL DEFAULT true,
  rank integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT youtube_search_channels_order_chk CHECK (search_order IN ('relevance','date','viewCount'))
);
CREATE INDEX idx_youtube_search_channels_org ON public.youtube_search_channels(organization_id);

-- updated_at triggers
CREATE OR REPLACE FUNCTION public.touch_youtube_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_youtube_channels_touch BEFORE UPDATE ON public.youtube_channels
FOR EACH ROW EXECUTE FUNCTION public.touch_youtube_updated_at();
CREATE TRIGGER trg_youtube_video_links_touch BEFORE UPDATE ON public.youtube_video_links
FOR EACH ROW EXECUTE FUNCTION public.touch_youtube_updated_at();
CREATE TRIGGER trg_youtube_search_channels_touch BEFORE UPDATE ON public.youtube_search_channels
FOR EACH ROW EXECUTE FUNCTION public.touch_youtube_updated_at();

-- Enable RLS
ALTER TABLE public.youtube_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_video_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.youtube_search_channels ENABLE ROW LEVEL SECURITY;

-- Policies: read by org members or superuser; write by org admins/owners or superuser
-- youtube_channels
CREATE POLICY "Members can read youtube channels"
  ON public.youtube_channels FOR SELECT TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));
CREATE POLICY "Admins can insert youtube channels"
  ON public.youtube_channels FOR INSERT TO authenticated
  WITH CHECK (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
              OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
              OR is_superuser(auth.uid()));
CREATE POLICY "Admins can update youtube channels"
  ON public.youtube_channels FOR UPDATE TO authenticated
  USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
         OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
         OR is_superuser(auth.uid()));
CREATE POLICY "Admins can delete youtube channels"
  ON public.youtube_channels FOR DELETE TO authenticated
  USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
         OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
         OR is_superuser(auth.uid()));

-- youtube_video_links
CREATE POLICY "Members can read youtube video links"
  ON public.youtube_video_links FOR SELECT TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));
CREATE POLICY "Admins can insert youtube video links"
  ON public.youtube_video_links FOR INSERT TO authenticated
  WITH CHECK (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
              OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
              OR is_superuser(auth.uid()));
CREATE POLICY "Admins can update youtube video links"
  ON public.youtube_video_links FOR UPDATE TO authenticated
  USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
         OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
         OR is_superuser(auth.uid()));
CREATE POLICY "Admins can delete youtube video links"
  ON public.youtube_video_links FOR DELETE TO authenticated
  USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
         OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
         OR is_superuser(auth.uid()));

-- youtube_search_channels
CREATE POLICY "Members can read youtube search channels"
  ON public.youtube_search_channels FOR SELECT TO authenticated
  USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));
CREATE POLICY "Admins can insert youtube search channels"
  ON public.youtube_search_channels FOR INSERT TO authenticated
  WITH CHECK (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
              OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
              OR is_superuser(auth.uid()));
CREATE POLICY "Admins can update youtube search channels"
  ON public.youtube_search_channels FOR UPDATE TO authenticated
  USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
         OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
         OR is_superuser(auth.uid()));
CREATE POLICY "Admins can delete youtube search channels"
  ON public.youtube_search_channels FOR DELETE TO authenticated
  USING (has_org_role(auth.uid(), organization_id, 'owner'::app_role)
         OR has_org_role(auth.uid(), organization_id, 'admin'::app_role)
         OR is_superuser(auth.uid()));