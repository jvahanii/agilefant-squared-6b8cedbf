# Working on this repo

Operational knowledge that is not derivable from the code, and that has cost
real time to rediscover. Read before touching Supabase, CI, or dependencies.

## Supabase: there are two accounts on this machine

The CLI's default login sees only **TalentLoom** (`dfnotwbswxtrpricbjek`), a
sibling project. This repo is **Agilefant Squared** (`hwwjwkdbautfkhpxuord`).

A command against the wrong account fails with **403**
(`LegacyDbConfigLoginRoleStatusError`, `FunctionsApiStatusError`). That reads
like a missing capability. It is not — it is the wrong identity.

**When any Supabase command 403s, run `supabase projects list` first.** It shows
which projects the current login can see and settles it in one step.

The working credential is a personal access token at
`~/.supabase/agilefant-access-token`. Use it without printing it:

```bash
T=$(tr -d ' \t\r\n' < "$HOME/.supabase/agilefant-access-token")
SUPABASE_ACCESS_TOKEN="$T" npx --no-install supabase functions deploy gmail-connector \
  --project-ref hwwjwkdbautfkhpxuord
```

`~/.supabase/<name>.yaml` profiles are **not** separate logins — `--profile`
selects a deployment endpoint, not an account.

There is no local psql and no Docker, so `supabase db dump` / `db diff` do not
work. Ad-hoc SQL goes through the Management API with the same token:

```
POST https://api.supabase.com/v1/projects/hwwjwkdbautfkhpxuord/database/query
```

## Three separate deploy paths — do not confuse them

| What | How | Trigger |
|---|---|---|
| Migrations | `.github/workflows/supabase-migrations.yml` | push to `main` touching `supabase/migrations/**` |
| Edge functions | `.github/workflows/supabase-functions.yml` | push to `main` touching `supabase/functions/**` |
| Frontend | Lovable, from the connected branch | push |

`SUPABASE_DB_URL` must be the **session pooler** string. `db.<ref>.supabase.co`
is IPv6-only and unreachable from GitHub runners.

Edge functions had **no deploy workflow before 2026-09-14**. Several commits sat
on `main` unshipped while the live behaviour stayed old — the symptom is a change
that "does nothing" no matter how many times you push it. **Before debugging a
change that appears to have no effect, check what is actually deployed:**

```bash
supabase functions list --project-ref hwwjwkdbautfkhpxuord   # version + updated_at
```

`supabase functions deploy` with no names redeploys every function whose bundle
changed. Six of the eight import `supabase/functions/_shared`, so touching that
directory redeploys all six. Expected, not a runaway.

## Dependencies: CI uses bun, not npm

CI runs `bun install --frozen-lockfile`. Adding a dependency with npm updates
`package-lock.json` only, leaves `bun.lock` stale, and CI fails with *"lockfile
had changes, but lockfile is frozen"* — before any test runs, so the job dies in
~10s instead of ~30s. That duration gap distinguishes an install failure from a
test failure. After any dependency change: run `bun install` and commit
`bun.lock`.

## Migrations: Lovable leaves phantom entries

Lovable applies a migration by generating a file *and* separately executing the
statement, recording each under its own timestamp 1-3 seconds apart. The result
is `schema_migrations` rows with no local file, which block `supabase db push`.

Before "repairing" them, compare each remote entry's `statements` against the
local files. Most are byte-identical duplicates — but at least one
(`move_time_entries`) was real DDL that existed **only** in the database. Never
mark them reverted without that check.

## Tests

`appStore.performance.test.ts` asserts wall-clock budgets and fails on a loaded
machine regardless of the code (`vitest.config.ts` explains why it runs with
`fileParallelism: false`). Before blaming a change for its failures, stash and
re-run — it fails at HEAD too when the machine is busy.

Edge functions **are** typechecked, as of 2026-09-15: `bun run typecheck:functions`
(`tsconfig.functions.json` + `supabase/functions/_types/deno.d.ts`, which declares the
Deno globals and maps each remote import). `tsconfig.app.json` still excludes them, so
this is the only check they get — before it existed, an undefined name reached
production twice. Deno is not installed here; tsc stands in for it.

Fixtures for the mail extractor must carry the real markup, attributes and all.
A LinkedIn digest test written in tidied HTML passed while production mislabelled
every posting: the employer sits 486 characters after the title anchor, and the
extractor was keeping 400. Tidy markup tests a shape no sender ever produces.
Real mail is reachable via the Gmail MCP; an oversized result is saved to a file
you can run the extractor against.

## Job boards that refuse the server

Jobly (jobly.fi) is behind Cloudflare and answers every request from Supabase —
edge functions and `pg_net` alike — with **403 "Just a moment…"**. That is why no
Jobly posting ever got a deadline or a closed check, however good the parsing.
LinkedIn, Duunitori, Työmarkkinatori, The Hub and company career sites answered
200 when checked (2026-09-17). To test a board from Supabase's own network, use
`select net.http_get(url)` and read `net._http_response`.

The way round it is `extension/posting-reader`, an unpacked Chrome extension that
fetches Jobly in the user's browser; the app judges the page with the same
`factsFromPage` the server uses. Do not add LinkedIn to it: reading LinkedIn with
a signed-in session breaches LinkedIn's terms and risks the user's account. And
do not try to get past Cloudflare from the server.

## This machine

- Norton HTTPS scanning breaks some Node/Go TLS clients. `winget`'s `msstore`
  source fails with a certificate error — pin `--source winget`.
- The user's terminal is **PowerShell**: `<` redirection and bash heredocs fail
  there. Pipe instead, and never pass a secret via `--body` (PowerShell echoes
  the expanded line into history on error).
