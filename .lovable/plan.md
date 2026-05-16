# GitHub PR → Work Item: multi-org, multi-repo, multi-backlog

Generalize the currently hard-coded `github-pr-merged` webhook so any organization can wire one or more GitHub repos to one or more backlogs.

## Data model (new tables)

**`github_repo_integrations`** — one row per repo connected by an org
- `organization_id` (uuid)
- `repo_full_name` (text, e.g. `owner/name`, lowercased, unique together with org)
- `webhook_secret` (text, generated server-side, shown once)
- `enabled` (bool, default true)

**`github_repo_targets`** — backlogs that should receive a "done" item for each merged PR
- `integration_id` (uuid → github_repo_integrations)
- `organization_id` (uuid, denormalized for RLS)
- `tree_id` (text)
- `backlog_id` (text)

RLS: org admins/owners manage; members read. Webhook secret column is admin-read-only.

## Edge function changes (`github-pr-merged`)

- Drop hardcoded ORG_ID / TREE_ID / BACKLOG_ID.
- Read `payload.repository.full_name`; look up matching `github_repo_integrations` rows (a repo may belong to several orgs).
- For each integration, verify `x-hub-signature-256` against its `webhook_secret` (skip on mismatch).
- For each `github_repo_targets` row, insert a `done` work item at top of that backlog (min rank − 1), with the same id format `<org-uuid>::wi-<8hex>`, and a matching `work_item_backlog_ranks` row.
- Respond with summary of inserts.

## UI

New section in **Team Settings** (org admins only): "GitHub integrations"
- List of connected repos with: repo full name, webhook URL (copy), webhook secret (reveal/regenerate), target backlogs (add/remove with tree+backlog pickers), enable toggle, delete.
- "Add repository" form: repo full name. On create, generate secret, show payload URL + secret and short setup instructions.

Existing hardcoded Agilefant / Done archive mapping is preserved as a seeded integration row so behaviour is unchanged for the current repo.

## Notes

- Webhook URL stays the same for everyone: `…/functions/v1/github-pr-merged`. Routing is by `repository.full_name` in the payload.
- Single shared `GITHUB_WEBHOOK_SECRET` env var is no longer used by the function; per-repo secrets stored in DB are used instead. The env secret can stay for backward compat / fallback.
