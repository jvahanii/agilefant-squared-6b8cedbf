## Goal

Each app user connects their own Gmail account, runs a Gmail search query, and imports **every link found in matching emails** as work items into a chosen backlog — manually, or automatically on a schedule from saved queries.

## Setup prerequisite (one-time, done during implementation)

The Gmail App User Connector is enabled in the workspace but has **no OAuth client configured yet**. First step of implementation is a connect card where you create/select a Google OAuth web client. You'll need to add this as an authorized redirect URI in Google Cloud:

```text
https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/callback
```

Scopes requested: `userinfo.email`, `userinfo.profile`, `gmail.readonly`.

## What gets built

### 1. Gmail Integrations card (Bells & Whistles)

A new `GmailIntegrationsCard`, styled like the existing GitHub/WhatsApp cards:

- **Connect Gmail** button → opens the consent popup; shows connected account email + Disconnect once linked. Connection is per signed-in user (keyed on the Supabase `user.id`), not per organization.
- **Saved queries list** — each row holds: Gmail search query (e.g. `is:unread from:newsletter@x.com`), target backlog tree + backlog picker, enable/disable toggle, "Run now", and delete.
- **Run now** → preview dialog listing the links found per email (link URL, anchor/label text, source subject/date), with checkboxes so you pick what to import, then "Import N links".

### 2. Import semantics (one work item per link)

For each matching email, links are extracted from the HTML body (`<a href>`, plus bare URLs in text-only mails), then de-duplicated:

- Work item **title** = anchor text if meaningful, otherwise the URL's page title-ish fallback (host + path).
- Work item **description** = source email subject, sender, date.
- The link itself is stored as a **hyperlink** on the item (existing `hyperlinks` table / HyperlinksDialog model).
- Status `not_started`; placed at the end of the target backlog's list rank (and board rank, matching how `addWorkItem` seeds ranks today).
- Tracking/unsubscribe noise is filtered by a small blocklist (unsubscribe, mailto:, image beacons, google/gmail redirect wrappers are unwrapped to their target).

### 3. Deduplication

A new table records every imported `(gmail_message_id, normalized_url)` per organization, so re-running a query — manually or on schedule — never creates the same work item twice. Preview marks already-imported links as "imported".

### 4. Scheduled import

- Saved queries store `schedule_enabled` and a frequency (hourly / daily).
- A Supabase edge function runs on a cron schedule, walks enabled saved queries, calls Gmail per owning user through the connector gateway, extracts links, skips duplicates, and inserts work items directly.
- Because the schedule runs without a browser session, the per-user connection key is stored server-side in a private table readable only by its owner (and by the function via service role).

## Technical details

- **Server-side only Gmail calls.** New edge functions: `gmail-connect` (starts consent / stores connection key), `gmail-search-preview` (query → extracted links, dedupe flags), `gmail-import` (create work items + hyperlinks + dedupe rows), `gmail-scheduled-import` (cron). All Gmail requests go through `https://connector-gateway.lovable.dev/google_mail/gmail/v1/...` with `LOVABLE_API_KEY` + per-user connection key; failures surface the provider status and body.
- **Gmail endpoints used:** `users/me/messages?q=...` for matching, `users/me/messages/{id}?format=full` for headers + body parts (base64url-decoded), `users/me/profile` for the connected address.
- **New tables** (all with explicit GRANTs, RLS on, policies scoped to `auth.uid()` / org membership):
  - `gmail_connections` — user_id, connection key (server-only, no anon/authenticated select of the key), connected email.
  - `gmail_import_queries` — org_id, user_id, query, tree_id, backlog_id, schedule_enabled, frequency, last_run_at.
  - `gmail_imported_links` — org_id, query_id, gmail_message_id, normalized_url, work_item_id, unique constraint for dedupe.
- **Work item creation** reuses existing store/sync paths so realtime sync, ranks, and history triggers behave the same as manual adds; bulk inserts suppress burnup history like the existing bulk paths do.
- **Feature gating:** the card is always visible in Bells & Whistles; import actions are disabled until Gmail is connected. No org-wide toggle unless you want one.

## Notes

- Import is read-only on Gmail (`gmail.readonly`) — nothing is marked read, archived, or deleted.
- Gmail's search API caps per-page results; the preview fetches up to a bounded number of messages (default 50, paginated) to keep runs fast.
