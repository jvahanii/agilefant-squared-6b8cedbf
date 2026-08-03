-- ─── gmail_connections ────────────────────────────────────────────────────
CREATE TABLE public.gmail_connections (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  connected_email TEXT,
  connection_key_encrypted TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT (id, user_id, connected_email, created_at, updated_at) ON public.gmail_connections TO authenticated;
GRANT DELETE ON public.gmail_connections TO authenticated;
GRANT ALL ON public.gmail_connections TO service_role;

ALTER TABLE public.gmail_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own gmail connection"
  ON public.gmail_connections FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can delete their own gmail connection"
  ON public.gmail_connections FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ─── gmail_import_queries ─────────────────────────────────────────────────
CREATE TABLE public.gmail_import_queries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT,
  query TEXT NOT NULL,
  tree_id TEXT NOT NULL,
  backlog_id TEXT NOT NULL,
  schedule_enabled BOOLEAN NOT NULL DEFAULT false,
  frequency TEXT NOT NULL DEFAULT 'daily' CHECK (frequency IN ('hourly', 'daily')),
  last_run_at TIMESTAMPTZ,
  last_run_status TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX gmail_import_queries_org_idx ON public.gmail_import_queries (organization_id);
CREATE INDEX gmail_import_queries_sched_idx ON public.gmail_import_queries (schedule_enabled) WHERE schedule_enabled;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gmail_import_queries TO authenticated;
GRANT ALL ON public.gmail_import_queries TO service_role;

ALTER TABLE public.gmail_import_queries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view gmail import queries"
  ON public.gmail_import_queries FOR SELECT TO authenticated
  USING (public.is_member_of(auth.uid(), organization_id));

CREATE POLICY "Org members can create their own gmail import queries"
  ON public.gmail_import_queries FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_member_of(auth.uid(), organization_id));

CREATE POLICY "Owners of a gmail import query can update it"
  ON public.gmail_import_queries FOR UPDATE TO authenticated
  USING (
    public.is_member_of(auth.uid(), organization_id)
    AND (
      user_id = auth.uid()
      OR public.has_org_role(auth.uid(), organization_id, 'owner'::app_role)
      OR public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
    )
  )
  WITH CHECK (public.is_member_of(auth.uid(), organization_id));

CREATE POLICY "Owners of a gmail import query can delete it"
  ON public.gmail_import_queries FOR DELETE TO authenticated
  USING (
    public.is_member_of(auth.uid(), organization_id)
    AND (
      user_id = auth.uid()
      OR public.has_org_role(auth.uid(), organization_id, 'owner'::app_role)
      OR public.has_org_role(auth.uid(), organization_id, 'admin'::app_role)
    )
  );

-- ─── gmail_imported_links ─────────────────────────────────────────────────
CREATE TABLE public.gmail_imported_links (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  query_id UUID REFERENCES public.gmail_import_queries(id) ON DELETE SET NULL,
  gmail_message_id TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  work_item_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, gmail_message_id, normalized_url)
);

CREATE INDEX gmail_imported_links_org_idx ON public.gmail_imported_links (organization_id);

GRANT SELECT, INSERT, DELETE ON public.gmail_imported_links TO authenticated;
GRANT ALL ON public.gmail_imported_links TO service_role;

ALTER TABLE public.gmail_imported_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view imported gmail links"
  ON public.gmail_imported_links FOR SELECT TO authenticated
  USING (public.is_member_of(auth.uid(), organization_id));

CREATE POLICY "Org members can record imported gmail links"
  ON public.gmail_imported_links FOR INSERT TO authenticated
  WITH CHECK (public.is_member_of(auth.uid(), organization_id));

CREATE POLICY "Org members can clear imported gmail links"
  ON public.gmail_imported_links FOR DELETE TO authenticated
  USING (public.is_member_of(auth.uid(), organization_id));

-- ─── updated_at triggers ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_gmail_connections_updated_at
  BEFORE UPDATE ON public.gmail_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_gmail_import_queries_updated_at
  BEFORE UPDATE ON public.gmail_import_queries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── hourly scheduled import job ──────────────────────────────────────────
DO $$
BEGIN
  PERFORM cron.unschedule('gmail-scheduled-import');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'gmail-scheduled-import',
  '7 * * * *',
  $job$
  SELECT net.http_post(
    url := 'https://hwwjwkdbautfkhpxuord.supabase.co/functions/v1/gmail-scheduled-import',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1
      )
    ),
    body := '{}'::jsonb
  );
  $job$
);