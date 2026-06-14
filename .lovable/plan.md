# Fix: password reset email logs user in instead of opening reset form

## Root cause

`resetPasswordForEmail` already passes `redirectTo: ${origin}/reset-password`, but Supabase only honors that if the URL is in the project's Redirect URL allow list. When it isn't, Supabase falls back to the Site URL (`/`), the recovery token is consumed there, and the user ends up signed in on the home page instead of on the reset form.

## Fix (two parts)

### 1. Code: catch recovery sessions globally and route to `/reset-password`

In `src/hooks/useAuth.tsx`, when `onAuthStateChange` fires with event `PASSWORD_RECOVERY` (or when the initial URL hash contains `type=recovery`), force a client-side navigation to `/reset-password` preserving the hash. This guarantees the reset form is shown even if the email link lands on `/`.

Implementation detail: do the navigation with `window.location.replace('/reset-password' + window.location.hash)` from inside the auth listener so it works before the router has mounted. Skip if already on `/reset-password`.

Also harden `src/pages/ResetPassword.tsx`: in addition to checking `type=recovery` in the hash, treat the presence of an active recovery session (set by the `PASSWORD_RECOVERY` event it already subscribes to) as sufficient — the current code is already close, no behavior change needed beyond confirming it still works after the redirect above.

### 2. Configuration (user action, outside code)

In Supabase Auth settings → URL Configuration, add `https://<your-domain>/reset-password` (and the Lovable preview/published origins) to the **Redirect URLs** allow list. Without this, Supabase will keep falling back to Site URL. The code change above makes the app resilient even if this step is missed, but adding the URL is the clean long-term fix.

## Files changed

- `src/hooks/useAuth.tsx` — add `PASSWORD_RECOVERY` handler that redirects to `/reset-password`.

## Out of scope

No changes to email templates (project uses default Supabase auth emails — no `auth-email-hook` exists). No new routes.
