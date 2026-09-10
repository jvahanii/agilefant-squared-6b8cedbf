import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { lazy, Suspense, useEffect, useRef } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Auth from "./pages/Auth";
import { clerkEnabled } from "@/lib/clerkBridge";

// Pre-load appStore data as soon as the active org is known, before any page
// component mounts. Zustand's subscribe fires synchronously inside
// loadMemberships (before React re-renders to show the route), so
// loadFromSupabase gets a head-start over component-level useEffect callbacks.
// Without this, React's bottom-up effect ordering means child components (e.g.
// GithubIntegrationsCard) fire their effects before the page-level effect that
// kicks off loadFromSupabase, causing a flash of UUID names in integration targets.
useOrgStore.subscribe((state, prevState) => {
  if (state.activeOrgId && state.activeOrgId !== prevState.activeOrgId) {
    const appStore = useAppStore.getState();
    appStore.setOrganizationId(state.activeOrgId);
    appStore.loadFromSupabase();
  }
});

// Lazy so the entry chunk stays small: this chunk downloads in parallel with
// the auth + membership round-trips instead of blocking them on mobile.
const importIndex = () => import("./pages/Index");
const Index = lazy(importIndex);

// A returning signed-in user needs this chunk the moment auth resolves, so
// start fetching it alongside the auth round-trip instead of after it. Skipped
// when no session is stored so the sign-in screen doesn't drag the whole app
// down with it.
const hasStoredSession = () => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith("sb-") && key.endsWith("-auth-token")) return true;
    }
  } catch {
    // localStorage can throw in private/sandboxed contexts.
  }
  // Clerk keeps its session in a cookie rather than localStorage, so without
  // this a Clerk user loses the head-start entirely and waits for the chunk
  // after auth resolves instead of alongside it.
  try {
    if (document.cookie.includes("__session")) return true;
  } catch {
    // Cookie access can throw in sandboxed contexts too.
  }
  return false;
};
if (hasStoredSession()) void importIndex();
const AuthLegacy = lazy(() => import("./pages/AuthLegacy"));
const ClerkAccountNotLinked = lazy(() => import("./pages/ClerkAccountNotLinked"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const TeamSettings = lazy(() => import("./pages/TeamSettings"));
const ManagerScreen = lazy(() => import("./pages/ManagerScreen"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const UserGuide = lazy(() => import("./pages/UserGuide"));
const SuperuserYoutube = lazy(() => import("./pages/SuperuserYoutube"));
const BellsAndWhistles = lazy(() => import("./pages/BellsAndWhistles"));

const queryClient = new QueryClient();

function AppRoutes() {
  const { user, loading: authLoading, unlinkedClerk, signOut } = useAuth();
  const { memberships, activeOrgId, loading: orgLoading, loadMemberships } = useOrgStore();
  const location = useLocation();
  const isResetPasswordRoute = location.pathname === "/reset-password";
  const retriedAppLoadRef = useRef<string | null>(null);
  const retriedMembershipLoadRef = useRef<string | null>(null);

  useEffect(() => {
    if (user?.id && !isResetPasswordRoute) {
      loadMemberships(user.id);
    }
    // Only re-run when the authenticated user id actually changes — not on
    // every new User object reference produced by TOKEN_REFRESHED, etc.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, isResetPasswordRoute]);

  // On mobile, iOS Safari can restore the page from bfcache while orgLoading
  // is still true (the in-flight RPC was silently cancelled by the OS and the
  // safety setTimeout is paused).  Re-trigger loadMemberships when the page
  // becomes visible so the app doesn't stay stuck on the loading screen.
  const orgLoadingRef = useRef(orgLoading);
  orgLoadingRef.current = orgLoading;
  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      // 1) Memberships still loading → re-trigger.
      if (orgLoadingRef.current) {
        const key = `${userId}:visible`;
        if (retriedMembershipLoadRef.current !== key) {
          retriedMembershipLoadRef.current = key;
          loadMemberships(userId);
        }
        return;
      }
      // 2) Memberships done and an org is active, but the app store is
      //    empty (iOS Safari likely killed the in-flight fetch while the
      //    tab was backgrounded; the 15 s safety timeout flipped
      //    isLoading=false without populating any data).  Re-fetch so the
      //    backlog/work-item panels don't stay blank.
      const orgId = useOrgStore.getState().activeOrgId;
      const app = useAppStore.getState();
      // loadingProgress === -1 means the 15 s safety timeout fired without
      // populating data — retry the fetch.
      if (orgId && !app.isLoading && (Object.keys(app.backlogTrees).length === 0 || app.loadingProgress === -1)) {
        const retryKey = `${orgId}:${Object.keys(app.backlogTrees).length}:${app.loadingProgress}`;
        if (retriedAppLoadRef.current === retryKey) return;
        retriedAppLoadRef.current = retryKey;
        app.loadFromSupabase();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // loadMemberships is a stable Zustand reference; user.id is the key dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Initial-mount safety net: if the user lands on the app with an active
  // org but the app store ended up empty (e.g. the very first fetch was
  // killed mid-flight on a flaky mobile connection), kick off a retry once
  // the app is past the auth/org loading screens.
  useEffect(() => {
    if (authLoading || orgLoading || !user || !activeOrgId) return;
    const app = useAppStore.getState();
    if (!app.isLoading && (Object.keys(app.backlogTrees).length === 0 || app.loadingProgress === -1)) {
      const retryKey = `${activeOrgId}:${Object.keys(app.backlogTrees).length}:${app.loadingProgress}`;
      if (retriedAppLoadRef.current === retryKey) return;
      retriedAppLoadRef.current = retryKey;
      app.loadFromSupabase();
    }
    if (Object.keys(app.backlogTrees).length > 0 && app.loadingProgress === 100) {
      retriedAppLoadRef.current = null;
    }
  }, [authLoading, orgLoading, user?.id, activeOrgId]);

  useEffect(() => {
    retriedAppLoadRef.current = null;
    retriedMembershipLoadRef.current = null;
  }, [user?.id, activeOrgId]);

  useEffect(() => {
    const activeOrg = memberships.find(m => m.organization_id === activeOrgId) ?? null;
    document.title = activeOrg ? `${activeOrg.organization_name} – Agilefant²` : "Agilefant²";
  }, [memberships, activeOrgId]);

  if (authLoading || (user && orgLoading && !isResetPasswordRoute)) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  const pageFallback = (
    <div className="flex items-center justify-center h-screen bg-background" role="status" aria-live="polite">
      <p className="text-muted-foreground">Loading...</p>
    </div>
  );

  if (!user) {
    // A Clerk session that maps to no profile authenticates fine but reaches
    // no data, so say that instead of offering a sign-in form to somebody who
    // is already signed in. /auth/legacy stays open either way: a Supabase
    // session is not shadowed by an unlinked Clerk one, so it is still a way in.
    const notLinked = unlinkedClerk ? (
      <ClerkAccountNotLinked account={unlinkedClerk} onSignOut={signOut} />
    ) : null;
    return (
      <Suspense fallback={pageFallback}>
        <Routes>
          {/* The Clerk SignIn component throws outside ClerkProvider, and the
              provider is only mounted when a key is configured — so a build
              without one gets the Supabase form at /auth, not a blank screen. */}
          <Route path="/auth" element={notLinked ?? (clerkEnabled ? <Auth /> : <AuthLegacy />)} />
          {/* Clerk starts with no users at all, so during the migration every
              account — including the one being moved over — has to be created
              here first and then linked to its existing profile. */}
          <Route
            path="/auth/sign-up"
            element={notLinked ?? (clerkEnabled ? <Auth mode="sign-up" /> : <Navigate to="/auth/legacy" replace />)}
          />
          <Route path="/auth/legacy" element={<AuthLegacy />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/user-guide" element={<UserGuide />} />
          <Route path="*" element={notLinked ?? <Navigate to="/auth" replace />} />
        </Routes>
      </Suspense>
    );
  }

  if (memberships.length === 0) {
    return (
      <Suspense fallback={pageFallback}>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/user-guide" element={<UserGuide />} />
          <Route path="*" element={<Navigate to="/onboarding" replace />} />
        </Routes>
      </Suspense>
    );
  }

  return (
    <Suspense fallback={pageFallback}>
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/settings/team" element={<TeamSettings />} />
        <Route path="/settings/bells-whistles" element={<BellsAndWhistles />} />
        <Route path="/manager" element={<ManagerScreen />} />
        <Route path="/superuser/youtube" element={<SuperuserYoutube />} />
        <Route path="/user-guide" element={<UserGuide />} />
        {/* Every sign-in route, not just /auth: reaching /auth/legacy or
            /auth/sign-up while already signed in used to fall through to the
            catch-all and show a 404. The splat also matches bare /auth. */}
        <Route path="/auth/*" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
