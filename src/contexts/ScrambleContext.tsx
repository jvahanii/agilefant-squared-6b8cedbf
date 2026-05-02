import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface ScrambleContextType {
  scrambleEnabled: boolean;
  toggleScramble: () => void;
  isSuperuser: boolean;
}

const ScrambleContext = createContext<ScrambleContextType>({
  scrambleEnabled: false,
  toggleScramble: () => {},
  isSuperuser: false,
});

export function ScrambleProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [isSuperuser, setIsSuperuser] = useState(false);
  const [scrambleEnabled, setScrambleEnabled] = useState(false);

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("is_superuser")
      .eq("id", user.id)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error("ScrambleContext: failed to fetch superuser status", error);
          return;
        }
        const su = data?.is_superuser ?? false;
        setIsSuperuser(su);
        // Security: only superusers may have a role override. Clear any
        // sessionStorage-injected override for non-superusers so that admin-only
        // UI sections don't render for plain members who tampered with storage.
        if (!su && typeof sessionStorage !== 'undefined') {
          if (sessionStorage.getItem('roleOverride')) {
            sessionStorage.removeItem('roleOverride');
            // Also clear the in-memory state in the org store
            import('@/store/orgStore').then(({ useOrgStore }) => {
              useOrgStore.setState({ roleOverride: null });
            });
          }
        }
      });
  }, [user?.id]);

  return (
    <ScrambleContext.Provider
      value={{
        scrambleEnabled,
        toggleScramble: () => setScrambleEnabled((v) => !v),
        isSuperuser,
      }}
    >
      {children}
    </ScrambleContext.Provider>
  );
}

export const useScramble = () => useContext(ScrambleContext);
