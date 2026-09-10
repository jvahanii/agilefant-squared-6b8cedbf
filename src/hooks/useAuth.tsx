import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, ReactNode } from 'react';
import { supabaseAuth } from "@/integrations/supabase/authClient";
import type { User, Session } from '@supabase/supabase-js';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useTeamStore } from '@/store/teamStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useSnoozeStore } from '@/store/snoozeStore';
import { recordSignIn } from '@/store/signInLogStore';
import { setCurrentUser } from "@/lib/currentUser";
import {
  clerkSignOut,
  fetchAppUserId,
  getClerkState,
  linkClerkIdentity,
  subscribeToClerk,
} from "@/lib/clerkBridge";

/**
 * The subset of a Supabase `User` this app actually reads, so a Clerk session
 * can fill the same shape. A Supabase `User` still satisfies it, which is what
 * keeps the legacy sign-in working through the identical context.
 */
export interface AuthUser {
  /** profiles.id — never a Clerk user id. See lib/currentUser.ts. */
  id: string;
  email?: string | null;
  /** Named fields are the ones this app reads; both auth systems supply them. */
  user_metadata?: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    [key: string]: unknown;
  };
}

/** Clerk has a session, but no profiles row claims it. */
export interface UnlinkedClerkAccount {
  clerkUserId: string;
  email: string | null;
  /** Set when the lookup itself failed rather than coming back empty. */
  error: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  /** The Supabase session; null while Clerk is the one signed in. */
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  unlinkedClerk: UnlinkedClerkAccount | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
  unlinkedClerk: null,
});

function resetClientStoresAfterSignOut() {
  useOrgStore.setState({ memberships: [], activeOrgId: null, activeOrgName: null, loading: false });
  useAppStore.setState({
    workItems: {},
    backlogs: {},
    backlogTrees: {},
    hyperlinks: {},
    selectedBacklogIds: [],
    selectedTreeId: null,
    selectedWorkItemIds: [],
    changeLog: [],
    expandedWorkItems: new Set(),
    expandedBacklogs: new Set(),
    undoStack: [],
    redoStack: [],
    isLoading: false,
    loadingProgress: 0,
    organizationId: null,
    userId: null,
    userEmail: null,
  });
  useTeamStore.setState({ teams: [], teamMembers: [], workItemTeams: {}, loading: false });
  useTimeEntryStore.setState({ timeEntries: {}, isLoading: false });
  useSnoozeStore.setState({ snoozes: {}, isLoading: false });
}

