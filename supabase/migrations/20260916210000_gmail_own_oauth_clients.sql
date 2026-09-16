-- Require organizations to connect Gmail through their own Google OAuth client.
--
-- Until now every Gmail connection went through one shared connector gateway,
-- on one account's key and under one Google app's approval. That was fine while
-- only Agilefant used it. Opened to everyone, it would put every organization's
-- mail traffic on that one key, and every organization's users under an app
-- approval that was never sought for them.
--
-- So an organization now brings its own Google OAuth client, and connections
-- made in it go to Google directly. The shared connector stays available only
-- to organizations explicitly listed — today, Agilefant.

-- 1. Who may use the shared connector.
--
-- A table of its own, with no policies, rather than a column in
-- organization_settings. Those settings are writable by each organization's
-- owners and admins, and a flag there would let any of them switch their
-- organization back onto the shared connector — undoing the whole requirement
-- with one update.
CREATE TABLE IF NOT EXISTS public.gmail_shared_connector_organizations (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.gmail_shared_connector_organizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gmail_shared_connector_organizations FROM anon, authenticated;
COMMENT ON TABLE public.gmail_shared_connector_organizations IS
  'Organizations allowed to connect Gmail through the shared connector gateway. Every other organization must use its own Google OAuth client. Service role only.';

INSERT INTO public.gmail_shared_connector_organizations (organization_id)
SELECT o.id FROM public.organizations o
 WHERE o.id = '227ff1d1-36df-4f46-b97e-483ada92ccfb'  -- Agilefant
ON CONFLICT (organization_id) DO NOTHING;

-- 2. Each organization's own Google OAuth client.
--
-- The secret is encrypted by the edge function before it arrives here, with the
-- same key that protects connection tokens. RLS is on with no policies: no
-- client role can read even the client ID from the table. The app learns what it
-- needs — whether one is configured, and the ID — through the edge function.
CREATE TABLE IF NOT EXISTS public.organization_google_oauth_clients (
  organization_id          uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id                text NOT NULL,
  client_secret_encrypted  text NOT NULL,
  updated_by               uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organization_google_oauth_clients ENABLE ROW LEVEL SECURITY;
-- RLS with no policies already hides every row. The privilege goes too, so a
-- policy added carelessly later still could not expose a client secret.
REVOKE ALL ON public.organization_google_oauth_clients FROM anon, authenticated;
COMMENT ON TABLE public.organization_google_oauth_clients IS
  'An organization''s own Google OAuth client for Gmail. Secret encrypted by the gmail-connector function. Service role only.';

-- 3. A connection belongs to the client it was made through.
--
-- A Google refresh token only works with the client that issued it, so one
-- Gmail connection per user is no longer enough: the same person in two
-- organizations needs one through each organization's client. organization_id
-- is null for a connection through the shared connector, and set for one made
-- with that organization's own client.
ALTER TABLE public.gmail_connections
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'gateway';

ALTER TABLE public.gmail_connections DROP CONSTRAINT IF EXISTS gmail_connections_provider_check;
ALTER TABLE public.gmail_connections
  ADD CONSTRAINT gmail_connections_provider_check CHECK (provider IN ('gateway', 'google'));

-- The two columns say the same thing twice, and must agree: a gateway
-- connection has no organization, a Google one always has.
ALTER TABLE public.gmail_connections DROP CONSTRAINT IF EXISTS gmail_connections_provider_scope_check;
ALTER TABLE public.gmail_connections
  ADD CONSTRAINT gmail_connections_provider_scope_check
  CHECK ((provider = 'gateway') = (organization_id IS NULL));

-- One per user and client. NULLS NOT DISTINCT so a user still has at most one
-- shared connection — plain UNIQUE would treat every null as different.
ALTER TABLE public.gmail_connections DROP CONSTRAINT IF EXISTS gmail_connections_user_id_key;
ALTER TABLE public.gmail_connections DROP CONSTRAINT IF EXISTS gmail_connections_user_scope_key;
ALTER TABLE public.gmail_connections
  ADD CONSTRAINT gmail_connections_user_scope_key UNIQUE NULLS NOT DISTINCT (user_id, organization_id);

COMMENT ON COLUMN public.gmail_connections.organization_id IS
  'Null for a connection through the shared connector gateway; otherwise the organization whose own Google OAuth client made it.';
COMMENT ON COLUMN public.gmail_connections.connection_key_encrypted IS
  'Encrypted: the gateway connection key for provider gateway, the Google refresh token for provider google.';
