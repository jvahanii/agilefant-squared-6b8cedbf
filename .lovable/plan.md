# Fix Password Reset Flow

## What's happening

1. Email link → Supabase verify → redirects to `/reset-password#access_token=...&type=recovery`.
2. The Supabase client auto-consumes the URL hash on load and fires `PASSWORD_RECOVERY` **before** the lazy-loaded `ResetPassword` component mounts. Its listener therefore never sees the event, the hash is already gone, and after 1.5s we render **"Invalid Link"**.
3. Clicking **Back to Sign In** navigates to `/auth`. Because a recovery session already exists, `useAuth` treats the user as signed in and the `/auth` route does `<Navigate to="/">`. During that transition `useAuth`'s `onAuthStateChange` (or another setState chain) triggers React error **#185 (max update depth)** → ErrorBoundary shows "Something went wrong". A hard refresh re-runs `getSession()` cleanly and lands in the app.

## Fix

### `src/pages/ResetPassword.tsx`
- Stop relying on the `PASSWORD_RECOVERY` event firing after mount.
- On mount, immediately call `supabase.auth.getSession()`. If a session exists, treat the page as **ready** (the user got here via the recovery link or is already signed in and explicitly wants to change password).
- Keep the `onAuthStateChange` listener as a backup for the rare case the session is still being established.
- Only show "Invalid Link" if after ~2s there is still no session AND no recovery markers in URL.
- Use a `mountedRef` so `setStatus` never runs after unmount (defensive against error #185).
- After `updateUser` success, sign out first then navigate to `/auth` with a success toast — avoids leaving the user in an ambiguous recovery session and avoids the `/auth` → `/` → Index redirect chain that's currently crashing.

### `src/hooks/useAuth.tsx`
- Tighten the `PASSWORD_RECOVERY` branch: only `window.location.replace` when the path is not `/reset-password` **and** not already mid-redirect (guard with a module-level flag) to eliminate any chance of a redirect loop contributing to #185.
- No other behavior changes.

### `src/components/ErrorBoundary.tsx`
- No change needed; once the underlying loop is gone the boundary won't trip.

## Out of scope
- Supabase dashboard settings (Site URL / Redirect URLs already correct per user).
- `public/_redirects` (already in place).
- Auth.tsx, App routing structure beyond what's described.

## Verification
1. Request password reset from `/auth`.
2. Click email link → should land on `/reset-password` showing the **New Password** form (no "Invalid Link" flash).
3. Submit new password → toast + redirect to `/auth` where user can sign in with new password.
4. If link is genuinely bad/expired → "Invalid Link" card; clicking **Back to Sign In** goes to `/auth` without the "Something went wrong" screen.
