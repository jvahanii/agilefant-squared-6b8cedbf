# Clerk migration — handoff

Moving authentication from Supabase Auth to Clerk. The database half is done and
deployed; the application half is not started. Delete this file once the
migration is finished.

## Scope decision that shapes everything

Only the user **jvahanii** (`profiles.id = 8036890f-71a3-4aa4-a173-88680c6bb040`)
and the **agilefant** organisation matter. The other ~35 users and their
memberships are expendable and do **not** need migrating. This is why no user
import is planned — one profile gets linked to one Clerk account.

## Why the database looks the way it does

`auth.uid()` cannot be used with Clerk: it casts the JWT `sub` claim to `uuid`,
and Clerk ids (`user_2abc…`) are not uuids, so it raises. The common advice is to
convert every `user_id` column to text and key off the Clerk id. **We
deliberately did not** — 124 RLS policies and 11 functions are built on uuid
identities, and the existing rows must keep working.

Instead `public.current_user_id()` maps a Clerk `sub` to the profile row that
already exists, via a new `profiles.clerk_id` column, and falls back to the uuid
path. So the uuid stays the identity everywhere downstream and no data moves.

That fallback is what makes the cutover **reversible**: with a Supabase token it
returns exactly what `auth.uid()` returned, so the whole rewrite is a no-op until
a Clerk token actually appears.

## Done and pushed

| Commit | What |
|---|---|
| `e38a0ad` | `profiles.clerk_id` + `current_user_id()` (migration `20260910120000`) |
| `bcd2d2d` | All 124 policies and 11 functions now call `current_user_id()` (migration `20260910123000`) |
| `94ed7e6` | `@clerk/clerk-react` added, both lockfiles synced |
| `7fda138` | Login-page banner warning against new sign-ups |
| `af722fd` | Supabase client takes an `accessToken` callback; `supabaseAuth` split out |
| `8bebae9` | `src/lib/currentUser.ts` — auth-agnostic view of who is signed in |
| `3251ef3` | `ClerkProvider`, mounted only when a publishable key is configured |
| `e302157` | Clerk sign-in at `/auth`, Supabase form at `/auth/legacy`, `useAuth` bridged |
| `336281e` | Clerk sign-up route at `/auth/sign-up` |
| `eb4c9d1` | Call `rpc()` on the client instead of detaching it (lost `this`) |
| `b38ce59` | `/auth/*` redirects home when signed in, not just `/auth` |
| `aa73b9b` | `profiles` becomes the identity table; `link_clerk_identity()` |
| `495e872` | Parse `email_verified` without a cast that can raise |

Verified against the live database, not just assumed:

- Reversing the substitution reproduces all 124 policies **exactly** — roles,
  command, permissive flag, `USING` and `WITH CHECK` all identical.
- Exercised as the `authenticated` role (the management API's own role bypasses
  RLS): a linked Clerk sub sees the same rows as the Supabase sub — 47 orgs,
  2097 work items — and an unlinked Clerk sub sees zero.
- `current_user_id()` returns NULL rather than raising on an unrecognised sub, so
  a half-configured Clerk reads as "not signed in" instead of erroring.

## Clerk side, already configured

- **Production instance** on `agilefant.org`. DNS verified via Clerk's Cloudflare
  integration (all records `DNS only` — proxying them breaks certificate issuance).
- **Google** using the pre-existing `Agilefant` OAuth client, with
  `https://clerk.agilefant.org/v1/oauth_callback` added to its redirect URIs.
  A production instance **must** have custom credentials — only development
  instances can borrow Clerk’s shared ones. When the client id is missing or
  saved against the wrong instance, Google answers `Missing required
  parameter: client_id` and the redirect carries a bare valueless `&client_id`.
- **Session token claims.** The token template adds `email`, `email_verified`,
  `name` and `picture` alongside the Supabase integration’s managed `role`.
  Clerk’s default token has no email at all, and `link_clerk_identity()`
  refuses to link without a verified one.
- **Organizations: off.** The app has its own multi-tenancy (`organizations`,
  `memberships`, `organization_titles`, `organization_invites`) enforced by those
  124 policies. Clerk Organizations would be a competing source of truth. It can
  be enabled later for enterprise SSO without redoing any of this.
- Publishable key: `pk_live_Y2xlcmsuYWdpbGVmYW50Lm9yZyQ` (decodes to
  `clerk.agilefant.org`). Publishable keys are meant to be public. The **secret**
  key should not be needed — Supabase validates Clerk tokens via JWKS.
- **No development instance.** `pk_live_` keys are domain-locked, so there is no
  localhost testing: changes must be deployed to be verified. Acceptable because
  jvahanii is the only user, but it means favouring conservative, reversible steps.

## How the frontend is wired now

- `src/lib/clerkBridge.ts` — `ClerkBridge` sits inside `ClerkProvider` and
  publishes the Clerk session to a plain subscribable store. `useAuth` reads
  that store instead of Clerk's hooks, which throw outside the provider and so
  cannot be called from a component that also has to work in a keyless build.
- `useAuth` resolves the Clerk subject to `profiles.id` through
  `current_user_id()` and exposes it as `user.id`, unchanged for consumers. When
  that comes back empty it calls `link_clerk_identity()`, which claims a profile
  by verified email or creates one; only if *that* fails does `unlinkedClerk`
  surface the failure screen.
