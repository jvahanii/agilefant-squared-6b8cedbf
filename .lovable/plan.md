## Cause

When you switch away from the Agilefant tab and come back, Supabase refreshes the auth token in the background and fires a `SIGNED_IN` event on `onAuthStateChange`.

In `src/hooks/useAuth.tsx`, the handler added during the password‑reset fix runs:

```ts
if (event === 'SIGNED_IN' && newUserId) {
  useOrgStore.setState({ loading: true });   // ← flips app to "Loading..."
}
```

It does this unconditionally — even when the user id hasn't changed. Then `setUser` / `setSession` are identity‑guarded (same id → no state change), so the `useEffect` in `App.tsx` that calls `loadMemberships(user.id)` does **not** re‑run. Nothing ever clears `orgStore.loading`, so the app sits on the "Loading..." screen until the 10‑second safety timeout in `orgStore.loadMemberships` fires.

That's the regression — it didn't happen before because we never used to flip `orgStore.loading` on a benign re‑SIGNED_IN.

## Fix

Only set `useOrgStore.loading = true` on `SIGNED_IN` when the signed‑in user id is actually different from the previously known user id. A token refresh / tab‑switch SIGNED_IN keeps the same id, so the loading flag is left alone and the app stays interactive — exactly the old behavior.

### Change

`src/hooks/useAuth.tsx`, around line 128:

```ts
// Before
if (event === 'SIGNED_IN' && newUserId) {
  useOrgStore.setState({ loading: true });
}

// After
// Only flip to loading when a *different* user signs in (e.g. after a
// password reset). A SIGNED_IN fired by a background token refresh when the
// tab regains focus keeps the same user id and must not force the app back
// to the "Loading..." screen.
setUser((prevUser) => {
  if (event === 'SIGNED_IN' && newUserId && prevUser?.id !== newUserId) {
    useOrgStore.setState({ loading: true });
  }
  if ((prevUser?.id ?? null) === newUserId) return prevUser;
  return newSession?.user ?? null;
});
```

(or equivalently, read `useAuth`'s current `user` via a ref to compare ids before the `setState` call — same effect, no nested setState side‑effect.)

No other files need to change. The password‑reset fix still works, because in that flow the previous user id is `null` (we forced a full reload via `window.location.replace('/auth')`) so the condition `prevUser?.id !== newUserId` is true on the next SIGNED_IN.

## Verification

- Open the app, switch to another browser tab, wait, switch back → app stays on its current screen, no "Loading..." flash.
- Sign out and sign in with a different account → "Loading..." appears briefly while memberships load (unchanged).
- Reset password → still redirects cleanly without crashing.
