# Configurable message splitting for WhatsApp imports

Today every incoming WhatsApp message is split into items by line breaks only. This adds per-connection rules so you decide how a message becomes one or several items.

## What you get

In Organization settings, each WhatsApp connection gets a "Split messages into items" section:

- New lines (on by default, can be turned off)
- Commas
- Semicolons
- Spaces (each word becomes its own item)
- Custom characters: a free-text field, e.g. `/ | -`
- Minimum item length (default 1) so stray fragments are ignored
- A small live preview: paste a sample message and see the items it would create

Turning everything off means the whole message becomes a single item.

## Behaviour

- Rules are per connection, saved instantly, and apply to messages arriving after saving.
- Duplicate protection stays as it is: a fragment is skipped when the backlog already has an open item with the same text.
- Order is preserved — the first fragment lands on top.
- Existing connections keep working exactly as now (new lines only) until changed.

## Technical notes

- Migration: add to `whatsapp_integrations`
  - `split_on_newline boolean not null default true`
  - `split_delimiters text not null default ''` (characters, whitespace-separated in the field, stored as given)
  - `split_on_space boolean not null default false`
  - `min_fragment_length integer not null default 1`
  - No new table, so existing GRANTs/RLS apply unchanged.
- `supabase/functions/whatsapp-message-received/index.ts`: select the new columns; replace the fixed `/\r?\n/` split with a helper that builds a character class from the enabled rules (escaped), splits, trims, drops fragments shorter than the minimum, then runs the existing dedupe and rank logic untouched.
- Put the splitting helper in `supabase/functions/whatsapp-message-received/split.ts` and cover it with a Deno test (newline-only default, comma, space, custom chars, no-rules single item, min length).
- `src/components/WhatsappIntegrationsCard.tsx`: add the controls per row (switches + inputs) writing back with the same `update(...).eq('id', ...)` pattern, plus the preview computed client-side with the same helper logic mirrored in a small local function.
