import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        // Already handled by getSession() above.  Clear the timeout defensively
        // in case getSession() hasn't resolved yet (e.g. very fast initialization).
        clearTimeout(loadingTimeout);
        return;
      }
      clearTimeout(loadingTimeout);
      setSession(session);
      setUser(session?.user ?? null);
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
