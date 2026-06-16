## Issue
After the password is updated, the app signs out from the temporary recovery session, but the auth/org/app stores can still carry transitional state. On the next sign-in, that stale/reset transition can trigger repeated auth/org loading updates and React throws error #185 (maximum update depth) until a hard refresh reinitializes cleanly.

## Do I know what the issue is?
Yes. The reset flow is mixing a recovery session, sign-out, route navigation, and immediate sign-in without fully clearing app/org state and without guarding duplicate auth state updates. The hard refresh works because it rebuilds those stores from a clean Supabase session.

## Plan
1. **Harden auth state updates in `src/hooks/useAuth.tsx`**
   - Ignore duplicate auth events when the session/user id has not actually changed.
   - On `SIGNED_OUT`, explicitly clear auth state and loading once.
   - Keep the `/reset-password` recovery guard, but avoid leaving loading/user state in a half-updated state.

2. **Reset app/org state on sign-out**
   - Add focused reset actions to the Zustand stores if needed.
   - Call them when the user signs out after password reset and from normal sign-out.
   - This removes stale memberships, active org, selected org data, and loading flags before returning to `/auth`.

3. **Make post-reset navigation deterministic in `src/pages/ResetPassword.tsx`**
   - After `updateUser`, sign out the recovery session.
   - Clear recovery URL fragments/history.
   - Navigate to `/auth` only after the sign-out and store cleanup complete.

4. **Prevent duplicate membership/data loads in `src/App.tsx`**
   - Only call `loadMemberships` when the authenticated user id changes, not whenever Supabase provides a new `User` object reference.
   - Keep `/reset-password` as an accessible route during recovery.

5. **Verify**
   - Check the app can still load unauthenticated `/auth` and `/reset-password`.
   - Validate that sign-in after reset no longer lands on the error boundary, and that refresh is no longer required.

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>