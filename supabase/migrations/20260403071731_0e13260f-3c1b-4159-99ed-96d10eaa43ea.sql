
-- Create hyperlinks table
CREATE TABLE public.work_item_hyperlinks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  work_item_id text NOT NULL,
  url text NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  rank integer NOT NULL DEFAULT 0,
  organization_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.work_item_hyperlinks ENABLE ROW LEVEL SECURITY;

-- RLS: members and shared tree users can read
CREATE POLICY "Org members and shared can read hyperlinks"
  ON public.work_item_hyperlinks FOR SELECT TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
  );

-- RLS: members can insert
CREATE POLICY "Org members can insert hyperlinks"
  ON public.work_item_hyperlinks FOR INSERT TO authenticated
  WITH CHECK (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
  );

-- RLS: members can update
CREATE POLICY "Org members can update hyperlinks"
  ON public.work_item_hyperlinks FOR UPDATE TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
  );

-- RLS: members can delete
CREATE POLICY "Org members can delete hyperlinks"
  ON public.work_item_hyperlinks FOR DELETE TO authenticated
  USING (
    is_member_of(auth.uid(), organization_id)
    OR is_superuser(auth.uid())
  );
