# "A newer version is here" bar

## What you will see

When a newer build of the app is live and your phone is still running an older
one, a slim bar slides up at the bottom of the screen:

```text
+------------------------------------------------------+
|  A newer version is here            [ Reload ]   [ x ]|
+------------------------------------------------------+
```

- **Reload** takes you straight into the new build. No browser menus, no
  clearing of site data, nothing lost — the bar never reloads by itself, only
  when you tap it.
- **[ x ]** dismisses the bar. It will not come back for that same version, but
  a later version will raise it again.
- The bar sits above the page but under any open dialog, so it never covers a
  sheet or a confirmation you are mid-way through.
- It appears on every page, including public backlog links.

## How it works

The app already writes a small file naming its own build next to the bundle at
build time, but nothing reads it and the running app has never known its own
identity. This adds both halves:

1. The running app is told, at build time, which build it is.
2. Every minute — and the moment you switch back to the app's tab — it quietly
   asks the site what build is now live, comparing the two. Different answer
   means a newer version exists, so the bar appears.
3. Tapping Reload reloads into the new build. If the browser insists on handing
   back the old page, it falls back to opening the same address with a throwaway
   marker that forces a fresh copy, then cleans the address back to normal.

Nothing else changes: no new packages, no new settings, no database work.

## Technical details

- `vite.config.ts` — resolve the build identity (`commit`, `builtAt`) once and
  use it for both the emitted `version.json` and a new `define` constant
  `__APP_BUILD__`, so the file the site serves and the value baked into the
  bundle always agree.
- `src/vite-env.d.ts` — declare `__APP_BUILD__` for TypeScript.
- `src/lib/appVersion.ts` — `fetchLiveBuild()` fetches `/version.json` with
  `cache: "no-store"` and returns it only when the response is real JSON with a
  `builtAt` string. That check matters because the SPA fallback serves
  `index.html` with status 200 for an unknown path, so a missing file looks like
  a successful request. `isNewerBuild()` compares `builtAt`.
- `src/hooks/useAppVersion.ts` — checks on mount, every 60 seconds while the tab
  is visible, and immediately when the tab becomes visible again. Silent on any
  failure, and skipped entirely in development.
- `src/components/UpdateBanner.tsx` — the bar, using the app's existing colour
  tokens (`bg-card`, `border-border`, `text-foreground`) and the primary button
  variant, at `z-40` so Radix dialogs (`z-50`) stay above it. Mounted once in
  `App.tsx` beside the toasters, outside the router, so public routes get it too.
- `src/test/updateBanner.test.tsx` — covers: same build shows nothing, newer
  build shows the bar, an HTML response (the SPA fallback) shows nothing, and
  dismissal stays dismissed for that build.

## Notes

- The comparison uses the build timestamp rather than the commit, because the
  build environment does not always have git available; the timestamp always
  differs between builds.
- The bar cannot appear in this preview: the development server has no
  `version.json`. It becomes visible on the deployed site once a newer build
  ships — so after this change is published, the next publish is the first one
  you will be able to pick up with the bar.
- Verified with the test suite and a clean build.
