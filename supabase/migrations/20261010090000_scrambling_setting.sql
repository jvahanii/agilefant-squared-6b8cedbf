-- Scrambling is something an organization switches on.
--
-- "Scramble name…" sat in every item's menu, and "Scramble list…" in every
-- list's, for everyone -- a feature most organizations will never want, one
-- slip away from hiding a name behind a PIN. It now shows only where the
-- organization has switched it on (Bells & Whistles), like labels or
-- deadlines. Off by default.
--
-- The switch decides what the app offers; it is not what protects a name.
-- Names already scrambled stay scrambled with it off, and whoever scrambled
-- them can still read them back and unscramble them.

ALTER TABLE public.organization_settings
  ADD COLUMN IF NOT EXISTS scrambling_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organization_settings.scrambling_enabled IS
  'Whether the app offers scrambling of item and list names. Off by default.';

-- Left on where it is in use: the organization "Agilefant".
INSERT INTO public.organization_settings (organization_id, scrambling_enabled)
VALUES ('227ff1d1-36df-4f46-b97e-483ada92ccfb', true)
ON CONFLICT (organization_id)
  DO UPDATE SET scrambling_enabled = true, updated_at = now();
