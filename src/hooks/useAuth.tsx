import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useTeamStore } from '@/store/teamStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useSnoozeStore } from '@/store/snoozeStore';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

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
    const loadingTimeout = setTimeout(() => setLoading(false), 8000);

    // Use getSession() as the authoritative source for the initial auth state.
    // It waits for the Supabase client's internal initialize() to complete
    // (including any token refresh) before resolving, so the user object and
    // the PostgREST session are always in sync when data fetching begins.
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        clearTimeout(loadingTimeout);
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        // If getSession() rejects (e.g. network error during token refresh),
        // clear the loading state so the app can fall through to the login page.
        clearTimeout(loadingTimeout);
        setLoading(false);
      });

    // onAuthStateChange handles all *subsequent* auth events (SIGNED_IN,
    // SIGNED_OUT, TOKEN_REFRESHED, USER_UPDATED, …).  We skip INITIAL_SESSION
    // because getSession() above already covers it; processing it here too
    // would set a potentially different user-object reference, triggering an
    // extra loadMemberships() call and a data-loading race on startup.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
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
        setUser(null);
        setLoading(false);
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
      setUser((prev) => {
        // Only flip org-store to loading when a *different* user signs in
        // (e.g. after a password reset). A SIGNED_IN fired by a background
        // token refresh when the tab regains focus keeps the same user id
        // and must not force the app back to the "Loading..." screen.
        if (event === 'SIGNED_IN' && newUserId && (prev?.id ?? null) !== newUserId) {
          useOrgStore.setState({ loading: true });
        }
        if ((prev?.id ?? null) === newUserId) return prev;
        return newSession?.user ?? null;
      });
      setLoading(false);
    });

    return () => {
      clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
