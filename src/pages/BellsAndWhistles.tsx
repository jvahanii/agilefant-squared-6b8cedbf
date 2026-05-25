import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Sparkles } from "lucide-react";
import { useOrgStore } from "@/store/orgStore";
import { BellsAndWhistlesSection } from "@/components/BellsAndWhistlesSection";

export default function BellsAndWhistlesPage() {
  const navigate = useNavigate();
  const activeOrg = useOrgStore((s) => s.getActiveOrg());

  // appStore data (backlogTrees, backlogs) is loaded by the module-level
  // orgStore subscriber in App.tsx, which fires before this component mounts.

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
