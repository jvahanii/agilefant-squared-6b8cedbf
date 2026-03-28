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
import { Undo2, Redo2, Keyboard, Copy, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  const undoStackLength = useAppStore((s) => s.undoStack.length);
  const redoStackLength = useAppStore((s) => s.redoStack.length);

  const [activeDrag, setActiveDrag] = useState<{ id: string; type: string; title: string } | null>(null);
  const [pendingCrossTree, setPendingCrossTree] = useState<PendingCrossTreeDrop | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }

      if (isInput) return;

      const state = useAppStore.getState();

      switch (e.key.toLowerCase()) {
        case "t": {
          if (state.selectedWorkItemIds.length > 0 && state.selectedTreeId && state.selectedBacklogIds.length > 0) {
            e.preventDefault();
            // Pass 0 to move to top
            state.selectedWorkItemIds.forEach((id) => {
              state.reorderWorkItemAmongSiblings(id, 0, state.selectedTreeId!, state.selectedBacklogIds);
            });
            toast({ title: `Moved ${state.selectedWorkItemIds.length} items to top` });
          }
          break;
        }
        case "b": {
          if (state.selectedWorkItemIds.length > 0 && state.selectedTreeId && state.selectedBacklogIds.length > 0) {
            e.preventDefault();
            // Pass a very high index to move to bottom
            state.selectedWorkItemIds.forEach((id) => {
              state.reorderWorkItemAmongSiblings(id, 999999, state.selectedTreeId!, state.selectedBacklogIds);
            });
            toast({ title: `Moved ${state.selectedWorkItemIds.length} items to bottom` });
          }
          break;
        }
        case "enter": {
          e.preventDefault();
          if (e.shiftKey) {
            if (state.selectedWorkItemIds.length > 0) {
              window.dispatchEvent(new CustomEvent("shortcut:add-child-workitem"));
            }
          } else {
            window.dispatchEvent(new CustomEvent("shortcut:add-workitem"));
          }
          break;
        }
        case "delete":
        case "backspace": {
          if (state.selectedWorkItemIds.length > 0) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("shortcut:delete-selected"));
          }
          break;
        }
        case "?": {
          e.preventDefault();
          setShowShortcuts((s) => !s);
          break;
        }
        case "escape": {
          if (state.selectedWorkItemIds.length > 0) {
            useAppStore.getState().clearWorkItemSelection();
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const countWithDescendants = useCallback((ids: string[]) => {
    const store = useAppStore.getState();
    const seen = new Set<string>();
    const collect = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      store.workItems[id]?.childrenIds.forEach(collect);
    };
    ids.forEach(collect);
    return seen.size;
  }, []);

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const data = event.active.data.current;
      if (data?.type === "workitem") {
        const store = useAppStore.getState();
        const ids: string[] = data.selectedIds ?? [data.workItemId];
        const totalCount = countWithDescendants(ids);
        const title =
          totalCount > 1
            ? `${store.workItems[ids[0]]?.title} (+${totalCount - 1} more)`
            : (store.workItems[ids[0]]?.title ?? "");
        setActiveDrag({ id: data.workItemId, type: "workitem", title });
      } else if (data?.type === "backlog-node") {
        const store = useAppStore.getState();
        setActiveDrag({ id: data.backlogId, type: "backlog-node", title: store.backlogs[data.backlogId]?.name ?? "" });
      }
    },
    [countWithDescendants],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over) return;

      const activeData = active.data.current;
      const overData = over.data.current;
      const draggedIds: string[] = activeData?.selectedIds ?? [activeData?.workItemId];

      if (activeData?.type === "workitem" && overData?.type === "backlog") {
        const sourceTreeId = activeData.treeId as string;
        const targetTreeId = overData.treeId as string;

        if (sourceTreeId !== targetTreeId) {
          const store = useAppStore.getState();
          setPendingCrossTree({
            workItemIds: draggedIds,
            totalCount: countWithDescendants(draggedIds),
            targetBacklogId: overData.backlogId,
            targetTreeId,
            sourceTreeId,
            itemTitles: draggedIds.map((id) => store.workItems[id]?.title),
            sourceTreeName: store.backlogTrees[sourceTreeId]?.name ?? "Source",
            targetTreeName: store.backlogTrees[targetTreeId]?.name ?? "Target",
          });
        } else {
          draggedIds.forEach((id) => moveWorkItemToBacklog(id, overData.backlogId, overData.treeId));
        }
      } else if (activeData?.type === "workitem" && overData?.type === "workitem-reorder") {
        const targetParentId = overData.parentId as string | null;
        draggedIds.forEach((id) => {
          reparentWorkItem(id, targetParentId, overData.treeId, overData.backlogIds[0]);
          reorderWorkItemAmongSiblings(id, overData.index, overData.treeId, overData.backlogIds);
        });
      } else if (activeData?.type === "backlog-node" && overData?.type === "backlog-reorder") {
        reorderBacklogAmongSiblings(activeData.backlogId, overData.index, overData.parentId, overData.treeId);
      }
    },
    [
      moveWorkItemToBacklog,
      reparentWorkItem,
      reorderWorkItemAmongSiblings,
      reorderBacklogAmongSiblings,
      countWithDescendants,
    ],
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-screen flex flex-col overflow-hidden bg-background">
        <header className="h-16 border-b flex items-center px-4 gap-3 bg-card shrink-0 shadow-sm z-10">
          <img
            alt="Agilefant"
            className="h-10 w-auto"
            src="/lovable-uploads/0c81b1b5-dc1d-489d-a1c4-51656484d393.png"
          />
          <h1 className="text-sm font-bold tracking-tight">
            Agilefant<sup className="text-xs text-primary ml-0.5 font-mono">2.0</sup>
          </h1>
          <OrgSwitcher />

          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-2 border-r pr-3 hidden md:inline-block">
              {user?.email || ""}
            </span>

            <button
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5"
              onClick={async () => {
                try {
                  const { workItems, backlogs, backlogTrees } = useAppStore.getState();
                  const exportData = { workItems, backlogs, backlogTrees };
                  const code = `// Auto-exported mock data\nconst data = ${JSON.stringify(exportData, null, 2)};`;

                  try {
                    await navigator.clipboard.writeText(code);
                    toast({ title: "Success!", description: "Data copied to clipboard." });
                  } catch (clipErr) {
                    console.log("Clipboard blocked. Data:", exportData);
                    toast({
                      variant: "destructive",
                      title: "Clipboard Blocked",
                      description: "Data logged to Console (F12) instead.",
                    });
                  }
                } catch (err) {
                  toast({
                    variant: "destructive",
                    title: "Export Error",
                    description: "Circular references detected.",
                  });
                }
              }}
            >
              <Copy className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Export Mock</span>
            </button>

            <div className="flex items-center gap-1 border-l pl-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={`w-8 h-8 flex items-center justify-center rounded-md ${undoStackLength > 0 ? "text-foreground hover:bg-accent" : "text-muted-foreground/30"}`}
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
                    className={`w-8 h-8 flex items-center justify-center rounded-md ${redoStackLength > 0 ? "text-foreground hover:bg-accent" : "text-muted-foreground/30"}`}
                    onClick={redo}
                    disabled={redoStackLength === 0}
                  >
                    <Redo2 className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
              </Tooltip>

              <button
                className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent"
                onClick={() => setShowShortcuts((s) => !s)}
              >
                <Keyboard className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 min-h-0 relative">
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={25} minSize={15} maxSize={40} className="border-r">
              <div className="h-full overflow-hidden">
                <BacklogTreePanel />
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={75} minSize={40}>
              <div className="h-full overflow-hidden flex flex-col">
                <WorkItemTreePanel />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </main>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag && (
          <div className="bg-card border-2 border-primary/20 shadow-2xl rounded-lg px-4 py-2 text-sm font-semibold max-w-xs truncate ring-2 ring-background">
            {activeDrag.title}
          </div>
        )}
      </DragOverlay>

      {pendingCrossTree && (
        <ActionPrompt
          title={`Move ${pendingCrossTree.totalCount} items to ${pendingCrossTree.targetTreeName}`}
          options={[
            {
              label: "Move",
              description: `Switch from ${pendingCrossTree.sourceTreeName}.`,
              value: "move",
              isDefault: true,
            },
            { label: "Mirror", description: `Keep in both views.`, value: "add" },
          ]}
          onSelect={(val) => {
            pendingCrossTree.workItemIds.forEach((id) => {
              moveWorkItemToBacklog(id, pendingCrossTree.targetBacklogId, pendingCrossTree.targetTreeId);
              if (val === "move") removeWorkItemFromTree(id, pendingCrossTree.sourceTreeId);
            });
            setPendingCrossTree(null);
          }}
          onCancel={() => setPendingCrossTree(null)}
        />
      )}

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </DndContext>
  );
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { keys: ["Enter"], desc: "New item at Top" },
    { keys: ["Shift", "Enter"], desc: "New child item" },
    { keys: ["T"], desc: "Rank selection to Top" },
    { keys: ["B"], desc: "Rank selection to Bottom" },
    { keys: ["Ctrl", "Z"], desc: "Undo" },
    { keys: ["Ctrl", "Y"], desc: "Redo" },
    { keys: ["?"], desc: "Toggle help" },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border shadow-2xl w-full max-w-sm mx-4 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b bg-muted/30 font-bold flex items-center gap-2">
          <Keyboard className="w-4 h-4" /> Shortcuts
        </div>
        <div className="px-6 py-4 space-y-3">
          {shortcuts.map((s, i) => (
            <div key={i} className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{s.desc}</span>
              <div className="flex gap-1">
                {s.keys.map((k, j) => (
                  <kbd key={j} className="px-1.5 py-1 rounded border bg-muted font-mono">
                    {k}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-3 bg-muted/20 border-t text-center">
          <button onClick={onClose} className="text-xs font-semibold text-primary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
