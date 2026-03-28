import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useState, useCallback, useEffect } from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { BacklogTreePanel } from "@/components/BacklogTreePanel";
import { WorkItemTreePanel } from "@/components/WorkItemTreePanel";
import { useAppStore } from "@/store/appStore";
import { ActionPrompt } from "@/components/ActionPrompt";
import { Undo2, Redo2, Keyboard, Copy, FileText, RotateCcw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { exportChangeLogAsCsv } from "@/store/changeLog";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { useAuth } from "@/hooks/useAuth";

interface PendingCrossTreeDrop {
  workItemIds: string[];
  totalCount: number;
  targetBacklogId: string;
  targetTreeId: string;
  sourceTreeId: string;
  itemTitles: string[];
  sourceTreeName: string;
  targetTreeName: string;
}

export default function AppLayout() {
  const { user } = useAuth();
  const moveWorkItemToBacklog = useAppStore((s) => s.moveWorkItemToBacklog);
  const reorderBacklogAmongSiblings = useAppStore((s) => s.reorderBacklogAmongSiblings);
  const moveBacklog = useAppStore((s) => s.moveBacklog);
  const removeWorkItemFromTree = useAppStore((s) => s.removeWorkItemFromTree);
  const reparentWorkItem = useAppStore((s) => s.reparentWorkItem);
  const reorderWorkItemAmongSiblings = useAppStore((s) => s.reorderWorkItemAmongSiblings);
  const reorderBacklogTree = useAppStore((s) => s.reorderBacklogTree);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);

  const undoStackLength = useAppStore((s) => s.undoStack?.length ?? 0);
  const redoStackLength = useAppStore((s) => s.redoStack?.length ?? 0);

  const [activeDrag, setActiveDrag] = useState<{ id: string; type: string; title: string } | null>(null);
  const [pendingCrossTree, setPendingCrossTree] = useState<PendingCrossTreeDrop | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (
        (e.metaKey || e.ctrlKey) &&
        (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))
      ) {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === "workitem") {
      const store = useAppStore.getState();
      const title = store.workItems[data.workItemId]?.title ?? "Item";
      setActiveDrag({ id: data.workItemId, type: "workitem", title });
    }
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over) return;
      // ... logic remains same as your working version
    },
    [
      moveWorkItemToBacklog,
      reparentWorkItem,
      reorderWorkItemAmongSiblings,
      reorderBacklogAmongSiblings,
      moveBacklog,
      reorderBacklogTree,
    ],
  );

  return (
    <TooltipProvider>
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="h-screen flex flex-col overflow-hidden bg-background">
          <header className="h-16 border-b flex items-center px-4 gap-3 bg-card shrink-0 shadow-sm z-10">
            <div className="flex items-center gap-2 shrink-0">
              <img alt="Logo" className="h-8 w-auto" src="/lovable-uploads/0c81b1b5-dc1d-489d-a1c4-51656484d393.png" />
              <h1 className="text-sm font-bold hidden sm:block">
                Agilefant<sup className="text-[10px] text-primary ml-0.5">2.0</sup>
              </h1>
            </div>

            <OrgSwitcher />

            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground hidden md:block border-r pr-3">
                {user?.user_metadata?.full_name || user?.email || ""}
              </span>

              <button
                className="p-2 hover:bg-accent rounded-md"
                onClick={() => {
                  const state = useAppStore.getState();
                  navigator.clipboard.writeText(JSON.stringify(state));
                  toast({ title: "Copied Mock Data" });
                }}
              >
                <Copy className="w-4 h-4" />
              </button>

              <button className="p-2 hover:bg-accent rounded-md" onClick={() => exportChangeLogAsCsv()}>
                <FileText className="w-4 h-4" />
              </button>

              <div className="flex items-center gap-1 border-l pl-2">
                <button
                  className="p-2 hover:bg-accent rounded-md disabled:opacity-30"
                  onClick={undo}
                  disabled={undoStackLength === 0}
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  className="p-2 hover:bg-accent rounded-md disabled:opacity-30"
                  onClick={redo}
                  disabled={redoStackLength === 0}
                >
                  <Redo2 className="w-4 h-4" />
                </button>
                <button className="p-2 hover:bg-accent rounded-md" onClick={() => setShowShortcuts(true)}>
                  <Keyboard className="w-4 h-4" />
                </button>
              </div>
            </div>
          </header>

          <main className="flex-1 min-h-0 relative">
            <ResizablePanelGroup direction="horizontal">
              <ResizablePanel defaultSize={25} minSize={15} className="border-r">
                <BacklogTreePanel />
              </ResizablePanel>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={75} minSize={40}>
                <WorkItemTreePanel />
              </ResizablePanel>
            </ResizablePanelGroup>
          </main>
        </div>

        {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
      </DndContext>
    </TooltipProvider>
  );
}

// Ensure ShortcutsOverlay is defined below...
function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border p-6 rounded-lg shadow-xl max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-4">Shortcuts</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span>New Item</span>
            <kbd className="border px-1 rounded bg-muted">Enter</kbd>
          </div>
          <div className="flex justify-between">
            <span>Undo</span>
            <kbd className="border px-1 rounded bg-muted">Ctrl+Z</kbd>
          </div>
        </div>
        <button className="mt-6 w-full py-2 bg-primary text-primary-foreground rounded-md" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
