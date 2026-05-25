import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { lazy, Suspense, useEffect, useRef } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import Index from "./pages/Index";
import Auth from "./pages/Auth";

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
  const { user, loading: authLoading } = useAuth();
  const { memberships, activeOrgId, loading: orgLoading, loadMemberships } = useOrgStore();

  useEffect(() => {
    if (user) {
      loadMemberships(user.id);
    }
  }, [user]);

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
      if (document.visibilityState !== 'visible' || !orgLoadingRef.current) return;
      loadMemberships(userId);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // loadMemberships is a stable Zustand reference; user.id is the key dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    const activeOrg = memberships.find(m => m.organization_id === activeOrgId) ?? null;
    document.title = activeOrg ? `${activeOrg.organization_name} – Agilefant²` : "Agilefant²";
  }, [memberships, activeOrgId]);

  if (authLoading || (user && orgLoading)) {
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
    return (
      <Suspense fallback={pageFallback}>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/user-guide" element={<UserGuide />} />
          <Route path="*" element={<Navigate to="/auth" replace />} />
        </Routes>
      </Suspense>
    );
  }

  if (memberships.length === 0) {
    return (
      <Suspense fallback={pageFallback}>
        <Routes>
          <Route path="/onboarding" element={<Onboarding />} />
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
        <Route path="/settings/team" element={<TeamSettings />} />
        <Route path="/settings/bells-whistles" element={<BellsAndWhistles />} />
        <Route path="/manager" element={<ManagerScreen />} />
        <Route path="/superuser/youtube" element={<SuperuserYoutube />} />
        <Route path="/user-guide" element={<UserGuide />} />
        <Route path="/auth" element={<Navigate to="/" replace />} />
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
