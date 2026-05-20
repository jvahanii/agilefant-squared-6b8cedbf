# Why Lovable commits don't create "done" items

The GitHub integration edge function (`supabase/functions/github-pr-merged/index.ts`) only reacts to **merged Pull Requests** (`x-github-event: pull_request` with `action: closed` and `merged: true`).

- GitHub Copilot opens a PR → when you merge it, the webhook fires → a "done" work item is created.
- Lovable pushes commits **directly to the default branch** — no PR is ever opened or merged, so GitHub only fires a `push` event, which the function currently ignores (`event !== 'pull_request'` → returns `ignored`).

# What to change

Extend the same edge function to also accept `push` events on the default branch, creating one "done" work item per push (or per commit, see options below). Keep PR-merge handling untouched.

To avoid double-counting, skip pushes that are the result of a PR merge (their head commit message starts with `Merge pull request #`, or `pusher` is the GitHub merge bot).

# Where

Single file:
- `supabase/functions/github-pr-merged/index.ts`

Optional follow-up (cosmetic, not required):
- Rename the function to something like `github-webhook` to reflect that it now handles more than PR merges. This requires updating any webhook URL configured in GitHub. Skip unless you want the cleanup.

GitHub webhook configuration (per repo, in `github_repo_integrations`):
- Make sure each integration's webhook is subscribed to **both** `Pull requests` and `Pushes` events. If it was set up as "Just the push event" or "Let me select" with only PRs ticked, push events won't arrive.

# Technical details

In the handler, after the existing `ping` branch:

1. Accept `event === 'push'` in addition to `pull_request`.
2. For `push`:
   - Verify HMAC against each matching integration's `webhook_secret` (same loop as today).
   - Ignore if `payload.ref !== 'refs/heads/' + payload.repository.default_branch`.
   - Ignore if `payload.deleted` is true (branch delete) or `payload.commits` is empty.
   - Ignore if the head commit message starts with `Merge pull request #` (PR merge already handled) — prevents duplicates.
3. Decide granularity (recommend **one item per push**, matches current PR-merge behavior):
   - `title` = `payload.head_commit.message` first line, capped at 300 chars.
   - `description` = `Pushed to ${repoFullName}@${shortSha}` + commit URL + author.
4. Reuse the existing target-lookup + min-rank + insert logic verbatim for each `github_repo_targets` row.

Alternative granularity: one item per commit in `payload.commits` (filter out merge commits). More noise, but full traceability. Default to one-per-push unless you ask otherwise.

No database migration needed — schema for `work_items` and `work_item_backlog_ranks` already supports this.
