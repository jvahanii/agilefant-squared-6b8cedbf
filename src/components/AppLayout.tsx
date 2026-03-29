import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useState, useCallback, useEffect, useRef } from "react";
import { isAutoCheckEnabled, isAutoTestEnabled } from "@/hooks/useAutoIntegrityCheck";
import { useOrgStore } from "@/store/orgStore";
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
import { Undo2, Redo2, Keyboard, RotateCcw, Copy, FileText, SearchCheck, Trash2, FlaskConical } from "lucide-react";
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
            if (state.selectedWorkItemIds.length > 0) {
              window.dispatchEvent(new CustomEvent("shortcut:add-sibling-workitem"));
            } else if (state.selectedBacklogIds.length > 0 && state.selectedTreeId) {
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

  // Auto integrity check on data changes
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const prevDataRef = useRef<string>("");

  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const autoCheck = isAutoCheckEnabled(activeOrgId);
      const autoTest = isAutoTestEnabled(activeOrgId);
      if (!autoCheck && !autoTest) return;

      const fingerprint = JSON.stringify({
        wi: Object.fromEntries(Object.entries(state.workItems).map(([id, w]) => [id, { p: w.parentId, c: w.childrenIds, ba: w.backlogAssignments }])),
        bl: Object.fromEntries(Object.entries(state.backlogs).map(([id, b]) => [id, { p: b.parentId, c: b.childrenIds, t: b.treeId }])),
        bt: Object.fromEntries(Object.entries(state.backlogTrees).map(([id, t]) => [id, { r: t.rootBacklogIds }])),
      });
      if (fingerprint === prevDataRef.current) return;
      prevDataRef.current = fingerprint;

      const issues = checkDataIntegrity({ workItems: state.workItems, backlogs: state.backlogs, backlogTrees: state.backlogTrees });

      if (autoTest) {
        const results: string[] = [];
        const pass = (name: string) => results.push(`✅ PASS: ${name}`);
        const fail = (name: string, detail: string) => results.push(`❌ FAIL: ${name} — ${detail}`);
        const categories = ["Ghost Parent", "Orphaned Children", "Circular Reference", "Backlog Displacement", "Tree-Backlog Desync", "Duplicate Rank", "Cross-Org Pollution", "Malformed ID", "Zombie Assignment"];
        categories.forEach(cat => {
          const catIssues = issues.filter(i => i.category === cat);
          catIssues.length === 0 ? pass(`No ${cat.toLowerCase()}`) : fail(`${cat} found`, `${catIssues.length} items`);
        });
        const passed = results.filter(r => r.startsWith("✅")).length;
        const failed = results.filter(r => r.startsWith("❌")).length;
        let report = `AUTO-TEST RESULTS\n${"=".repeat(40)}\n${results.join("\n")}\n${"=".repeat(40)}\n${passed} passed, ${failed} failed`;
        if (issues.length > 0) report += "\n\nDETAILED ISSUES:\n" + formatIssueReport(issues);
        navigator.clipboard.writeText(report);
        if (failed > 0) {
          toast({
            title: `⚠️ Auto-test: ${failed} test${failed > 1 ? "s" : ""} failed`,
            description: `${passed} passed, ${failed} failed. Report copied to clipboard.`,
            variant: "destructive",
          });
        }
      } else if (autoCheck && issues.length > 0) {
        const report = formatIssueReport(issues);
        navigator.clipboard.writeText(report);
        const cats = [...new Set(issues.map((i) => i.category))];
        toast({
          title: `⚠️ Auto-check: ${issues.length} issue${issues.length > 1 ? "s" : ""}`,
          description: `${cats.join(", ")}. Report copied to clipboard.`,
          variant: "destructive",
        });
      }
    });
    return unsub;
  }, [activeOrgId]);

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
                const code = `// Auto-exported mock data\nexport const mockData = ${JSON.stringify({ workItems, backlogs, backlogTrees }, null, 2)};\n`;
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
                const state = useAppStore.getState();
                const issues = checkDataIntegrity({ workItems: state.workItems, backlogs: state.backlogs, backlogTrees: state.backlogTrees });
                if (issues.length === 0) {
                  toast({ title: "✅ No broken items found", description: "All 8 integrity checks passed." });
                } else {
                  const report = formatIssueReport(issues);
                  navigator.clipboard.writeText(report);
                  const categories = [...new Set(issues.map((i) => i.category))];
                  toast({
                    title: `⚠️ Found ${issues.length} issue${issues.length > 1 ? "s" : ""}`,
                    description: `Categories: ${categories.join(", ")}. See console for full report.`,
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
                const state = useAppStore.getState();
                const result = cleanseData({ workItems: state.workItems, backlogs: state.backlogs, backlogTrees: state.backlogTrees });
                const allIssues = [...result.removed, ...result.fixed];
                if (allIssues.length === 0) {
                  toast({ title: "✅ No invalid data found" });
                  return;
                }
                const report = formatIssueReport(allIssues);
                navigator.clipboard.writeText(report);
                console.log("Cleanse report:\n" + report);
                useAppStore.setState(result.data);
                toast({
                  title: `🧹 Cleansed ${allIssues.length} issue${allIssues.length > 1 ? "s" : ""} (${result.removed.length} removed, ${result.fixed.length} fixed)`,
                  description: "Full report copied to clipboard.",
                });
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Cleanse Data</span>
            </button>

            <button
              className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5"
              onClick={() => {
                const state = useAppStore.getState();
                const issues = checkDataIntegrity({ workItems: state.workItems, backlogs: state.backlogs, backlogTrees: state.backlogTrees });

                const results: string[] = [];
                const pass = (name: string) => results.push(`✅ PASS: ${name}`);
                const fail = (name: string, detail: string) => results.push(`❌ FAIL: ${name} — ${detail}`);

                // Test 1: No ghost parents
                const ghostParents = issues.filter(i => i.category === "Ghost Parent");
                ghostParents.length === 0 ? pass("No ghost parents") : fail("Ghost parents found", `${ghostParents.length} items`);

                // Test 2: No orphaned children
                const orphaned = issues.filter(i => i.category === "Orphaned Children");
                orphaned.length === 0 ? pass("No orphaned children") : fail("Orphaned children found", `${orphaned.length} items`);

                // Test 3: No circular references
                const circular = issues.filter(i => i.category === "Circular Reference");
                circular.length === 0 ? pass("No circular references") : fail("Circular references found", `${circular.length} items`);

                // Test 4: No backlog displacement
                const displacement = issues.filter(i => i.category === "Backlog Displacement");
                displacement.length === 0 ? pass("No backlog displacement") : fail("Backlog displacement found", `${displacement.length} items`);

                // Test 5: No tree-backlog desync
                const desync = issues.filter(i => i.category === "Tree-Backlog Desync");
                desync.length === 0 ? pass("No tree-backlog desync") : fail("Tree-backlog desync found", `${desync.length} items`);

                // Test 6: No duplicate ranks
                const dupRank = issues.filter(i => i.category === "Duplicate Rank");
                dupRank.length === 0 ? pass("No duplicate ranks") : fail("Duplicate ranks found", `${dupRank.length} items`);

                // Test 7: No cross-org pollution
                const crossOrg = issues.filter(i => i.category === "Cross-Org Pollution");
                crossOrg.length === 0 ? pass("No cross-org pollution") : fail("Cross-org pollution found", `${crossOrg.length} items`);

                // Test 8: No malformed IDs
                const malformed = issues.filter(i => i.category === "Malformed ID");
                malformed.length === 0 ? pass("No malformed IDs") : fail("Malformed IDs found", `${malformed.length} items`);

                // Test 9: No zombie assignments
                const zombie = issues.filter(i => i.category === "Zombie Assignment");
                zombie.length === 0 ? pass("No zombie assignments") : fail("Zombie assignments found", `${zombie.length} items`);

                const passed = results.filter(r => r.startsWith("✅")).length;
                const failed = results.filter(r => r.startsWith("❌")).length;
                const report = `DATA INTEGRITY TEST RESULTS\n${"=".repeat(40)}\n${results.join("\n")}\n${"=".repeat(40)}\n${passed} passed, ${failed} failed of ${results.length} tests`;

                if (issues.length > 0) {
                  report + "\n\nDETAILED ISSUES:\n" + formatIssueReport(issues);
                }

                const fullReport = issues.length > 0 ? report + "\n\nDETAILED ISSUES:\n" + formatIssueReport(issues) : report;
                navigator.clipboard.writeText(fullReport);

                toast({
                  title: failed === 0 ? `✅ All ${passed} tests passed` : `⚠️ ${failed} test${failed > 1 ? "s" : ""} failed`,
                  description: `${passed} passed, ${failed} failed. Report copied to clipboard.`,
                  variant: failed > 0 ? "destructive" : undefined,
                });
              }}
            >
              <FlaskConical className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Run Tests</span>
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
