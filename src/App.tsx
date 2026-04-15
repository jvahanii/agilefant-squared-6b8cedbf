import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useOrgStore } from "@/store/orgStore";
import { useEffect } from "react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";
import TeamSettings from "./pages/TeamSettings";
import ManagerScreen from "./pages/ManagerScreen";
import ResetPassword from "./pages/ResetPassword";
import UserGuide from "./pages/UserGuide";

const queryClient = new QueryClient();

function AppRoutes() {
  const { user, loading: authLoading } = useAuth();
  const { memberships, loading: orgLoading, loadMemberships } = useOrgStore();

  useEffect(() => {
    if (user) {
      loadMemberships(user.id);
    }
  }, [user]);

  if (authLoading || (user && orgLoading)) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/user-guide" element={<UserGuide />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    );
  }

  if (memberships.length === 0) {
    return (
      <Routes>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/user-guide" element={<UserGuide />} />
        <Route path="*" element={<Navigate to="/onboarding" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Index />} />
      <Route path="/settings/team" element={<TeamSettings />} />
      <Route path="/manager" element={<ManagerScreen />} />
      <Route path="/user-guide" element={<UserGuide />} />
      <Route path="/auth" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

const App = () => (
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
);

export default App;
