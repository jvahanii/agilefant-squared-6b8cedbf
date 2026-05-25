import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { BellsAndWhistlesSection } from "@/components/BellsAndWhistlesSection";

export default function BellsAndWhistlesPage() {
  const navigate = useNavigate();
  const memberships = useOrgStore((s) => s.memberships);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const roleOverride = useOrgStore((s) => s.roleOverride);
  const activeOrg = (() => {
    const m = memberships.find((x) => x.organization_id === activeOrgId) ?? null;
    return m && roleOverride ? { ...m, role: roleOverride } : m;
  })();
  const appIsLoading = useAppStore((s) => s.isLoading);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        navigate("/");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate]);

  if (appIsLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background" role="status" aria-live="polite">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              Bells &amp; Whistles{activeOrg ? ` — ${activeOrg.organization_name}` : ""}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              You really don't need any of these, but many other tools have them. Agilefant strives to offer them with elegance others will want to copy.
            </p>
          </div>
        </div>

        <BellsAndWhistlesSection showHeader={false} />
      </div>
    </div>
  );
}
