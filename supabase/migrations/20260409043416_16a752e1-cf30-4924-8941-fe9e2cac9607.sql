
-- Create change_log table
CREATE TABLE public.change_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  user_email text,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  entity_name text,
  details text
);

-- Enable RLS
ALTER TABLE public.change_log ENABLE ROW LEVEL SECURITY;

-- Org members can read
CREATE POLICY "Org members can read change log"
ON public.change_log FOR SELECT TO authenticated
USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

-- Org members can insert
CREATE POLICY "Org members can insert change log"
ON public.change_log FOR INSERT TO authenticated
WITH CHECK (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

-- Index for fast org queries ordered by time
CREATE INDEX idx_change_log_org_created ON public.change_log (organization_id, created_at DESC);

-- Trigger to enforce max 5000 entries per org
CREATE OR REPLACE FUNCTION public.trim_change_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.change_log
  WHERE organization_id = NEW.organization_id
    AND id NOT IN (
      SELECT id FROM public.change_log
      WHERE organization_id = NEW.organization_id
      ORDER BY created_at DESC
      LIMIT 5000
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trim_change_log_after_insert
AFTER INSERT ON public.change_log
FOR EACH ROW
EXECUTE FUNCTION public.trim_change_log();
