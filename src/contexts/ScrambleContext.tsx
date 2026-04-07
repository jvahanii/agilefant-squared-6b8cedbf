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
      .then(({ data }) => setIsSuperuser(data?.is_superuser ?? false));
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
