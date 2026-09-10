-- Per-integration rules for how an incoming WhatsApp message is split into
-- work items, read by the whatsapp-message-received function and edited on the
-- WhatsApp card in team settings.
--
-- These columns were applied straight to the database rather than through a
-- migration, so production had them while the repo did not — rebuilding the
-- schema from migrations would have produced a table without them, and the
-- function's SELECT would have failed at runtime. This backfills the record.
-- IF NOT EXISTS keeps it a no-op where the columns already exist.
ALTER TABLE public.whatsapp_integrations
  ADD COLUMN IF NOT EXISTS split_on_newline boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS split_on_space boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS split_delimiters text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS min_fragment_length integer NOT NULL DEFAULT 1;
