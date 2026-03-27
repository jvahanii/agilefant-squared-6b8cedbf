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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { BacklogTreePanel } from "@/components/BacklogTreePanel";
import { WorkItemTreePanel } from "@/components/WorkItemTreePanel";
import { useAppStore } from "@/store/appStore";
import { ActionPrompt } from "@/components/ActionPrompt";
import { Undo2, Redo2, Keyboard, RotateCcw, Copy, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { exportChangeLogAsCsv, getChangeLog } from "@/store/changeLog";
import agilefantLogo from "@/assets/agilefant-logo.png";
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

      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "y")) {
        e.preventDefault();
        redo();
        return;
      }

      if (isInput) return;

      const state = useAppStore.getState();

      switch (e.key) {
        case "Enter": {
          if (e.shiftKey) {
            e.preventDefault();
            if (state.selectedWorkItemIds.length > 0) {
              window.dispatchEvent(new CustomEvent("shortcut:add-child-workitem"));
            } else if (state.selectedBacklogIds.length > 0) {
              window.dispatchEvent(new CustomEvent("shortcut:add-child-backlog"));
            }
          } else {
            e.preventDefault();
            if (state.selectedBacklogIds.length > 0 && state.selectedTreeId) {
              window.dispatchEvent(new CustomEvent("shortcut:add-workitem"));
            }
          }
          break;
        }
        case "Delete":
        case "Backspace": {
          if (state.selectedWorkItemIds.length > 0 || state.selectedBacklogIds.length > 0) {
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
        case "Escape": {
          if (state.selectedWorkItemIds.length > 0) {
            useAppStore.getState().clearWorkItemSelection();
          }
          break;
        }
        case "ArrowUp":
        case "ArrowDown": {
          if (state.selectedWorkItemIds.length === 1 && state.selectedTreeId && state.selectedBacklogIds.length > 0) {
            e.preventDefault();
            const wiId = state.selectedWorkItemIds[0];
            const wi = state.workItems[wiId];
            if (!wi) break;
            const treeId = state.selectedTreeId;
            const selectedBacklogId = state.selectedBacklogIds[0];

            const backlogIds: string[] = [];
            const collectBacklogs = (id: string) => {
              backlogIds.push(id);
              state.backlogs[id]?.childrenIds.forEach(collectBacklogs);
            };
            collectBacklogs(selectedBacklogId);

            const backlogIdSet = new Set(backlogIds);
            const siblings = Object.values(state.workItems)
              .filter((w) => {
                if (!backlogIdSet.has(w.backlogAssignments[treeId])) return false;
                if (wi.parentId === null) {
                  return (
                    w.parentId === null ||
                    !state.workItems[w.parentId] ||
                    !backlogIdSet.has(state.workItems[w.parentId].backlogAssignments[treeId])
                  );
                }
                return w.parentId === wi.parentId;
              })
              .sort((a, b) => a.rank - b.rank);

            const idx = siblings.findIndex((s) => s.id === wiId);
            if (idx === -1) break;
            const newIdx = e.key === "ArrowUp" ? idx - 1 : idx + 1;
            if (newIdx < 0 || newIdx >= siblings.length) break;
            useAppStore.getState().reorderWorkItemAmongSiblings(wiId, newIdx, treeId, backlogIds);
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
        const titles = ids.map((id) => store.workItems[id]?.title ?? "").filter(Boolean);
        const title = totalCount > 1 ? `${titles[0]} (+${totalCount - 1} more)` : (titles[0] ?? "");
        setActiveDrag({ id: data.workItemId, type: "workitem", title });
      } else if (data?.type === "backlog-node") {
        const store = useAppStore.getState();
        const bl = store.backlogs[data.backlogId];
        setActiveDrag({ id: data.backlogId, type: "backlog-node", title: bl?.name ?? "" });
      } else if (data?.type === "tree-node") {
        const store = useAppStore.getState();
        const tree = store.backlogTrees[data.treeId];
        setActiveDrag({ id: data.treeId, type: "tree-node", title: tree?.name ?? "" });
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
          const sourceTree = store.backlogTrees[sourceTreeId];
          const targetTree = store.backlogTrees[targetTreeId];
          const titles = draggedIds.map((id) => store.workItems[id]?.title ?? "").filter(Boolean);
          setPendingCrossTree({
            workItemIds: draggedIds,
            totalCount: countWithDescendants(draggedIds),
            targetBacklogId: overData.backlogId,
            targetTreeId,
            sourceTreeId,
            itemTitles: titles,
            sourceTreeName: sourceTree?.name ?? sourceTreeId,
            targetTreeName: targetTree?.name ?? targetTreeId,
          });
        } else {
          draggedIds.forEach((id) => moveWorkItemToBacklog(id, overData.backlogId, overData.treeId));
        }
      } else if (activeData?.type === "workitem" && overData?.type === "workitem-parent") {
        const targetId = overData.workItemId;
        draggedIds
          .filter((id) => id !== targetId)
          .forEach((id) => {
            reparentWorkItem(id, targetId, overData.treeId, overData.backlogId);
          });
      } else if (activeData?.type === "workitem" && overData?.type === "workitem-root") {
        draggedIds.forEach((id) => {
          reparentWorkItem(id, null, overData.treeId, overData.backlogId);
        });
      } else if (activeData?.type === "workitem" && overData?.type === "workitem-reorder") {
        const targetParentId = overData.parentId as string | null;
        const treeId = overData.treeId as string;
        const backlogIds = overData.backlogIds as string[];
        const store = useAppStore.getState();

        draggedIds.forEach((id) => {
          const wi = store.workItems[id];
          if (!wi) return;
          if (wi.parentId !== targetParentId) {
            const backlogId = backlogIds[0] ?? "";
            reparentWorkItem(id, targetParentId, treeId, backlogId);
          }
        });
        draggedIds.forEach((id) => {
          reorderWorkItemAmongSiblings(id, overData.index as number, treeId, backlogIds);
        });
      } else if (activeData?.type === "backlog-node" && overData?.type === "backlog-reorder") {
        const backlogId = activeData.backlogId as string;
        const targetParentId = overData.parentId as string | null;
        const treeId = overData.treeId as string;
        const targetIndex = overData.index as number;
        const store = useAppStore.getState();
        const isDescendant = (parentId: string | null, checkId: string): boolean => {
          if (!parentId) return false;
          if (parentId === checkId) return true;
          return isDescendant(store.backlogs[parentId]?.parentId ?? null, checkId);
        };
        if (targetParentId && isDescendant(targetParentId, backlogId)) return;
        reorderBacklogAmongSiblings(backlogId, targetIndex, targetParentId, treeId);
      } else if (activeData?.type === "backlog-node" && overData?.type === "backlog") {
        const backlogId = activeData.backlogId as string;
        const targetBacklogId = overData.backlogId as string;
        const treeId = overData.treeId as string;
        if (backlogId === targetBacklogId) return;
        const store = useAppStore.getState();
        const isDescendant = (id: string): boolean => {
          const bl = store.backlogs[id];
          if (!bl) return false;
          if (bl.parentId === backlogId) return true;
          if (bl.parentId) return isDescendant(bl.parentId);
          return false;
        };
        if (isDescendant(targetBacklogId)) return;
        if (activeData.treeId !== treeId) return;
        moveBacklog(backlogId, targetBacklogId, treeId);
      } else if (activeData?.type === "tree-node" && overData?.type === "tree-reorder") {
        const treeId = activeData.treeId as string;
        const targetIndex = overData.index as number;
        reorderBacklogTree(treeId, targetIndex);
      }
    },
    [
      moveWorkItemToBacklog,
      reparentWorkItem,
      reorderWorkItemAmongSiblings,
      reorderBacklogAmongSiblings,
      moveBacklog,
      reorderBacklogTree,
      countWithDescendants,
    ],
  );

  const handleCrossTreeChoice = useCallback(
    (value: string) => {
      if (!pendingCrossTree) return;
      const { workItemIds, targetBacklogId, targetTreeId, sourceTreeId } = pendingCrossTree;

      workItemIds.forEach((id) => {
        if (value === "move") {
          moveWorkItemToBacklog(id, targetBacklogId, targetTreeId);
          removeWorkItemFromTree(id, sourceTreeId);
        } else if (value === "add") {
          moveWorkItemToBacklog(id, targetBacklogId, targetTreeId);
        }
      });
      setPendingCrossTree(null);
    },
    [pendingCrossTree, moveWorkItemToBacklog, removeWorkItemFromTree],
  );

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-screen flex flex-col">
        <header className="h-16 border-b flex items-center px-4 gap-3 bg-card shrink-0 py-0">
          <img
            alt="Agilefant"
            className="h-12 bg-destructive-foreground shadow-none"
            src="/lovable-uploads/0c81b1b5-dc1d-489d-a1c4-51656484d393.png"
          />
          <h1 className="text-sm font-bold tracking-tight">
            Agilefant
            <sup className="text-xs text-primary">2</sup>
          </h1>
          <OrgSwitcher />
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-muted-foreground truncate max-w-48">
              {user?.user_metadata?.full_name || user?.email || ""}
            </span>
            <button
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
              onClick={() => {
                const { workItems, backlogs, backlogTrees } = useAppStore.getState();
                const code = `// Auto-exported mock data\nimport { WorkItem, Backlog, BacklogTree } from '@/types/models';\n\nexport function generateMockData() {\n  const workItems: Record<string, WorkItem> = ${JSON.stringify(workItems, null, 2)};\n\n  const backlogs: Record<string, Backlog> = ${JSON.stringify(backlogs, null, 2)};\n\n  const backlogTrees: Record<string, BacklogTree> = ${JSON.stringify(backlogTrees, null, 2)};\n\n  return { workItems, backlogs, backlogTrees };\n}\n`;
                navigator.clipboard.writeText(code);
                toast({ title: "Mock data copied to clipboard!" });
              }}
              title="Export data"
            >
              <Copy className="w-3.5 h-3.5" />
              Export data
            </button>
            <button
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
              onClick={() => {
                const log = getChangeLog();
                if (log.length === 0) {
                  toast({ title: "No changes recorded yet" });
                  return;
                }
                const csv = exportChangeLogAsCsv();
                const blob = new Blob([csv], { type: "text/csv" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `changelog-${new Date().toISOString().slice(0, 10)}.csv`;
                a.click();
                URL.revokeObjectURL(url);
                toast({ title: `Exported ${log.length} change log entries` });
              }}
              title="Export data change log"
            >
              <FileText className="w-3.5 h-3.5" />
              Export data change log
            </button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
                  title="Reset to mock data"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset data
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-destructive font-bold text-lg">DANGER ZONE!</AlertDialogTitle>
                  <AlertDialogDescription className="text-sm">
                    Are you sure you want to wipe all data and reset it to example data?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => useAppStore.getState().resetToMockData()}
                  >
                    Reset all data
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  onClick={() => setShowShortcuts((s) => !s)}
                  title="Keyboard shortcuts (?)"
                >
                  <Keyboard className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
            </Tooltip>
            <button
              className={`
                w-8 h-8 flex items-center justify-center rounded-md transition-colors