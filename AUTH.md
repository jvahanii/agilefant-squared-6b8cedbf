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

## Public links

A backlog tree, or a backlog and everything under it, can be published at
`/p/<token>` — read-only, no account needed. It is the one way to see data
without signing in, so the whole of it is kept narrow:

- **The route sits above `AppRoutes`** in `src/App.tsx`, so a visitor never waits
  on Clerk or triggers membership and data loading.
- **Anonymous visitors can call exactly one thing**: `get_published_backlog(token)`.
  It returns titles and structure, plus whichever of descriptions, statuses,
  points, teams, labels, hyperlinks and logged-time totals the link shows. What it never returns: the individual
  members of a team (people are always shown as teams), anything from profiles
  such as names or emails, individual time entries or their notes, and financial
  targets. Labels and time are sent only when the owning organization has those
  features on — not sent and hidden, because the payload is readable by whoever
  holds the link. That list lives in that function and nowhere else; no RLS
  policy was widened for this.
- **Each link can hide item attributes**: statuses, descriptions, points,
  teams, labels, links and logged time. Titles and structure always show. The
  choice lives in `published_link_settings`, keyed by target rather than by
  link, so it can be made before publishing and survives unpublishing. It
  stores what is *hidden*, so everything shows by default, including any
  attribute added later. Hiding is enforced by `get_published_backlog()`, which
  leaves a hidden attribute out of the payload altogether: hiding it only in the
  page would keep nothing private. The dialog offers points, labels and time
  only when the owning organization has them on (`get_published_link_options()`,
  which also covers trees shared in from partners, whose settings the client
  doesn't hold). As with publishing, anyone who can see the tree can change the
  choice.
- **Hyperlinks are only clickable if they are http(s) or mailto.** They come
  straight from the database, so the public page runs each through
  `safeLinkHref()` and shows anything else — a `javascript:` or `data:` URL,
  or plain prose — as text.
- **`published_links` has no write policies.** `publish_backlog_link()` and
  `unpublish_backlog_link()` are the only way to create or revoke a link, and
  they allow anyone who can see the tree — `is_tree_accessible()`, the same check
  as reading it: every member of the owning organization whatever their role,
  members of organizations the tree is shared with, and superusers. Unpublishing
  follows the same rule, so nobody can publish a link that only an admin could
  take down.
- **Tokens are 192 random bits**, so links can't be guessed, and anonymous reads
  of `published_links` return nothing, so they can't be listed. Unpublishing
  deletes the token: publishing again mints a new one and an old link that has
  spread stays dead.
- **A globe in the sidebar marks what is published**: next to a published
  backlog, and on a tree header when the tree or any backlog inside it is
  published (with a count, since a collapsed tree hides its backlogs' own
  markers). `publishedLinksStore` loads only *which* targets are published,
  never their tokens — a token in client state for every published target would
  be one more place a working public link could leak from. The link dialog
  fetches the one token it shows.
- **The markers update live.** `published_links` is in the realtime
  publication, and any change event just triggers a debounced reload of the
  targets. The events' contents are ignored on purpose: on a table with RLS a
  DELETE carries only the primary key — the token — so it could not say which
  marker to drop. That token reaches subscribers, but the row is already gone
  and the token is dead.
- **Time totals on a published page equal the app's, exactly.** They follow
  `lib/timeTotalsCore` — the app's rules, extracted so they can be checked —
  applied to the owning organization's view: its own time entries and work items
  plus those of every partner it shares trees with, in either direction, as the
  app loads them. An item's total counts every child in `childrenIds`, which is
  the union of global and per-tree-override parents, so an item under two
  parents counts under both — including children the link does not show. Only
  overrides keyed to trees the owning org loads count, because `sanitizeData`
  discards the rest. No data exercises that today, so a parity check can't
  catch it if it breaks — keep the two in step by reading them side by side.
  `get_published_backlog()` computes item totals in SQL so hidden children never
  leave the server. **If the app's loading or totalling rules change, this
  function must change with them**; the parity check that proved them equal
  rebuilds the owning org's in-memory data and runs `computeTimeTotals()` on it.
- **Publishing a shared tree publishes all of it** — including items that partner
  organizations created in it, because that is what the tree shows. And since
  those partners can now publish it themselves, sharing a tree with another
  organization means trusting them to decide whether it goes public.

## Scrambled item names

A work item's name can be scrambled from its context menu, for privacy. The
stored title is replaced by its Moomin scramble (`lib/scramble`, the same words
the display-wide toggle uses), so *everyone* sees that — this is not a per-viewer
disguise.

- **The original is kept where nobody can read it.** It lives in
  `work_item_scrambles.original_title`, and that column is granted to no client
  role: `GRANT SELECT (…)` names the other columns, so any request for it fails
  however it is asked. `reveal_scrambled_title()` is the only way out, and it
  serves only the person who scrambled it, against their PIN. Revealing does not
  unscramble: the name stays hidden until they choose to restore it.
- **The PIN is four digits, per user per organization**, set when they scramble
  their first item and stored as a bcrypt hash (`extensions.crypt`) that never
  leaves the database. The length is enforced in
  `check_or_set_scramble_pin()`, not only in the field. Unscrambling their last item deletes it, so the next first scramble
  sets a fresh one. Nobody can recover it — there is no reset.
- **Scrambling needs no PIN once one exists**; only reading a name back does.
  Hiding something is safe, revealing it is the part worth protecting.
- **A scrambled item's title cannot be changed**, by anyone. A trigger puts the
  stored title back unless the change comes from the scramble functions
  themselves, which set `app.scrambling` for their own updates. It *keeps* the
  title rather than raising, because plenty of writes carry a title along
  without meaning to change it — `restore_organization_backup()` upserts every
  item in a snapshot, the app upserts whole rows when moving items between
  backlogs, and undo replays a snapshot taken before the scramble. Raising made
  one scrambled item abort all of those. The app hides Rename on a scrambled
  item and says so, rather than letting someone type into a field whose result
  is dropped.
- **The name is scrubbed from where it would otherwise stay legible**:
  `work_item_history.title`, written by trigger on every change, and
  `change_log.entity_name`. Both get the scrambled title, and the restored one
  when it comes back — so a name an item used to have is not left behind, at the
  cost of older titles in history becoming the current one. **Organization
  backups taken before a scramble still contain the original**; restoring one
  brings it back.
- **If the scrambler's profile is deleted**, `scrambled_by` becomes NULL and the
  item stays scrambled for good. That is the right way for this to fail.

**Every function in `public` is executable by `anon` by default** — Supabase's
default privileges grant it on creation. A `SECURITY DEFINER` function's own
guard is therefore the only thing protecting it: `superuser_user_overview()` is
anon-callable and safe only because it refuses a NULL user. On anything that
should need a session, `REVOKE EXECUTE … FROM PUBLIC, anon` explicitly, as the
publish functions do.

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