/** A resolved (or failed) Clerk-subject to profiles.id lookup. */
interface ClerkMapping {
  clerkUserId: string;
  appUserId: string | null;
  error: string | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [supabaseUser, setSupabaseUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [supabaseLoading, setSupabaseLoading] = useState(true);

  const clerk = useSyncExternalStore(subscribeToClerk, getClerkState);
  const clerkUserId = clerk.status === 'signed-in' ? clerk.identity.clerkUserId : null;
  const [mapping, setMapping] = useState<ClerkMapping | null>(null);
  const [clerkTimedOut, setClerkTimedOut] = useState(false);

  useEffect(() => {
    // If the email-recovery link lands anywhere other than /reset-password
    // (e.g. Supabase fell back to Site URL because /reset-password isn't in
    // the Redirect URLs allow list), bounce to the reset form before the
    // recovery session auto-logs the user in.
    const redirectIfRecovery = () => {
      const hash = window.location.hash || '';
      const isRecoveryHash = hash.includes('type=recovery');
      if (isRecoveryHash && window.location.pathname !== '/reset-password') {
        window.location.replace('/reset-password' + hash);
        return true;
      }
      return false;
    };
    if (redirectIfRecovery()) return;

    // Safety timeout: if Supabase auth doesn't respond within 8 seconds,
    // clear the loading state so the app can redirect to the login page
    // instead of hanging on the loading screen indefinitely.
    const loadingTimeout = setTimeout(() => setSupabaseLoading(false), 8000);

    // Use getSession() as the authoritative source for the initial auth state.
    // It waits for the Supabase client's internal initialize() to complete
    // (including any token refresh) before resolving, so the user object and
    // the PostgREST session are always in sync when data fetching begins.
    supabaseAuth.auth.getSession()
      .then(({ data: { session } }) => {
        clearTimeout(loadingTimeout);
        setSession(session);
        setSupabaseUser(session?.user ?? null);
        setSupabaseLoading(false);
        // Record sign-in locally for the manager screen
        if (session?.user?.id) {
          recordSignIn(
            session.user.id,
            session.user.user_metadata?.full_name ?? null,
            session.user.email ?? null,
          );
        }
      })
      .catch(() => {
        // If getSession() rejects (e.g. network error during token refresh),
        // clear the loading state so the app can fall through to the login page.
        clearTimeout(loadingTimeout);
        setSupabaseLoading(false);
      });

    // onAuthStateChange handles all *subsequent* auth events (SIGNED_IN,
    // SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, …).  We skip INITIAL_SESSION
    // because getSession() above already covers it; processing it here too
    // would set a potentially different user-object reference, triggering an
    // extra loadMemberships() call and a data-loading race on startup.
    const { data: { subscription } } = supabaseAuth.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY' && window.location.pathname !== '/reset-password') {
        clearTimeout(loadingTimeout);
        window.location.replace('/reset-password' + (window.location.hash || ''));
        return;
      }
      // While on /reset-password, ignore auth state changes so the recovery
      // session doesn't bounce the user into the app before they set a new password.
      if (window.location.pathname === '/reset-password' && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
        clearTimeout(loadingTimeout);
        return;
      }
      if (event === 'INITIAL_SESSION') {
        clearTimeout(loadingTimeout);
        return;
      }
      clearTimeout(loadingTimeout);
      if (event === 'SIGNED_OUT') {
        resetClientStoresAfterSignOut();
        setSession(null);
        setSupabaseUser(null);
        setSupabaseLoading(false);
        return;
      }
      // Avoid duplicate state updates when the user identity hasn't changed.
      // TOKEN_REFRESHED / USER_UPDATED swap the user object reference and
      // re-trigger downstream effects (loadMemberships, data fetches), which
      // on a freshly-reset password sign-in can produce render-loop crashes.
      const newUserId = newSession?.user?.id ?? null;
      setSession((prev) => {
        if ((prev?.user?.id ?? null) === newUserId && prev?.access_token === newSession?.access_token) return prev;
        return newSession;
      });
      setSupabaseUser((prev) => {
        // Only flip org-store to loading when a *different* user signs in
        // (e.g. after a password reset). A SIGNED_IN fired by a background
        // token refresh when the tab regains focus keeps the same user id
        // and must not force the app back to the "Loading..." screen.
      if (event === 'SIGNED_IN' && newUserId && (prev?.id ?? null) !== newUserId) {
          useOrgStore.setState({ loading: true });
          // Record sign-in locally for the manager screen
          const fullName = newSession?.user?.user_metadata?.full_name ?? null;
          const email = newSession?.user?.email ?? null;
          recordSignIn(newUserId, fullName, email);
        }
        if ((prev?.id ?? null) === newUserId) return prev;
        return newSession?.user ?? null;
      });
      setSupabaseLoading(false);
    });

    return () => {
      clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, []);

  // Same 8 s reasoning as above, for the case where Clerk's script never
  // finishes loading: without this the app would sit on "Loading..." forever
  // instead of falling through to the sign-in page — or to a Supabase session
  // that is already perfectly usable.
  useEffect(() => {
    if (clerk.status !== 'unknown') return;
    const timeout = setTimeout(() => setClerkTimedOut(true), 8000);
    return () => clearTimeout(timeout);
  }, [clerk.status]);