- **`profiles` is the identity table.** Six tables used to key their user
  columns to `auth.users(id)`, which made a Clerk-native user unrepresentable.
  They now reference `profiles(id)`, and `profiles.id` has no foreign key at
  all: existing rows keep their old uuid, Clerk-native ones get a fresh one.
- Clerk wins when both have a session, **except** when Clerk is unlinked — then
  a Supabase session still gets in. That is what makes `/auth/legacy` a real
  escape hatch rather than a decoration.
- Three separate 8 s timeouts (Supabase session, Clerk load, profile lookup)
  keep any one of them from stranding the app on "Loading...".

## Verified working in production

- jvahanii signs in through Clerk **and** through `/auth/legacy`, both reaching
  the same data.
- **Sign-up, email/password**: new profile on a fresh uuid with no `auth.users`
  row behind it, org auto-created by `Onboarding`, role `owner`.
- **Sign-up, Google**: same, with `full_name` and `avatar_url` filled from the
  token claims.
- **Claiming an existing profile**: a brand-new Clerk account signing in with
  Google against an unlinked profile’s address re-claimed that exact profile,
  keeping both its organizations, and created nothing new. **This is the whole
  migration path for the remaining 34 users — there is nothing to import.** The
  24 Google users click "Continue with Google"; the 14 password users sign up in
  Clerk with the same address and their profile claims itself.
- Rejections hold: an already-linked profile cannot be claimed by a second
  account (it gets an empty profile with no memberships), and an unverified
  address is refused outright.

## Remaining work

1. **The five edge functions.** `gmail-connector`, `check-subscription`,
   `create-checkout`, `customer-portal` and `youtube-proxy` authenticate the
   caller against Supabase Auth — `auth.getUser()` rejects a Clerk RS256 token
   outright, and `youtube-proxy` reads `claims.sub` as a uuid, which a Clerk id
   is not. **Every one of them fails for every Clerk user.** The fix mirrors the
   database: validate via JWKS, then map the subject to `profiles.id`.
2. **Realtime after an idle period** is still untested. Clerk session tokens are
   short-lived and seven channels authenticate with them; if refresh does not
   reach the socket it fails silently, minutes later.
3. Once Clerk is trusted: drop the `auth.uid()` fallback from
   `current_user_id()`, drop the `supabaseAuth` fallback in
   `getSupabaseAccessToken`, and delete `/auth/legacy`,
   `src/pages/AuthLegacy.tsx`, `src/pages/ResetPassword.tsx` and its route.
   `ResetPassword` is **not** ported to Clerk — it exists only to complete
   Supabase’s recovery flow, and Clerk does password reset inside its own
   `<SignIn>` widget.
4. Remove the sign-up banner (one `<div role="status">` block, now in
   `Auth.tsx` and `AuthLegacy.tsx`) and delete this file.

## Traps

- **`src/integrations/supabase/client.ts` is Lovable-generated** and says not to
  edit it — but step 3 has to. If Lovable regenerates it after cutover, **auth
  breaks**. Check this file after any Lovable-side work.
- **CI installs with `bun install --frozen-lockfile`.** Adding a dependency with
  npm alone leaves `bun.lock` stale and fails CI before any test runs — it
  presents as a ~10s red build rather than a test failure. Add with bun and
  regenerate `package-lock.json`.
- **Lovable applies DDL straight to the database without migrations.** Twice
  already the repo could not reproduce production (`move_time_entries`, and the
  WhatsApp `split_*` columns). After any Lovable work, diff the schema against
  `supabase/migrations/`.
- **`appStore.performance.test.ts` asserts wall-clock budgets**, which is why
  `vitest.config.ts` sets `fileParallelism: false`. If those fail, suspect
  machine load before suspecting the code.
- **`vite dev` can fail to start with `EPERM` renaming `node_modules/.vite/`**
  — Norton holding the dep-optimiser directory. Every request then 504s with
  "Outdated Optimize Dep". `vite preview` on a production build has no
  optimiser and works, so verify that way.
- **`current_user_id()` is absent from the generated `types.ts`**, so the RPC
  call is typed by hand in `clerkBridge.ts`. Adding it to `types.ts` would be
  silently dropped the next time Lovable regenerates that file.
- **Cast the client, never the method.** `supabase.rpc` reads `this`; pulling it
  into a local produced `Cannot read properties of undefined (reading 'rest')`,
  which surfaced as a *failed profile link* rather than as an obvious bug.
- **Clerk locks an account after repeated failed passwords** and tells the user
  to wait an hour. Unlock it in Dashboard → Users; the policy lives under
  Configure → Attack protection. While both systems run, the same address has
  two different passwords, which is what triggers this.

## Access

- Supabase access token: `~/.supabase/agilefant-access-token` (read it into
  `SUPABASE_ACCESS_TOKEN`; don't ask for a fresh paste).
- Ad-hoc SQL against production:
  `POST https://api.supabase.com/v1/projects/hwwjwkdbautfkhpxuord/database/query`.
  There is no local psql or Docker, so `supabase db dump` / `db diff` do not work.
- Node is at `/c/Program Files/nodejs`; bun at `~/AppData/Roaming/npm`.
  `NODE_OPTIONS=--use-system-ca` is set permanently — Norton intercepts TLS and
  Node otherwise rejects its certificates.
