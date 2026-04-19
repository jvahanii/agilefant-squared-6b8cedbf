import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useOrgStore } from "@/store/orgStore";
import { lazy, Suspense, useEffect } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Auth = lazy(() => import("./pages/Auth"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const TeamSettings = lazy(() => import("./pages/TeamSettings"));
const ManagerScreen = lazy(() => import("./pages/ManagerScreen"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const UserGuide = lazy(() => import("./pages/UserGuide"));

const queryClient = new QueryClient();

function AppRoutes() {
  const { user, loading: authLoading } = useAuth();
  const { memberships, activeOrgId, loading: orgLoading, loadMemberships } = useOrgStore();

  useEffect(() => {
    if (user) {
      loadMemberships(user.id);
    }
  }, [user]);

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
    <div className="flex items-center justify-center h-screen bg-background">
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
        <Route path="/manager" element={<ManagerScreen />} />
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
