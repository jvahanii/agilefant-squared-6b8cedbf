## Goal

Replace the Google OAuth client ID/secret used by the per-user Gmail connection with the correct ones.

## What happens

The client ID and secret aren't stored in this project's code or database — they live in the workspace-level Gmail App User Connector client that was linked earlier (`auc_01kz3avt03exhvyc76yvaf74zc`). Fixing them is a connector settings change, not a code change.

Steps once approved:

1. Open the Gmail App User Connector client card. From there you can either edit the existing client's credentials or create a new client with the correct ID/secret and link that one to the project.
2. If a new client is created, the old one is unlinked and the project secret `GOOGLE_MAIL_APP_USER_CONNECTOR_CLIENT_API_KEY` is re-synced automatically.
3. In Google Cloud, confirm the OAuth client you're pasting has:
   - Authorized redirect URI: `https://connector-gateway.lovable.dev/api/v1/app-users/oauth2/callback`
   - Scopes enabled: `userinfo.email`, `userinfo.profile`, `gmail.readonly`
4. Any Gmail connection already stored for your user was minted with the old client, so it becomes invalid. The `gmail_connections` row for affected users needs clearing so the card shows "Connect Gmail" again and a fresh consent runs against the new client.
5. Verify by connecting Gmail from the Bells & Whistles card and running a saved query preview.

## Technical details

- No changes to `supabase/functions/_shared/gmail.ts`, `gmail-connector`, or the UI card — they read the client key from the env var, which the connector re-sync updates.
- Step 4 is a one-row delete per affected user in `gmail_connections` (safe: it only holds the encrypted connection key and connected email).
