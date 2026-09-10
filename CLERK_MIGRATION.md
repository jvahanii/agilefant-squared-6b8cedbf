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
  `current_user_id()` and exposes it as `user.id`, unchanged for consumers. It
  also exposes `unlinkedClerk` for the Clerk-authenticated-but-unlinked state.
- Clerk wins when both have a session, **except** when Clerk is unlinked — then
  a Supabase session still gets in. That is what makes `/auth/legacy` a real
  escape hatch rather than a decoration.
- Three separate 8 s timeouts (Supabase session, Clerk load, profile lookup)
  keep any one of them from stranding the app on "Loading...".

## Remaining work

1. **After the first Clerk sign-in, set `profiles.clerk_id` for jvahanii** to
   the Clerk user id — the not-linked screen prints it. **That single row is
   what reconnects the account to all 2097 work items.**
   `UPDATE public.profiles SET clerk_id = 'user_…' WHERE id =
   '8036890f-71a3-4aa4-a173-88680c6bb040';`
2. Move `src/pages/ResetPassword.tsx` to Clerk (still Supabase-only; harmless
   until Supabase passwords stop being used).
3. Once Clerk is trusted: drop the `auth.uid()` fallback from
   `current_user_id()`, drop the `supabaseAuth` fallback in
   `getSupabaseAccessToken`, delete `/auth/legacy` and `src/pages/AuthLegacy.tsx`.
4. Remove the sign-up banner (one `<div role="status">` block, now in both
   `Auth.tsx` and `AuthLegacy.tsx`) and delete this file.

Done since this list was written: Supabase third-party auth for
`clerk.agilefant.org`, the `accessToken` callback, `ClerkProvider`, the `useAuth`
bridge, and the Clerk sign-in page — all deployed, with Supabase sign-in and
data loading confirmed working afterwards.

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

## Access

- Supabase access token: `~/.supabase/agilefant-access-token` (read it into
  `SUPABASE_ACCESS_TOKEN`; don't ask for a fresh paste).
- Ad-hoc SQL against production:
  `POST https://api.supabase.com/v1/projects/hwwjwkdbautfkhpxuord/database/query`.
  There is no local psql or Docker, so `supabase db dump` / `db diff` do not work.
- Node is at `/c/Program Files/nodejs`; bun at `~/AppData/Roaming/npm`.
  `NODE_OPTIONS=--use-system-ca` is set permanently — Norton intercepts TLS and
  Node otherwise rejects its certificates.
