# Authentication

Clerk is the only way in. Supabase Auth is gone: no legacy sign-in, no password
recovery page, no `supabaseAuth` client, and nothing in the database resolves a
Supabase session any more.

## How identity works

A Clerk user id (`user_…`) is **not** this app's user id. Every table, and all
124 RLS policies, key on `profiles.id` — a uuid. The two are connected by
`profiles.clerk_id`, and exactly two database functions know about it:

- **`current_user_id()`** — returns the `profiles.id` for the calling Clerk
  subject, or NULL. Every policy calls it. `useAuth` and the edge functions call
  it too, so the client and the policies agree by construction.
- **`link_clerk_identity()`** — the only thing that creates or claims a profile.
  Called by `useAuth` when the read comes back empty. It claims an existing
  profile whose email matches the token's **verified** email, and otherwise
  creates one.

Claiming by verified email is what let 34 users migrate without an import: they
sign in with Clerk using the address they always used, and their profile
attaches itself. It also means whoever controls an email address inherits the
profile using it — the same trust model as password reset by email, which is why
`email_verified` is mandatory. A profile that is already claimed cannot be taken
over; a second account gets its own empty one.

## The pieces

| Where | What |
|---|---|
| `src/main.tsx` | Mounts `ClerkProvider`, only when `VITE_CLERK_PUBLISHABLE_KEY` is set |
| `src/lib/clerkBridge.ts` | Publishes the Clerk session to a plain store, because Clerk's hooks throw outside the provider. Also wraps the two RPCs and `openUserProfile()` |
| `src/hooks/useAuth.tsx` | Resolves the subject to `profiles.id`, exposes `user`, `loading`, `signOut`, `unlinkedClerk` |
| `src/integrations/supabase/authClient.ts` | Hands the data client Clerk's token, nothing more |
| `supabase/functions/_shared/auth.ts` | `requireAppUser(req)` — the same answer for edge functions |

Clerk's session token must carry `email`, `email_verified`, `name` and `picture`
alongside the Supabase integration's managed `role` claim. Clerk's default token
has **no email at all**, and without it `link_clerk_identity()` refuses to link.
Configure under Sessions → Customize session token.

## Traps

- **`src/integrations/supabase/client.ts` is Lovable-generated** and says not to
  edit it — but it carries the `accessToken` line that hands over Clerk's token.
  If Lovable regenerates it, **auth breaks**. Check this file after any
  Lovable-side work.
- **Never detach a supabase-js method from its client.** `supabase.rpc` reads
  `this`; assigning it to a local produced `Cannot read properties of undefined
  (reading 'rest')`, which surfaced as a *failed profile link* rather than as an
  obvious bug.
- **Regenerate `types.ts` after a schema change**:
  `supabase gen types typescript --project-id hwwjwkdbautfkhpxuord`. It is
  generated from the live database, so `current_user_id()`,
  `link_clerk_identity()` and `profiles.clerk_id` appear in it automatically —
  they were once cast by hand in `clerkBridge.ts` only because the file was
  stale.
- **Applying SQL through the Management API does not record it** in
  `supabase_migrations.schema_migrations`, so the `Deploy Supabase Migrations`
  workflow will try to run it again and fail on the second attempt. Either let CI
  apply migrations, or insert the version row by hand afterwards.
- **`SUPABASE_DB_URL` must be the pooler connection string.**
  `db.<project>.supabase.co` is IPv6-only and GitHub runners have no IPv6
  route. The workflow used to convert one to the other by reading
  `supabase/.temp/pooler-url`, which is gitignored as CLI-managed local state —
  so it was never present in a checkout, and every migration deploy failed for
  two days without anyone noticing. (That file holds no password: the CLI writes
  only `postgresql://postgres.<ref>@…pooler.supabase.com:5432/postgres` and
  supplies credentials separately.)
- **A production Clerk instance must have its own Google credentials.** Only
  development instances can borrow Clerk's. With none configured, Google answers
  `Missing required parameter: client_id` and the redirect carries a bare
  valueless `&client_id`. Check the dashboard is on the Production instance —
  settings are per-instance, and it often opens on Development.
- **Clerk locks an account after repeated failed passwords** and tells the user
  to wait an hour. Unlock in Dashboard → Users; the policy is under Configure →
  Attack protection.
- **`pk_live_` keys are domain-locked**, so Clerk never loads on localhost and
  sign-in cannot be tested there. The app falls through to the sign-in page after
  an 8 s timeout instead of hanging.
- **Edge functions must be deployed to be tested.** `./node_modules/.bin/supabase
  functions deploy <name> --project-ref hwwjwkdbautfkhpxuord`, with
  `SUPABASE_ACCESS_TOKEN` set.
- **Lovable applies DDL straight to the database without migrations.** After any
  Lovable work, diff the schema against `supabase/migrations/`.
- **CI installs with `bun install --frozen-lockfile`.** Adding a dependency with
  npm alone leaves `bun.lock` stale and fails CI before any test runs — a ~10 s
  red build rather than a test failure.
- **`vite dev` can fail with `EPERM` renaming `node_modules/.vite/`** (Norton
  holding the dep-optimiser directory); every request then 504s with "Outdated
  Optimize Dep". `vite preview` on a production build has no optimiser and works.
- **`appStore.performance.test.ts` asserts wall-clock budgets**, which is why
  `vitest.config.ts` sets `fileParallelism: false`. If those fail, suspect
  machine load before suspecting the code.

## Access

- Supabase access token: `~/.supabase/agilefant-access-token`.
- Ad-hoc SQL against production:
  `POST https://api.supabase.com/v1/projects/hwwjwkdbautfkhpxuord/database/query`.
  There is no local psql or Docker, so `supabase db dump` / `db diff` do not work.
- Deleting a user means deleting their **Clerk** account; removing the profile
  only removes their data. `cleanup_orphaned_users()` no longer touches
  `auth.users`, and those rows are kept purely as a record of who owned what
  before the migration.
