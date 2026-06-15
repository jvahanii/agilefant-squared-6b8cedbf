Root cause: the Supabase email link is now correct, but `https://agilefant.org/reset-password` is being served by Cloudflare/site hosting as a 404 instead of serving the SPA `index.html`. After the Supabase recovery token is verified, Supabase has already created a temporary recovery session, so clicking “return home” lets the app see that session and logs the user in without showing the reset form.

Plan:
1. Keep the hosting SPA fallback file (`public/_redirects`) in place for Cloudflare Pages so `/reset-password` should serve the React app instead of a host-level 404 after redeploy.
2. Add a defensive recovery handler in the app so if Supabase lands on `/` or another route with `type=recovery`, the app immediately routes to `/reset-password` before normal authenticated routing.
3. Make `/reset-password` accessible even when a temporary Supabase recovery session exists. Currently authenticated users do not have a `/reset-password` route in `App.tsx`, so the app can fall through to the logged-in area or NotFound.
4. Strengthen the reset page so it accepts both URL hash and query recovery markers, shows the password form for the temporary recovery session, and only navigates into the app after `updateUser({ password })` succeeds.

Technical details:
- Update `src/App.tsx` to include `/reset-password` in the authenticated routes as well as the unauthenticated routes.
- Update `src/hooks/useAuth.tsx` only if needed to preserve the existing recovery redirect behavior.
- Update `src/pages/ResetPassword.tsx` to detect recovery via `window.location.hash` and `window.location.search`, and avoid showing “Invalid Link” while Supabase is establishing the recovery session.

After this is deployed to the host serving `agilefant.org`, the reset link should open the set-new-password screen instead of the 404/home flow.