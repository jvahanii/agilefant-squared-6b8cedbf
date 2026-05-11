import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react';
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
  // Keep a ref so the visibilitychange handler can read the latest loading
  // state without needing to be re-registered on every state change.
  const loadingRef = useRef(true);

  useEffect(() => {
    // Safety timeout: if Supabase auth doesn't respond within 8 seconds,
    // clear the loading state so the app can redirect to the login page
    // instead of hanging on the loading screen indefinitely.
    const loadingTimeout = setTimeout(() => {
      if (loadingRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }, 8000);

    // Guard so the initial auth state is resolved exactly once, regardless of
    // whether INITIAL_SESSION or getSession() fires first.  Without this guard,
    // both could call resolveSession with slightly different user-object
    // references, triggering a second loadMemberships() call and a data-loading
    // race on startup.
    let initiallyResolved = false;
    const resolveInitialSession = (s: Session | null) => {
      if (initiallyResolved) return;
      initiallyResolved = true;
      resolveSession(s);
    };

    const resolveSession = (s: Session | null) => {
      clearTimeout(loadingTimeout);
      setSession(s);
      setUser(s?.user ?? null);
      loadingRef.current = false;
      setLoading(false);
    };

    // getSession() waits for the Supabase client's internal initialize() to
    // complete (including any token refresh) before resolving, so the user
    // object and the PostgREST session are always in sync when data fetching
    // begins.  It acts as a fallback in case INITIAL_SESSION never fires.
    supabase.auth.getSession()
      .then(({ data: { session } }) => resolveInitialSession(session))
      .catch(() => {
        // If getSession() rejects (e.g. network error during token refresh),
        // clear the loading state so the app can fall through to the login page.
        clearTimeout(loadingTimeout);
        loadingRef.current = false;
        setLoading(false);
      });

    // onAuthStateChange handles all auth events.  INITIAL_SESSION is used as
    // the primary handler for the initial auth state: it fires as soon as the
    // Supabase client finishes initializing (before getSession() resolves), so
    // handling it here unblocks loading immediately and keeps the 8-second
    // safety timeout intact as a true last-resort fallback.  The
    // resolveInitialSession guard prevents a double-resolve if getSession()
    // also fires shortly after.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'INITIAL_SESSION') {
        resolveInitialSession(session);
        return;
      }
      resolveSession(session);
    });

    // On mobile (iOS Safari), the page can be suspended or restored from
    // bfcache while getSession() is in-flight and setTimeout is paused.  When
    // the page becomes visible again the in-flight request may have been
    // silently cancelled by the OS, leaving authLoading stuck at true.
    // Re-calling getSession() on visibility regain unblocks the app.
    // `retrying` prevents overlapping concurrent calls if the event fires
    // multiple times before the first retry resolves.
    let retrying = false;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !loadingRef.current || retrying) return;
      retrying = true;
      supabase.auth.getSession()
        .then(({ data: { session } }) => resolveInitialSession(session))
        .catch(() => {
          loadingRef.current = false;
          setLoading(false);
        })
        .finally(() => { retrying = false; });
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearTimeout(loadingTimeout);
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
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
