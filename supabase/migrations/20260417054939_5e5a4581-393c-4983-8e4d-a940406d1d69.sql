ALTER TABLE public.organization_settings
ADD COLUMN IF NOT EXISTS labels_enabled boolean NOT NULL DEFAULT false;