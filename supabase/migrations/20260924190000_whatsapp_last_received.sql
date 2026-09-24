-- When the phone forwarding WhatsApp notifications was last heard from.
--
-- The forwarding runs on someone's own phone, in MacroDroid, and when it was
-- switched off nothing said so: the list simply went quiet for nine days, and
-- items typed by hand in the meantime made it look as though messages were
-- still arriving. Set by the whatsapp-message-received function on every
-- request that carries this integration's token, whether or not it adds an
-- item — the question it answers is whether the phone is still sending.

ALTER TABLE public.whatsapp_integrations
  ADD COLUMN IF NOT EXISTS last_received_at timestamptz;

COMMENT ON COLUMN public.whatsapp_integrations.last_received_at IS
  'Last request from the forwarding phone carrying this integration''s token, added items or not. Null until the first one.';
