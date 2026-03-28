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
import { Undo2, Redo2, Keyboard, RotateCcw, Copy, FileText, SearchCheck, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { checkDataIntegrity, cleanseData, formatIssueReport } from "@/store/dataIntegrity";
import { exportChangeLogAsCsv, getChangeLog } from "@/store/changeLog";
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

      // Global Undo/Redo
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
          // Rank to Top
          if (state.selectedWorkItemIds.length > 0 && state.selectedTreeId && state.selectedBacklogIds.length > 0) {
            e.preventDefault();
            const treeId = state.selectedTreeId;
            const selectedBacklogId = state.selectedBacklogIds[0];
            const backlogIds: string[] = [];
            const collectBacklogs = (id: string) => {
              backlogIds.push(id);
              state.backlogs[id]?.childrenIds.forEach(collectBacklogs);
            };
            collectBacklogs(selectedBacklogId);

            // Move each selected item to index 0
            state.selectedWorkItemIds.forEach((id) => {
              state.reorderWorkItemAmongSiblings(id, 0, treeId, backlogIds);
            });
            toast({ title: `Moved ${state.selectedWorkItemIds.length} items to top` });
          }
          break;
        }
        case "b": {
          // Rank to Bottom
          if (state.selectedWorkItemIds.length > 0 && state.selectedTreeId && state.selectedBacklogIds.length > 0) {
            e.preventDefault();
            const treeId = state.selectedTreeId;
            const selectedBacklogId = state.selectedBacklogIds[0];
            const backlogIds: string[] = [];
            const collectBacklogs = (id: string) => {
              backlogIds.push(id);
              state.backlogs[id]?.childrenIds.forEach(collectBacklogs);
            };
            collectBacklogs(selectedBacklogId);

            // Move each to a very high index to force bottom placement
            state.selectedWorkItemIds.forEach((id) => {
              state.reorderWorkItemAmongSiblings(id, 999999, treeId, backlogIds);
            });
            toast({ title: `Moved ${state.selectedWorkItemIds.length} items to bottom` });
          }
          break;
        }
        case "enter": {
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
        case "delete":
        case "backspace": {
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
        case "escape": {
          if (state.selectedWorkItemIds.length > 0) {
            useAppStore.getState().clearWorkItemSelection();
          }
          break;
        }
        case "arrowup":
        case "arrowdown": {
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
  }, [undo, redo, moveWorkItemToBacklog, reorderWorkItemAmongSiblings]);

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
      <div className="h-screen flex flex-col overflow-hidden bg-background">
        <header className="h-16 border-b flex items-center px-4 gap-3 bg-card shrink-0 shadow-sm z-10">
          <img
            alt="Agilefant"
            className="h-10 w-auto"
            src="/lovable-uploads/0c81b1b5-dc1d-489d-a1c4-51656484d393.png"
          />
          <h1 className="text-sm font-bold tracking-tight">
            Agilefant
            <sup className="text-xs text-primary ml-0.5 font-mono">2.0</sup>
          </h1>
          <OrgSwitcher />

          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground mr-2 border-r pr-3 hidden md:inline-block">
              {user?.user_metadata?.full_name || user?.email || ""}
            </span>

            <button
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5"
              onClick={() => {
                const log = getChangeLog();
                if (log.length === 0) {
                  toast({ title: "No changes logged yet" });
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
            >
              <FileText className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Export Changelog</span>
            </button>

            <button
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5"
              onClick={() => {
                const { workItems, backlogs, backlogTrees } = useAppStore.getState();
                const code = `// Auto-exported mock data\nconst data = ${JSON.stringify({ workItems, backlogs, backlogTrees }, null, 2)};`;
                navigator.clipboard.writeText(code);
                toast({ title: "Data copied to clipboard" });
              }}
            >
              <Copy className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Export Mock</span>
            </button>

            <button
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5"
              onClick={() => {
                const { workItems, backlogs, backlogTrees } = useAppStore.getState();
                const issues: string[] = [];

                // Check work items
                Object.values(workItems).forEach((wi) => {
                  // Orphaned parent reference
                  if (wi.parentId && !workItems[wi.parentId]) {
                    issues.push(`Work item "${wi.title}" references missing parent ${wi.parentId}`);
                  }
                  // Children that don't exist
                  wi.childrenIds.forEach((cid) => {
                    if (!workItems[cid]) {
                      issues.push(`Work item "${wi.title}" lists missing child ${cid}`);
                    }
                  });
                  // Child doesn't point back
                  wi.childrenIds.forEach((cid) => {
                    const child = workItems[cid];
                    if (child && child.parentId !== wi.id) {
                      issues.push(`Work item "${wi.title}" lists child "${child.title}" but child's parent differs`);
                    }
                  });
                  // Parent doesn't list this item as child
                  if (wi.parentId && workItems[wi.parentId]) {
                    if (!workItems[wi.parentId].childrenIds.includes(wi.id)) {
                      issues.push(`Work item "${wi.title}" has parent "${workItems[wi.parentId].title}" but is not in parent's childrenIds`);
                    }
                  }
                  // Backlog assignments reference missing trees or backlogs
                  Object.entries(wi.backlogAssignments).forEach(([treeId, blId]) => {
                    if (!backlogTrees[treeId]) {
                      issues.push(`Work item "${wi.title}" assigned to missing tree ${treeId}`);
                    }
                    if (!backlogs[blId]) {
                      issues.push(`Work item "${wi.title}" assigned to missing backlog ${blId}`);
                    }
                  });
                  // No backlog assignments at all
                  if (Object.keys(wi.backlogAssignments).length === 0) {
                    issues.push(`Work item "${wi.title}" has no backlog assignments (orphaned)`);
                  }
                });

                // Check backlogs
                Object.values(backlogs).forEach((bl) => {
                  if (bl.parentId && !backlogs[bl.parentId]) {
                    issues.push(`Backlog "${bl.name}" references missing parent ${bl.parentId}`);
                  }
                  if (!backlogTrees[bl.treeId]) {
                    issues.push(`Backlog "${bl.name}" references missing tree ${bl.treeId}`);
                  }
                  bl.childrenIds.forEach((cid) => {
                    if (!backlogs[cid]) {
                      issues.push(`Backlog "${bl.name}" lists missing child ${cid}`);
                    }
                  });
                  // Parent doesn't list this backlog
                  if (bl.parentId && backlogs[bl.parentId]) {
                    if (!backlogs[bl.parentId].childrenIds.includes(bl.id)) {
                      issues.push(`Backlog "${bl.name}" has parent "${backlogs[bl.parentId].name}" but is not in parent's childrenIds`);
                    }
                  }
                  // Root backlog not listed in tree's rootBacklogIds
                  if (!bl.parentId && backlogTrees[bl.treeId]) {
                    if (!backlogTrees[bl.treeId].rootBacklogIds.includes(bl.id)) {
                      issues.push(`Backlog "${bl.name}" is root but not in tree's rootBacklogIds`);
                    }
                  }
                });

                // Check backlog trees
                Object.values(backlogTrees).forEach((tree) => {
                  tree.rootBacklogIds.forEach((blId) => {
                    if (!backlogs[blId]) {
                      issues.push(`Tree "${tree.name}" lists missing root backlog ${blId}`);
                    }
                  });
                });

                if (issues.length === 0) {
                  toast({ title: "✅ No broken items found", description: "All data references are valid." });
                } else {
                  console.warn("Data integrity issues:", issues);
                  toast({
                    title: `⚠️ Found ${issues.length} issue${issues.length > 1 ? "s" : ""}`,
                    description: issues.slice(0, 3).join("\n") + (issues.length > 3 ? `\n...and ${issues.length - 3} more (see console)` : ""),
                    variant: "destructive",
                  });
                }
              }}
            >
              <SearchCheck className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Check Data</span>
            </button>

            <button
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-destructive hover:text-destructive-foreground transition-colors flex items-center gap-1.5"
              onClick={() => {
                const { workItems, backlogs, backlogTrees } = useAppStore.getState();
                const removedItems: { type: string; id: string; name: string; reason: string }[] = [];
                const validTreeIds = new Set(Object.keys(backlogTrees));
                const validBacklogIds = new Set(Object.keys(backlogs));
                const validWorkItemIds = new Set(Object.keys(workItems));

                // Find invalid backlogs
                const invalidBacklogIds = new Set<string>();
                Object.values(backlogs).forEach((bl) => {
                  if (!validTreeIds.has(bl.treeId)) {
                    invalidBacklogIds.add(bl.id);
                    removedItems.push({ type: "backlog", id: bl.id, name: bl.name, reason: `references missing tree ${bl.treeId}` });
                  } else if (bl.parentId && !validBacklogIds.has(bl.parentId)) {
                    invalidBacklogIds.add(bl.id);
                    removedItems.push({ type: "backlog", id: bl.id, name: bl.name, reason: `references missing parent ${bl.parentId}` });
                  }
                });

                // Find invalid work items
                const invalidWorkItemIds = new Set<string>();
                Object.values(workItems).forEach((wi) => {
                  const hasValidAssignment = Object.entries(wi.backlogAssignments).some(
                    ([treeId, blId]) => validTreeIds.has(treeId) && validBacklogIds.has(blId) && !invalidBacklogIds.has(blId)
                  );
                  if (!hasValidAssignment) {
                    invalidWorkItemIds.add(wi.id);
                    removedItems.push({ type: "work_item", id: wi.id, name: wi.title, reason: "no valid backlog assignments" });
                  } else if (wi.parentId && !validWorkItemIds.has(wi.parentId)) {
                    removedItems.push({ type: "work_item (fix)", id: wi.id, name: wi.title, reason: `orphaned parent ref ${wi.parentId} cleared` });
                  }
                });

                if (removedItems.length === 0) {
                  toast({ title: "✅ No invalid data found" });
                  return;
                }

                // Build report and copy to clipboard
                const report = removedItems.map((r) => `[${r.type}] "${r.name}" (${r.id}): ${r.reason}`).join("\n");
                navigator.clipboard.writeText(report);

                // Actually cleanse
                const store = useAppStore.getState();
                const newWorkItems = { ...workItems };
                const newBacklogs = { ...backlogs };
                const newTrees = { ...backlogTrees };

                // Remove invalid backlogs
                invalidBacklogIds.forEach((id) => {
                  const bl = newBacklogs[id];
                  if (bl?.parentId && newBacklogs[bl.parentId]) {
                    newBacklogs[bl.parentId] = { ...newBacklogs[bl.parentId], childrenIds: newBacklogs[bl.parentId].childrenIds.filter((c) => c !== id) };
                  }
                  if (!bl?.parentId && bl?.treeId && newTrees[bl.treeId]) {
                    newTrees[bl.treeId] = { ...newTrees[bl.treeId], rootBacklogIds: newTrees[bl.treeId].rootBacklogIds.filter((c) => c !== id) };
                  }
                  delete newBacklogs[id];
                });

                // Remove invalid work items & fix orphaned parents
                invalidWorkItemIds.forEach((id) => {
                  const wi = newWorkItems[id];
                  if (wi?.parentId && newWorkItems[wi.parentId]) {
                    newWorkItems[wi.parentId] = { ...newWorkItems[wi.parentId], childrenIds: newWorkItems[wi.parentId].childrenIds.filter((c) => c !== id) };
                  }
                  delete newWorkItems[id];
                });
                // Fix orphaned parent refs on remaining items
                Object.values(newWorkItems).forEach((wi) => {
                  if (wi.parentId && !newWorkItems[wi.parentId]) {
                    newWorkItems[wi.id] = { ...wi, parentId: null };
                  }
                  // Clean stale childrenIds
                  const validChildren = wi.childrenIds.filter((c) => newWorkItems[c]);
                  if (validChildren.length !== wi.childrenIds.length) {
                    newWorkItems[wi.id] = { ...newWorkItems[wi.id], childrenIds: validChildren };
                  }
                  // Clean stale backlog assignments
                  const cleanAssignments: Record<string, string> = {};
                  Object.entries(wi.backlogAssignments).forEach(([treeId, blId]) => {
                    if (newTrees[treeId] && newBacklogs[blId]) cleanAssignments[treeId] = blId;
                  });
                  if (Object.keys(cleanAssignments).length !== Object.keys(wi.backlogAssignments).length) {
                    newWorkItems[wi.id] = { ...newWorkItems[wi.id], backlogAssignments: cleanAssignments };
                  }
                });

                // Clean stale rootBacklogIds and childrenIds in backlogs
                Object.values(newTrees).forEach((tree) => {
                  const valid = tree.rootBacklogIds.filter((id) => newBacklogs[id]);
                  if (valid.length !== tree.rootBacklogIds.length) {
                    newTrees[tree.id] = { ...tree, rootBacklogIds: valid };
                  }
                });
                Object.values(newBacklogs).forEach((bl) => {
                  const valid = bl.childrenIds.filter((id) => newBacklogs[id]);
                  if (valid.length !== bl.childrenIds.length) {
                    newBacklogs[bl.id] = { ...bl, childrenIds: valid };
                  }
                });

                useAppStore.setState({ workItems: newWorkItems, backlogs: newBacklogs, backlogTrees: newTrees });

                toast({
                  title: `🧹 Cleansed ${removedItems.length} issue${removedItems.length > 1 ? "s" : ""}`,
                  description: "Removed items copied to clipboard.",
                });
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Cleanse Data</span>
            </button>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-destructive hover:text-destructive-foreground transition-colors flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden lg:inline">Reset Data</span>
                </button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset to mock data?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will replace all current data with the default mock dataset. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      useAppStore.getState().resetToMockData();
                      toast({ title: "Data reset to mock data" });
                    }}
                  >
                    Reset
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>

            <div className="flex items-center gap-1 border-l pl-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${undoStackLength > 0 ? "text-foreground hover:bg-accent" : "text-muted-foreground/30"}`}
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
                    className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${redoStackLength > 0 ? "text-foreground hover:bg-accent" : "text-muted-foreground/30"}`}
                    onClick={redo}
                    disabled={redoStackLength === 0}
                  >
                    <Redo2 className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
              </Tooltip>

              <button
                className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
          <div className="bg-card border-2 border-primary/20 shadow-2xl rounded-lg px-4 py-2 text-sm font-semibold max-w-xs truncate pointer-events-none ring-2 ring-background">
            {activeDrag.title}
          </div>
        )}
      </DragOverlay>

      {pendingCrossTree && (
        <ActionPrompt
          title={
            pendingCrossTree.totalCount > 1
              ? `Move ${pendingCrossTree.totalCount} items to ${pendingCrossTree.targetTreeName}`
              : `Move "${pendingCrossTree.itemTitles[0]}" to ${pendingCrossTree.targetTreeName}`
          }
          options={[
            {
              label: "Move",
              description: `Switch from ${pendingCrossTree.sourceTreeName} to ${pendingCrossTree.targetTreeName}.`,
              value: "move",
              isDefault: true,
            },
            {
              label: "Mirror",
              description: `Keep in both tree views.`,
              value: "add",
            },
          ]}
          onSelect={handleCrossTreeChoice}
          onCancel={() => setPendingCrossTree(null)}
        />
      )}

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </DndContext>
  );
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "?") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const shortcuts = [
    { keys: ["Enter"], description: "New root work item" },
    { keys: ["Shift", "Enter"], description: "New child item" },
    { keys: ["Del", "Bksp"], description: "Delete selected" },
    { keys: ["Shift", "Click"], description: "Select range (Explorer style)" },
    { keys: ["↑", "↓"], description: "Move selection up/down" },
    { keys: ["T"], description: "Move selection to Top" },
    { keys: ["B"], description: "Move selection to Bottom" },
    { keys: ["Esc"], description: "Deselect items" },
    { keys: ["Ctrl", "Z"], description: "Undo action" },
    { keys: ["?"], description: "Toggle help" },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border shadow-2xl w-full max-w-sm mx-4 rounded-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b bg-muted/30">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Keyboard className="w-4 h-4" /> Keyboard Shortcuts
          </h3>
        </div>
        <div className="px-6 py-4 space-y-3">
          {shortcuts.map((s, i) => (
            <div key={i} className="flex items-center justify-between group">
              <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                {s.description}
              </span>
              <div className="flex items-center gap-1">
                {s.keys.map((key, j) => (
                  <kbd
                    key={j}
                    className="px-1.5 py-1 rounded border bg-muted text-[10px] font-mono shadow-sm min-w-[28px] text-center"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-6 py-3 bg-muted/20 border-t text-center">
          <button onClick={onClose} className="text-xs font-semibold text-primary hover:underline">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