  // Translate the Clerk subject into this app's profiles.id. Runs once per
  // Clerk user, and never for a signed-out Clerk, so the legacy path pays
  // nothing for it.
  useEffect(() => {
    if (!clerkUserId) {
      setMapping(null);
      return;
    }
    let cancelled = false;
    // Without this the app would spin on "Loading..." indefinitely if the
    // lookup never comes back. Reporting it as a failed link at least leaves
    // the sign-out button and the legacy route reachable.
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setMapping({ clerkUserId, appUserId: null, error: 'the profile lookup timed out' });
      }
    }, 8000);
    // A first-time Clerk account has no profile yet, so the read comes back
    // empty and link_clerk_identity() is what creates or claims one. Only
    // after that has been tried is an empty result really "not linked".
    fetchAppUserId()
      .then((appUserId) => appUserId ?? linkClerkIdentity())
      .then((appUserId) => {
        clearTimeout(timeout);
        if (!cancelled) setMapping({ clerkUserId, appUserId, error: null });
      })
      .catch((err: unknown) => {
        clearTimeout(timeout);
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('Could not map the Clerk session onto a profile:', message);
        setMapping({ clerkUserId, appUserId: null, error: message });
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [clerkUserId]);

  // Only a mapping belonging to the Clerk user currently signed in counts; a
  // stale one would hand the previous user's data to the next one.
  const currentMapping = mapping && mapping.clerkUserId === clerkUserId ? mapping : null;
  const clerkIdentity = clerk.status === 'signed-in' ? clerk.identity : null;
  const appUserId = currentMapping?.appUserId ?? null;

  const clerkUser = useMemo<AuthUser | null>(() => {
    if (!clerkIdentity || !appUserId) return null;
    return {
      id: appUserId,
      email: clerkIdentity.email,
      user_metadata: {
        full_name: clerkIdentity.fullName ?? undefined,
        avatar_url: clerkIdentity.avatarUrl ?? undefined,
      },
    };
    // Keyed on the values rather than the identity object, so a Clerk
    // re-render doesn't hand every consumer a new user and re-run their effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUserId, clerkIdentity?.email, clerkIdentity?.fullName, clerkIdentity?.avatarUrl]);

  const unlinkedClerk = useMemo<UnlinkedClerkAccount | null>(() => {
    if (!clerkIdentity || !currentMapping || currentMapping.appUserId) return null;
    return {
      clerkUserId: currentMapping.clerkUserId,
      email: clerkIdentity.email,
      error: currentMapping.error,
    };
    // Same reasoning: the identity object itself is deliberately not a
    // dependency, only the email it carries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkIdentity?.email, currentMapping]);

  // Clerk wins when it has a session: it is the system being migrated to, and
  // a leftover Supabase session must not shadow it.
  const user: AuthUser | null = clerkUser ?? supabaseUser;

  // Two things have to settle before the app may conclude "nobody is signed
  // in" and redirect: Clerk deciding whether it has a session, and the profile
  // lookup for that session. Both are derived rather than stored, so there is
  // no render in between where loading briefly reads false.
  const clerkDeciding = clerk.status === 'unknown' && !clerkTimedOut;
  const clerkMappingPending = clerkUserId !== null && currentMapping === null;
  const loading = supabaseLoading || clerkDeciding || clerkMappingPending;

  useEffect(() => {
    if (!clerkUser) return;
    // Record sign-in locally for the manager screen, as the Supabase paths do.
    recordSignIn(
      clerkUser.id,
      clerkUser.user_metadata?.full_name ?? null,
      clerkUser.email ?? null,
    );
  }, [clerkUser]);

  const signOut = async () => {
    // Sign out of both, whichever is holding the session. An unlinked Clerk
    // account in particular has to be able to get back to the sign-in page,
    // and that is the one state where no app user exists at all.
    await clerkSignOut();
    setMapping(null);
    try {
      await supabaseAuth.auth.signOut();
    } catch {
      // Already signed out, or offline; the Clerk sign-out above still stands.
    }
    // Clerk fires no Supabase SIGNED_OUT event, so the stores are cleared here
    // instead of relying on the onAuthStateChange handler above.
    resetClientStoresAfterSignOut();
  };

  // Mirror the signed-in user into the auth-agnostic helper the stores read.
  // Kept as one effect rather than added to each setUser call site so it
  // cannot drift out of sync with the React state it is meant to reflect.
  useEffect(() => {
    setCurrentUser(
      user
        ? {
            id: user.id,
            email: user.email ?? null,
            fullName:
              user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
            avatarUrl: user.user_metadata?.avatar_url ?? null,
          }
        : null,
    );
  }, [user]);


  return (
    <AuthContext.Provider value={{ user, session, loading, signOut, unlinkedClerk }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
