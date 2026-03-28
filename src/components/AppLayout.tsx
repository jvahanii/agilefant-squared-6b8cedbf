import { useAppStore } from "@/store/appStore";
import { Undo2, Redo2, Keyboard, Copy, FileText, LogOut } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { exportChangeLogAsCsv } from "@/store/changeLog";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { useAuth } from "@/hooks/useAuth";

export function Header() {
  const { user, signOut } = useAuth();
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const undoStackLength = useAppStore((s) => s.undoStack?.length ?? 0);
  const redoStackLength = useAppStore((s) => s.redoStack?.length ?? 0);

  const copyMockData = () => {
    const { workItems, backlogs, backlogTrees } = useAppStore.getState();
    const data = JSON.stringify({ workItems, backlogs, backlogTrees }, null, 2);
    navigator.clipboard.writeText(`const data = ${data};`);
    toast({ title: "Mock data copied to clipboard" });
  };

  return (
    <TooltipProvider>
      <header className="h-16 border-b flex items-center px-4 gap-3 bg-card shrink-0 shadow-sm z-10 w-full">
        {/* Left Side: Logo and Title */}
        <div className="flex items-center gap-2 shrink-0">
          <img
            alt="Agilefant"
            className="h-10 w-auto"
            src="/lovable-uploads/0c81b1b5-dc1d-489d-a1c4-51656484d393.png"
          />
          <h1 className="text-sm font-bold tracking-tight hidden sm:block">
            Agilefant
            <sup className="text-xs text-primary ml-0.5 font-mono">2.0</sup>
          </h1>
        </div>

        <OrgSwitcher />

        {/* Right Side: Actions and User */}
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground mr-2 border-r pr-3 hidden md:inline-block">
            {user?.user_metadata?.full_name || user?.email || ""}
          </span>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
                onClick={copyMockData}
              >
                <Copy className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Export Mock Data</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
                onClick={() => exportChangeLogAsCsv()}
              >
                <FileText className="w-4 h-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Export Change Log (CSV)</TooltipContent>
          </Tooltip>

          {/* Undo/Redo/Help Group */}
          <div className="flex items-center gap-1 border-l pl-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`p-2 rounded-md transition-colors ${undoStackLength > 0 ? "text-foreground hover:bg-accent" : "text-muted-foreground/30"}`}
                  onClick={undo}
                  disabled={undoStackLength === 0}
                >
                  <Undo2 className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={`p-2 rounded-md transition-colors ${redoStackLength > 0 ? "text-foreground hover:bg-accent" : "text-muted-foreground/30"}`}
                  onClick={redo}
                  disabled={redoStackLength === 0}
                >
                  <Redo2 className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
                  onClick={() => window.dispatchEvent(new CustomEvent("shortcut:toggle-help"))}
                >
                  <Keyboard className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Keyboard Shortcuts (?)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors ml-1"
                  onClick={() => signOut?.()}
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Log Out</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </header>
    </TooltipProvider>
  );
}
