import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
} from "@dnd-kit/core";
import { useState, useCallback, useEffect, useRef, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { isAutoCheckEnabled, isAutoTestEnabled } from "@/hooks/useAutoIntegrityCheck";
import { useOrgStore } from "@/store/orgStore";
import { isTimeLoggingEnabled } from "@/store/orgSettingsStore";
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
import { DeleteGuardHost } from "@/components/DeleteGuardHost";
import { RerankGuardHost } from "@/components/RerankGuardHost";
import { JobSearchRunButton } from "@/components/JobSearchRunButton";
import { requestTopLevelRerank } from "@/store/rerankGuardStore";
import { PersistDebugOverlay } from "@/components/PersistDebugOverlay";
import { useBurnupDialogStore } from "@/store/burnupDialogStore";
import {
  Undo2,
  Redo2,
  Keyboard,
  RotateCcw,
  Copy,
  FileText,
  MoreVertical,
  HelpCircle,
  Eye,
  EyeOff,
  ClipboardList,
  Settings,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { checkDataIntegrity, formatIssueReport } from "@/store/dataIntegrity";
import { exportChangeLogAsCsv } from "@/store/changeLog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { RoleSimulator } from "@/components/RoleSimulator";
import { UserGuideDialog } from "@/components/UserGuideDialog";
import { useAuth } from "@/hooks/useAuth";
import { useIsMobile } from "@/hooks/use-mobile";
import { ScrambleProvider, useScramble } from "@/contexts/ScrambleContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { visibleWorkItemIdsRef, visibleBacklogIdsRef, deleteDirectionRef } from "@/store/navigationRefs";
import { getEffectiveParentId, type WorkItemStatus } from "@/types/models";
import { backlogsToMove, dropBacklogsAt } from "@/lib/backlogMove";
import { rowAfterStatusMove } from "@/lib/statusSelection";
import { sortTopLevel } from "@/lib/listSort";
import { topLevelItems } from "@/lib/workItemRows";
import { currentListSortContext, listSortModeFor } from "@/store/listSortStore";

// Lazy-loaded so the recharts bundle (via BurnupChartDialog) is not part of the
// initial cold-start payload; it's only fetched when a burnup chart is opened.
const BurnupChartDialog = lazy(() =>
  import("@/components/BurnupChartDialog").then((m) => ({ default: m.BurnupChartDialog })),
);

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
  return (
    <ScrambleProvider>
      <AppLayoutInner />
      <DeleteGuardHost />
      <RerankGuardHost />
      <BurnupDialogHost />
    </ScrambleProvider>
  );
}

function BurnupDialogHost() {
  const { scope, open, close } = useBurnupDialogStore();
  return (
    <Suspense fallback={null}>
      <BurnupChartDialog
        open={open}
        onOpenChange={(v) => { if (!v) close(); }}
        scope={scope}
      />
    </Suspense>
  );
}

function AppLayoutInner() {
  const { user } = useAuth();
  const moveWorkItemToBacklog = useAppStore((s) => s.moveWorkItemToBacklog);
  const moveWorkItemsToBacklog = useAppStore((s) => s.moveWorkItemsToBacklog);
  const reorderBacklogAmongSiblings = useAppStore((s) => s.reorderBacklogAmongSiblings);
  const moveBacklog = useAppStore((s) => s.moveBacklog);
  const removeWorkItemFromTree = useAppStore((s) => s.removeWorkItemFromTree);
  const reparentWorkItem = useAppStore((s) => s.reparentWorkItem);
  const reorderWorkItemAmongSiblings = useAppStore((s) => s.reorderWorkItemAmongSiblings);
  const reorderWorkItemInBoard = useAppStore((s) => s.reorderWorkItemInBoard);
  const reorderBacklogTree = useAppStore((s) => s.reorderBacklogTree);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const undoStackLength = useAppStore((s) => s.undoStack.length);
  const redoStackLength = useAppStore((s) => s.redoStack.length);
  const changeLog = useAppStore((s) => s.changeLog);

  const [activeDrag, setActiveDrag] = useState<{ id: string; type: string; title: string; count?: number } | null>(null);
  const [pendingCrossTree, setPendingCrossTree] = useState<PendingCrossTreeDrop | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showUserGuide, setShowUserGuide] = useState(false);
  const [mobileBacklogsCollapsed, setMobileBacklogsCollapsed] = useState(false);

  const isMobile = useIsMobile();

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const activeDragRef = useRef(activeDrag);
  useEffect(() => {
    activeDragRef.current = activeDrag;
  }, [activeDrag]);

  const sensors = useSensors(
    // Larger activation distance avoids accidentally starting a drag during
    // a click/text-selection — desktop drag now needs a clear ~8px gesture.
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // Custom collision detection: prefer pointer-within (exact pointer position) over rect
  // intersection. When multiple droppables contain the pointer, prefer the smaller/more
  // specific ones (e.g. thin reorder zones over large item rows) by sorting by area.
  const collisionDetectionStrategy = useCallback((args: Parameters<typeof rectIntersection>[0]) => {
    const pointerCollisions = pointerWithin(args);
    if (pointerCollisions.length > 0) {
      return [...pointerCollisions].sort((a, b) => {
        // Prioritize backlog-drop (reparent) over backlog-reorder zones
        // so dropping a backlog onto another backlog reparents it under
        // that backlog rather than reordering it among siblings.
        const aIsBacklogDrop = String(a.id).startsWith("backlog-drop-");
        const bIsBacklogDrop = String(b.id).startsWith("backlog-drop-");
        if (aIsBacklogDrop !== bIsBacklogDrop) {
          return aIsBacklogDrop ? -1 : 1;
        }
        const rA = args.droppableRects.get(a.id);
        const rB = args.droppableRects.get(b.id);
        const areaA = rA ? rA.width * rA.height : Infinity;
        const areaB = rB ? rB.width * rB.height : Infinity;
        return areaA - areaB;
      });
    }
    return rectIntersection(args);
  }, []);

  useEffect(() => {
    // Radix closes a dialog on Escape, and React flushes that unmount
    // synchronously within the same keydown — so by the time the handler below
    // runs, the dialog is already gone and a live DOM check sees nothing. That
    // let Escape close the hyperlinks dialog *and* clear the item's selection.
    // Capture the answer first, in the capture phase, before anything reacts.
    let dialogWasOpen = false;
    const noteDialogOpen = () => {
      dialogWasOpen = !!document.querySelector('[role="dialog"]');
    };

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

      // Ctrl+A / Cmd+A selects all visible work items (skip when a dialog is open)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        if (dialogWasOpen || document.querySelector('[role="dialog"]')) return;
        const ids = visibleWorkItemIdsRef.current;
        if (ids.length > 0) {
          e.preventDefault();
          useAppStore.setState({ selectedWorkItemIds: [...ids] });
        }
        return;
      }

      // Ctrl+K / Cmd+K opens the hyperlink dialog
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        const state = useAppStore.getState();
        if (state.selectedWorkItemIds.length > 0) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("shortcut:edit-hyperlinks"));
        }
        return;
      }

      // Ctrl+D / Cmd+D duplicates the selected work item(s)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && !e.shiftKey && !e.altKey) {
        const state = useAppStore.getState();
        if (state.selectedWorkItemIds.length > 0) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("shortcut:duplicate-selected"));
        }
        return;
      }

      if (isInput) return;

      // Don't fire global shortcuts when a modal dialog is open (e.g. reparent dialog).
      if (dialogWasOpen || document.querySelector('[role="dialog"]')) return;

      const state = useAppStore.getState();

      // Helper: set the status of every selected work item, as one undo step.
      // In a list whose sort the change reorders (sorted by status), the
      // selection then moves to the row below the old spot rather than
      // following the item to its new group — see lib/statusSelection.
      const setSelectedStatus = (status: WorkItemStatus, label: string) => {
        if (state.selectedWorkItemIds.length === 0) return;
        e.preventDefault();
        const selectedIds = state.selectedWorkItemIds;
        const backlogId = state.selectedBacklogIds[0];
        const treeId = state.selectedTreeId;
        const mode = listSortModeFor(backlogId);
        const inList = !!backlogId && !!treeId && state.backlogs[backlogId]?.viewMode !== "board" && mode !== "rank";

        // The backlogs the list shows: the selected one and everything under it.
        const shown = new Set<string>();
        const collect = (id: string) => {
          shown.add(id);
          state.backlogs[id]?.childrenIds.forEach(collect);
        };
        if (inList) collect(backlogId);
        const topLevelOrder = (workItems: typeof state.workItems) =>
          sortTopLevel(topLevelItems(workItems, treeId!, shown), mode, treeId!, currentListSortContext(treeId!)).map(
            (wi) => wi.id,
          );
        const visibleBefore = visibleWorkItemIdsRef.current;
        const orderBefore = inList ? topLevelOrder(state.workItems) : [];

        state.runBulk(() => {
          selectedIds.forEach((id) => state.setWorkItemStatus(id, status));
        });

        if (inList) {
          const after = useAppStore.getState();
          const selected = new Set(selectedIds);
          const next = rowAfterStatusMove({
            visibleBefore,
            selectedIds,
            orderBefore,
            orderAfter: topLevelOrder(after.workItems),
            isInsideSelected: (id) => {
              const seen = new Set<string>();
              for (let p = getEffectiveParentId(after.workItems[id], treeId!); p && !seen.has(p); ) {
                if (selected.has(p)) return true;
                seen.add(p);
                const parent = after.workItems[p];
                p = parent ? getEffectiveParentId(parent, treeId!) : null;
              }
              return false;
            },
          });
          if (next) after.selectWorkItem(next, false);
        }
        toast({ title: `Marked ${selectedIds.length} item(s) as ${label}` });
      };

      // Helper: move the single selected work item one step up (-1) or down (+1).
      const reorderSelectedItem = (direction: -1 | 1) => {
        if (state.selectedWorkItemIds.length < 1 || !state.selectedTreeId || state.selectedBacklogIds.length === 0)
          return;
        const anchorId = state.selectedWorkItemIds[0];
        const wi = state.workItems[anchorId];
        if (!wi) return;
        const treeId = state.selectedTreeId;
        const selectedBacklogId = state.selectedBacklogIds[0];
        const selectedSet = new Set(state.selectedWorkItemIds);

        const backlogIds: string[] = [];
        const collectBacklogs = (id: string) => {
          backlogIds.push(id);
          state.backlogs[id]?.childrenIds.forEach(collectBacklogs);
        };
        collectBacklogs(selectedBacklogId);

        const backlogIdSet = new Set(backlogIds);
        const wiEffectiveParent = getEffectiveParentId(wi, treeId);
        const anchorParentInContext =
          wiEffectiveParent !== null &&
          !!state.workItems[wiEffectiveParent] &&
          backlogIdSet.has(state.workItems[wiEffectiveParent].backlogAssignments[treeId]);

        // Neighbours are found in rank order, so this runs after any save of the
        // shown order: in a list sorted by name, "up" means the item above on
        // screen only once that order has become the rank.
        const move = () => {
          const current = useAppStore.getState().workItems;
          const siblings = Object.values(current)
            .filter((w) => {
              if (!backlogIdSet.has(w.backlogAssignments[treeId])) return false;
              const wEffectiveParent = getEffectiveParentId(w, treeId);
              if (anchorParentInContext) {
                return wEffectiveParent === wiEffectiveParent;
              }
              return (
                wEffectiveParent === null ||
                !current[wEffectiveParent] ||
                !backlogIdSet.has(current[wEffectiveParent].backlogAssignments[treeId])
              );
            })
            .sort((a, b) => {
              const rankDiff = (a.ranks[a.backlogAssignments[treeId]] ?? 0) - (b.ranks[b.backlogAssignments[treeId]] ?? 0);
              return rankDiff !== 0 ? rankDiff : a.id.localeCompare(b.id);
            });

          // Find drop-zone indices of all selected siblings; move the whole group by one
          // neighbour up or down — top selected → zone-1 for up, bottom selected → zone+2 for down.
          const selectedIdxs: number[] = [];
          siblings.forEach((s, i) => { if (selectedSet.has(s.id)) selectedIdxs.push(i); });
          if (selectedIdxs.length === 0) return;
          const topIdx = selectedIdxs[0];
          const botIdx = selectedIdxs[selectedIdxs.length - 1];
          const newIdx = direction === -1 ? topIdx - 1 : botIdx + 2;
          if (newIdx < 0 || newIdx > siblings.length) return;
          useAppStore.getState().reorderWorkItemAmongSiblings(anchorId, newIdx, treeId, backlogIds);
        };

        requestTopLevelRerank({
          treeId,
          backlogId: selectedBacklogId,
          backlogIds,
          touchesTopLevel: !anchorParentInContext,
          proceed: move,
        });
      };

      // Alt+Enter or F2: rename the first selected work item
      if ((e.altKey && e.key === "Enter") || e.key === "F2") {
        if (state.selectedWorkItemIds.length > 0) {
          e.preventDefault();
          window.dispatchEvent(
            new CustomEvent("shortcut:edit-title", {
              detail: { workItemId: state.selectedWorkItemIds[0] },
            }),
          );
        }
        return;
      }

      if (e.ctrlKey || e.metaKey) return;

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

            // Call reorderWorkItemAmongSiblings once per unique sibling context rather
            // than once per selected item.  Each call already moves every selected item
            // in that context (because internally it uses itemsToMoveIds =
            // selectedWorkItemIds), so calling it N times for N items in the same
            // group creates N−1 redundant undo entries.  Those ghost entries make the
            // user press Ctrl+Z N times to undo a single T press; the first N−1
            // presses appear to do nothing, hiding the fact that one more Ctrl+Z will
            // silently undo the move.  A subsequent drag/reorder then writes the
            // undo'd state back to the DB, causing items to no longer be at the top
            // on the next reload.
            const backlogIdSet = new Set(backlogIds);
            const contextOf = (id: string) => {
              const wi = state.workItems[id];
              if (!wi) return null;
              const effectiveParentId = getEffectiveParentId(wi, treeId);
              const parentInContext = effectiveParentId !== null &&
                backlogIdSet.has(state.workItems[effectiveParentId]?.backlogAssignments[treeId] ?? "");
              return parentInContext ? `child:${effectiveParentId}` : "root";
            };
            requestTopLevelRerank({
              treeId,
              backlogId: selectedBacklogId,
              backlogIds,
              touchesTopLevel: state.selectedWorkItemIds.some((id) => contextOf(id) === "root"),
              proceed: () => {
                const processedContexts = new Set<string>();
                state.runBulk(() => {
                  state.selectedWorkItemIds.forEach((id) => {
                    const contextKey = contextOf(id);
                    if (!contextKey || processedContexts.has(contextKey)) return;
                    processedContexts.add(contextKey);
                    state.reorderWorkItemAmongSiblings(id, 0, treeId, backlogIds);
                  });
                });
                toast({ title: `Moved ${state.selectedWorkItemIds.length} items to top` });
              },
            });
          }
          break;
        }
        case "b": {
          if (e.shiftKey) {
            // Rank to Bottom (Shift+B)
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

              // Same deduplication as "Move to top" – one call per sibling context.
              const backlogIdSet = new Set(backlogIds);
              const contextOf = (id: string) => {
                const wi = state.workItems[id];
                if (!wi) return null;
                const effectiveParentId = getEffectiveParentId(wi, treeId);
                const parentInContext = effectiveParentId !== null &&
                  backlogIdSet.has(state.workItems[effectiveParentId]?.backlogAssignments[treeId] ?? "");
                return parentInContext ? `child:${effectiveParentId}` : "root";
              };
              requestTopLevelRerank({
                treeId,
                backlogId: selectedBacklogId,
                backlogIds,
                touchesTopLevel: state.selectedWorkItemIds.some((id) => contextOf(id) === "root"),
                proceed: () => {
                  const processedContexts = new Set<string>();
                  state.runBulk(() => {
                    state.selectedWorkItemIds.forEach((id) => {
                      const contextKey = contextOf(id);
                      if (!contextKey || processedContexts.has(contextKey)) return;
                      processedContexts.add(contextKey);
                      state.reorderWorkItemAmongSiblings(id, 999999, treeId, backlogIds);
                    });
                  });
                  toast({ title: `Moved ${state.selectedWorkItemIds.length} items to bottom` });
                },
              });
            }
          } else {
            setSelectedStatus("blocked", "Blocked");
          }
          break;
        }
        case "n": {
          setSelectedStatus("not_started", "Not Started");
          break;
        }
        case "d": {
          setSelectedStatus("done", "Done");
          break;
        }
        case "i": {
          setSelectedStatus("in_progress", "In Progress");
          break;
        }
        case "p": {
          setSelectedStatus("pending", "Pending");
          break;
        }
        case "o": {
          if (state.selectedWorkItemIds.length >= 1 && state.selectedTreeId && state.selectedBacklogIds.length > 0) {
            e.preventDefault();
            reorderSelectedItem(1);
          } else if (state.selectedWorkItemIds.length === 0 && state.selectedBacklogIds.length > 0 && state.selectedTreeId) {
            // Move selected backlog down among siblings
            e.preventDefault();
            const blId = state.selectedBacklogIds[0];
            const bl = state.backlogs[blId];
            if (bl) {
              const parentId = bl.parentId;
              const siblingIds = parentId ? (state.backlogs[parentId]?.childrenIds ?? []) : state.backlogTrees[state.selectedTreeId]?.rootBacklogIds ?? [];
              const currentIdx = siblingIds.indexOf(blId);
              const newIdx = currentIdx + 1;
              if (newIdx < siblingIds.length) {
                // Move to one position after current → swap with the next sibling
                reorderBacklogAmongSiblings(blId, newIdx + 1, parentId, state.selectedTreeId);
              }
            }
          }
          break;
        }
        case "u": {
          if (state.selectedWorkItemIds.length >= 1 && state.selectedTreeId && state.selectedBacklogIds.length > 0) {
            e.preventDefault();
            reorderSelectedItem(-1);
          } else if (state.selectedWorkItemIds.length === 0 && state.selectedBacklogIds.length > 0 && state.selectedTreeId) {
            // Move selected backlog up among siblings
            e.preventDefault();
            const blId = state.selectedBacklogIds[0];
            const bl = state.backlogs[blId];
            if (bl) {
              const parentId = bl.parentId;
              const siblingIds = parentId ? (state.backlogs[parentId]?.childrenIds ?? []) : state.backlogTrees[state.selectedTreeId]?.rootBacklogIds ?? [];
              const currentIdx = siblingIds.indexOf(blId);
              const newIdx = currentIdx - 1;
              if (newIdx >= 0) {
                reorderBacklogAmongSiblings(blId, newIdx, parentId, state.selectedTreeId);
              }
            }
          }
          break;
        }
        case "a": {
          if (state.selectedWorkItemIds.length > 0) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("shortcut:open-team-assign"));
          }
          break;
        }
        case "h": {
          if (state.selectedWorkItemIds.length > 0) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("shortcut:edit-hyperlinks"));
          }
          break;
        }
        case "l": {
          const orgId = useOrgStore.getState().activeOrgId;
          if (state.selectedWorkItemIds.length > 0 && isTimeLoggingEnabled(orgId)) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("shortcut:log-time"));
          }
          break;
        }
        case "m": {
          if (state.selectedWorkItemIds.length > 0) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("shortcut:move-to-backlog"));
          }
          break;
        }
        case "r": {
          if (state.selectedWorkItemIds.length > 0) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("shortcut:move-to-parent"));
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
            const direction = e.key === "Backspace" ? "up" : "down";
            deleteDirectionRef.current = direction;
            window.dispatchEvent(new CustomEvent("shortcut:delete-selected", { detail: { direction } }));
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
        case "arrowright": {
          if (state.selectedWorkItemIds.length > 0) {
            const wiId = state.selectedWorkItemIds[0];
            const wi = state.workItems[wiId];
            if (wi && wi.childrenIds.length > 0) {
              e.preventDefault();
              useAppStore.getState().expandWorkItemsRecursive(wiId);
            }
          } else if (state.selectedBacklogIds.length > 0) {
            const backlogId = state.selectedBacklogIds[0];
            const backlog = state.backlogs[backlogId];
            if (backlog && backlog.childrenIds.length > 0) {
              e.preventDefault();
              useAppStore.getState().expandBacklogsRecursive(backlogId);
            }
          }
          break;
        }
        case "arrowleft": {
          if (state.selectedWorkItemIds.length > 0) {
            const wiId = state.selectedWorkItemIds[0];
            const wi = state.workItems[wiId];
            if (wi && wi.childrenIds.length > 0) {
              e.preventDefault();
              useAppStore.getState().collapseWorkItemsRecursive(wiId);
            }
          } else if (state.selectedBacklogIds.length > 0) {
            const backlogId = state.selectedBacklogIds[0];
            const backlog = state.backlogs[backlogId];
            if (backlog && backlog.childrenIds.length > 0) {
              e.preventDefault();
              useAppStore.getState().collapseBacklogsRecursive(backlogId);
            }
          }
          break;
        }
        case "arrowup":
        case "arrowdown": {
          // When the selected backlog is in board view mode, BoardView
          // handles arrow-key navigation within columns.  Skip the flat-
          // list based navigation here to avoid double-stepping.
          const selectedBacklogId = state.selectedBacklogIds[0];
          if (selectedBacklogId && state.backlogs[selectedBacklogId]?.viewMode === "board") return;

          const isDown = e.key.toLowerCase() === "arrowdown";
          if (state.selectedWorkItemIds.length > 0) {

            
            const ids = visibleWorkItemIdsRef.current;
            
            if (e.shiftKey) {
              // Shift+Arrow: extend the selection range by one in the pressed direction.
              const selectedIndices = state.selectedWorkItemIds
                .map((id) => ids.indexOf(id))
                .filter((i) => i !== -1)
                .sort((a, b) => a - b);
              if (selectedIndices.length === 0) break;

              const nextIdx = isDown
                ? Math.min(selectedIndices[selectedIndices.length - 1] + 1, ids.length - 1)
                : Math.max(selectedIndices[0] - 1, 0);

              const nextId = ids[nextIdx];
              if (!nextId) break;
              e.preventDefault();
              // Add to selection if not already selected — never remove on extend.
              if (!state.selectedWorkItemIds.includes(nextId)) {
                useAppStore.getState().selectWorkItem(nextId, true);
              }
            } else {
              // Plain Arrow: single-select navigation (existing behavior).
              const currentId = state.selectedWorkItemIds[state.selectedWorkItemIds.length - 1];
              const idx = ids.indexOf(currentId);
              if (idx === -1) break;
              const nextIdx = isDown ? idx + 1 : idx - 1;
              if (nextIdx < 0 || nextIdx >= ids.length) break;
              e.preventDefault();
              useAppStore.getState().selectWorkItem(ids[nextIdx]);
            }
          } else if (state.selectedBacklogIds.length > 0) {
            // Navigate selection through visible backlogs.
            const currentId = state.selectedBacklogIds[state.selectedBacklogIds.length - 1];
            const ids = visibleBacklogIdsRef.current;
            const idx = ids.indexOf(currentId);
            if (idx === -1) break;
            const nextIdx = isDown ? idx + 1 : idx - 1;
            if (nextIdx < 0 || nextIdx >= ids.length) break;
            const nextBacklog = useAppStore.getState().backlogs[ids[nextIdx]];
            if (!nextBacklog) break;
            e.preventDefault();
            useAppStore.getState().selectBacklog(ids[nextIdx], nextBacklog.treeId);
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", noteDialogOpen, true);
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", noteDialogOpen, true);
      window.removeEventListener("keydown", handler);
    };
  }, [undo, redo, moveWorkItemToBacklog, moveWorkItemsToBacklog, reorderWorkItemAmongSiblings]);

  // Mobile swipe gesture handlers
  useEffect(() => {
    const SWIPE_THRESHOLD = 40;
    // Dominant axis must be at least this many times larger than the other to
    // avoid diagonal gestures (which are often scrolling) triggering commands.
    const DIRECTION_RATIO = 2;
    // Track whether a scroll event fired during the current touch interaction.
    // If it did, the user was scrolling, so vertical swipes should be ignored.
    let touchScrolled = false;
    // Direction locked in on first significant touchmove, used to reject
    // gestures where the user started moving horizontally then went vertical.
    let lockedDirection: "vertical" | "horizontal" | null = null;
    const LOCK_THRESHOLD = 8; // px before direction is locked

    const resetState = () => {
      touchStartRef.current = null;
      touchScrolled = false;
      lockedDirection = null;
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (activeDragRef.current) return;
      if (e.touches.length === 1) {
        // Single-finger touch: track for swipe / double-tap detection.
        const touch = e.touches[0];
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        touchScrolled = false;
        lockedDirection = null;
      } else {
        // Two or more fingers: ignore.
        resetState();
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStartRef.current) return;
      // Cancel if more fingers join mid-swipe.
      if (e.touches.length > 1) {
        resetState();
        return;
      }
      const clientX = e.touches[0].clientX;
      const clientY = e.touches[0].clientY;
      const absDx = Math.abs(clientX - touchStartRef.current.x);
      const absDy = Math.abs(clientY - touchStartRef.current.y);
      if (lockedDirection !== null) return;
      const moved = Math.max(absDx, absDy);
      if (moved < LOCK_THRESHOLD) return;
      // Lock in direction based on the first significant movement.
      lockedDirection = absDy >= absDx ? "vertical" : "horizontal";
    };

    const handleScroll = () => {
      if (touchStartRef.current) {
        touchScrolled = true;
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!touchStartRef.current || activeDragRef.current) {
        resetState();
        return;
      }
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - touchStartRef.current.x;
      const dy = endY - touchStartRef.current.y;
      resetState();

      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      // Short tap (didn't exceed swipe threshold): no gesture action.
      if (Math.max(absDx, absDy) < SWIPE_THRESHOLD) {
        return;
      }

      const state = useAppStore.getState();

      // Require the dominant axis to be at least DIRECTION_RATIO× the other
      // axis so that diagonal or ambiguous gestures are ignored.
      if (absDx >= absDy * DIRECTION_RATIO) {
        // Horizontal swipe
        if (dx < 0) {
          // Swipe left → same as Escape
          if (state.selectedWorkItemIds.length > 0) {
            state.clearWorkItemSelection();
          }
        } else {
          // Swipe right → expand branch
          if (state.selectedWorkItemIds.length > 0) {
            state.selectedWorkItemIds.forEach((id) => {
              const wi = state.workItems[id];
              if (wi && wi.childrenIds.length > 0 && !state.expandedWorkItems.has(id)) {
                state.toggleWorkItemExpand(id);
              }
            });
          } else if (state.selectedBacklogIds.length > 0) {
            state.selectedBacklogIds.forEach((id) => {
              const backlog = state.backlogs[id];
              if (backlog && backlog.childrenIds.length > 0 && !state.expandedBacklogs.has(id)) {
                state.toggleBacklogExpand(id);
              }
            });
          }
        }
      }
      // Diagonal gestures and vertical swipes are intentionally ignored.
    };

    const handleTouchCancel = () => {
      resetState();
    };

    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: true });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });
    window.addEventListener("touchcancel", handleTouchCancel, { passive: true });
    // capture: true catches scroll on any element, not just window
    window.addEventListener("scroll", handleScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchCancel);
      window.removeEventListener("scroll", handleScroll, { capture: true });
    };
    // Empty dep array is intentional: all store functions are accessed via
    // useAppStore.getState() at call-time, so there are no stale closure issues.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto integrity check on data changes
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const roleOverride = useOrgStore((s) => s.roleOverride);
  const prevDataRef = useRef<string>("");

  useEffect(() => {
    const unsub = useAppStore.subscribe((state) => {
      const autoCheck = isAutoCheckEnabled(activeOrgId);
      const autoTest = isAutoTestEnabled(activeOrgId);
      if (!autoCheck && !autoTest) return;

      const fingerprint = JSON.stringify({
        wi: Object.fromEntries(
          Object.entries(state.workItems).map(([id, w]) => [
            id,
            { p: w.parentId, c: w.childrenIds, ba: w.backlogAssignments },
          ]),
        ),
        bl: Object.fromEntries(
          Object.entries(state.backlogs).map(([id, b]) => [id, { p: b.parentId, c: b.childrenIds, t: b.treeId }]),
        ),
        bt: Object.fromEntries(Object.entries(state.backlogTrees).map(([id, t]) => [id, { r: t.rootBacklogIds }])),
      });
      if (fingerprint === prevDataRef.current) return;
      prevDataRef.current = fingerprint;

      const issues = checkDataIntegrity({
        workItems: state.workItems,
        backlogs: state.backlogs,
        backlogTrees: state.backlogTrees,
      });

      if (autoTest) {
        const results: string[] = [];
        const pass = (name: string) => results.push(`✅ PASS: ${name}`);
        const fail = (name: string, detail: string) => results.push(`❌ FAIL: ${name} — ${detail}`);
        const categories = [
          "Ghost Parent",
          "Orphaned Children",
          "Circular Reference",
          "Backlog Displacement",
          "Tree-Backlog Desync",
          "Duplicate Rank",
          "Cross-Org Pollution",
          "Malformed ID",
          "Zombie Assignment",
        ];
        categories.forEach((cat) => {
          const catIssues = issues.filter((i) => i.category === cat);
          catIssues.length === 0 ? pass(`No ${cat.toLowerCase()}`) : fail(`${cat} found`, `${catIssues.length} items`);
        });
        const passed = results.filter((r) => r.startsWith("✅")).length;
        const failed = results.filter((r) => r.startsWith("❌")).length;
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
        // Auto-select the dragged item if it's not already part of the current selection,
        // so board cards can be dragged without needing a prior click-to-select.
        if (!store.selectedWorkItemIds.some((id) => ids.includes(id))) {
          store.selectWorkItem(ids[0], false);
        }
        const totalCount = countWithDescendants(ids);
        const titles = ids.map((id) => store.workItems[id]?.title ?? "").filter(Boolean);
        const title = titles[0] ?? "";
        setActiveDrag({ id: data.workItemId, type: "workitem", title, count: totalCount });
      } else if (data?.type === "backlog-node") {
        const store = useAppStore.getState();
        const bl = store.backlogs[data.backlogId];
        const count = backlogsToMove(data.backlogId, store.selectedBacklogIds, store.backlogs, store.backlogTrees, null).length;
        setActiveDrag({ id: data.backlogId, type: "backlog-node", title: bl?.name ?? "", count });
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

      // Coalesce the entire drop into a single undo entry — multi-item drags
      // and chained reparent+reorder operations should be one undo step.
      useAppStore.getState().runBulk(() => {


      if (activeData?.type === "workitem" && overData?.type === "board-column") {
        const statusKey = overData.statusKey as WorkItemStatus;
        const treeId = overData.treeId as string;
        const backlogIds = (overData.backlogIds as string[]) ?? [];
        const surfaceStore = useAppStore.getState();
        draggedIds.forEach((id) => {
          const wi = surfaceStore.workItems[id];
          if (!wi) return;
          if (wi.status !== statusKey) {
            useAppStore.getState().setWorkItemStatus(id, statusKey);
          }
        });
        // Rank dragged items at the top of the column so they appear
        // first after the status change.  Using index 0 places them
        // before the first card.
        if (draggedIds.length > 0 && treeId && backlogIds.length > 0) {
          reorderWorkItemInBoard(draggedIds[0], 0, treeId, backlogIds);
        }
        return;
      }


      if (activeData?.type === "workitem" && overData?.type === "backlog") {
        const sourceTreeId = activeData.treeId as string;
        const targetTreeId = overData.treeId as string;

        if (sourceTreeId !== targetTreeId) {
          const store = useAppStore.getState();

          // Items already assigned to the target tree are being moved back to their
          // original tree — simply remove them from the source tree without prompting.
          const alreadyInTarget = draggedIds.filter(
            (id) => store.workItems[id]?.backlogAssignments?.[targetTreeId] !== undefined,
          );
          alreadyInTarget.forEach((id) => removeWorkItemFromTree(id, sourceTreeId));

          const notInTarget = draggedIds.filter(
            (id) => store.workItems[id]?.backlogAssignments?.[targetTreeId] === undefined,
          );
          if (notInTarget.length === 0) return;

          const sourceTree = store.backlogTrees[sourceTreeId];
          const targetTree = store.backlogTrees[targetTreeId];
          const titles = notInTarget.map((id) => store.workItems[id]?.title ?? "").filter(Boolean);
          setPendingCrossTree({
            workItemIds: notInTarget,
            totalCount: countWithDescendants(notInTarget),
            targetBacklogId: overData.backlogId,
            targetTreeId,
            sourceTreeId,
            itemTitles: titles,
            sourceTreeName: sourceTree?.name ?? sourceTreeId,
            targetTreeName: targetTree?.name ?? targetTreeId,
          });
        } else {
          moveWorkItemsToBacklog(draggedIds, overData.backlogId, overData.treeId);
        }
      } else if (activeData?.type === "workitem" && overData?.type === "workitem-parent") {
        const targetId = overData.workItemId;
        const idsToReparent = draggedIds.filter((id) => id !== targetId);
        idsToReparent.forEach((id) => {
          reparentWorkItem(id, targetId, overData.treeId, overData.backlogId);
        });
        if (idsToReparent.length > 0) {
          const parentTitle = useAppStore.getState().workItems[targetId as string]?.title ?? "item";
          toast({
            title:
              idsToReparent.length === 1
                ? `Reparented to "${parentTitle}"`
                : `Reparented ${idsToReparent.length} items to "${parentTitle}"`,
          });
        }
      } else if (activeData?.type === "workitem" && overData?.type === "workitem-root") {
        draggedIds.forEach((id) => {
          reparentWorkItem(id, null, overData.treeId, overData.backlogId);
        });
        toast({
          title: draggedIds.length === 1 ? "Moved to root (no parent)" : `Moved ${draggedIds.length} items to root`,
        });
      } else if (activeData?.type === "workitem" && overData?.type === "workitem-board-reorder") {
        const treeId = overData.treeId as string;
        const backlogIds = overData.backlogIds as string[];
        if (draggedIds.length > 0) {
          reorderWorkItemInBoard(
            draggedIds[0],
            overData.index as number,
            treeId,
            backlogIds,
            overData.statusKey as string | undefined,
          );
        }
      } else if (activeData?.type === "workitem" && overData?.type === "workitem-reorder") {
        const targetParentId = overData.parentId as string | null;
        const treeId = overData.treeId as string;
        const backlogIds = overData.backlogIds as string[];
        const targetBacklogId = overData.backlogId as string | undefined;
        const reorderStatusKey = overData.statusKey as string | undefined;

        // Board drop zones carry a statusKey — route them through the single
        // board reorder implementation in the store (which reconciles the
        // list ranks of same-status siblings).
        if (reorderStatusKey && draggedIds.length > 0) {
          reorderWorkItemInBoard(draggedIds[0], overData.index as number, treeId, backlogIds, reorderStatusKey);
          return;
        }


        // The whole drop is one action — backlog move, reparent, reorder — so it
        // is all or nothing: cancelling the question below leaves nothing
        // half-moved.
        const performDrop = () => {
          // If the drop zone targets a specific sub-backlog, move items to that backlog first
          // (handles the combined parent-backlog view where items from multiple sub-backlogs
          // are shown together and dragging near items of a different sub-backlog should
          // reassign the item to that sub-backlog).
          if (targetBacklogId) {
            const preMoveStore = useAppStore.getState();
            const idsToMove = draggedIds.filter((id) => {
              const wi = preMoveStore.workItems[id];
              if (!wi) return false;
              const currentBacklogId = wi.backlogAssignments[treeId];
              return !!currentBacklogId && currentBacklogId !== targetBacklogId;
            });
            if (idsToMove.length > 0) moveWorkItemsToBacklog(idsToMove, targetBacklogId, treeId);
          }

          // Re-read store after potential backlog moves so reparent/reorder see latest state.
          const store = useAppStore.getState();
          const reparentedIds: string[] = [];
          draggedIds.forEach((id) => {
            const wi = store.workItems[id];
            if (!wi) return;
            if (getEffectiveParentId(wi, treeId) !== targetParentId) {
              const backlogId = targetBacklogId ?? backlogIds[0] ?? "";
              reparentWorkItem(id, targetParentId, treeId, backlogId);
              reparentedIds.push(id);
            }
          });
          // One reorderWorkItemAmongSiblings call handles all selected items in the
          // same sibling context (the function moves all of selectedWorkItemIds, not
          // just the single workItemId argument).  Calling it once per dragged item
          // would create N redundant undo entries for N dragged items.
          if (draggedIds.length > 0) {
            reorderWorkItemAmongSiblings(draggedIds[0], overData.index as number, treeId, backlogIds);
          }
          if (reparentedIds.length > 0) {
            const newParentTitle = targetParentId
              ? (useAppStore.getState().workItems[targetParentId]?.title ?? "item")
              : null;
            toast({
              title: newParentTitle
                ? reparentedIds.length === 1
                  ? `Reparented to "${newParentTitle}"`
                  : `Reparented ${reparentedIds.length} items to "${newParentTitle}"`
                : reparentedIds.length === 1
                  ? "Moved to root (no parent)"
                  : `Moved ${reparentedIds.length} items to root`,
            });
          }
        };

        // A drop between top-level items sets a top-level rank. The drop index
        // counts rows as shown, which after saving the shown order is the rank
        // order too, so the item lands where it was dropped.
        requestTopLevelRerank({
          treeId,
          backlogId: useAppStore.getState().selectedBacklogIds[0] ?? backlogIds[0],
          backlogIds,
          touchesTopLevel: targetParentId === null,
          proceed: performDrop,
        });
      } else if (activeData?.type === "backlog-node" && overData?.type === "backlog-reorder") {
        const targetParentId = overData.parentId as string | null;
        const treeId = overData.treeId as string;
        const targetIndex = overData.index as number;
        const store = useAppStore.getState();
        // The whole selection when the dragged backlog is part of it, in tree
        // order, landing together at the drop point.
        const ids = backlogsToMove(
          activeData.backlogId as string,
          store.selectedBacklogIds,
          store.backlogs,
          store.backlogTrees,
          targetParentId,
        );
        dropBacklogsAt(useAppStore.getState, ids, targetParentId, treeId, targetIndex);
      } else if (activeData?.type === "backlog-node" && overData?.type === "backlog") {
        const targetBacklogId = overData.backlogId as string;
        const treeId = overData.treeId as string;
        const store = useAppStore.getState();
        const ids = backlogsToMove(
          activeData.backlogId as string,
          store.selectedBacklogIds,
          store.backlogs,
          store.backlogTrees,
          targetBacklogId,
        );
        ids.forEach((backlogId) => moveBacklog(backlogId, targetBacklogId, treeId));
      } else if (activeData?.type === "tree-node" && overData?.type === "tree-reorder") {
        const treeId = activeData.treeId as string;
        const targetIndex = overData.index as number;
        reorderBacklogTree(treeId, targetIndex);
      }
      });
    },
    [
      moveWorkItemToBacklog,
      moveWorkItemsToBacklog,
      removeWorkItemFromTree,
      reparentWorkItem,
      reorderWorkItemAmongSiblings,
      reorderWorkItemInBoard,
      moveBacklog,
      reorderBacklogTree,
      countWithDescendants,
    ],
  );

  const handleCrossTreeChoice = useCallback(
    (value: string) => {
      if (!pendingCrossTree) return;
      const { workItemIds, targetBacklogId, targetTreeId, sourceTreeId } = pendingCrossTree;

      useAppStore.getState().runBulk(() => {
        moveWorkItemsToBacklog(workItemIds, targetBacklogId, targetTreeId);
        if (value === "move") {
          workItemIds.forEach((id) => removeWorkItemFromTree(id, sourceTreeId));
        }
      });
      setPendingCrossTree(null);
    },
    [pendingCrossTree, moveWorkItemsToBacklog, removeWorkItemFromTree],
  );

  // Extract handler functions for reuse in mobile menu
  const handleExportChangelog = () => {
    if (changeLog.length === 0) {
      toast({ title: "No changes logged yet" });
      return;
    }
    const csv = exportChangeLogAsCsv(changeLog);
    navigator.clipboard
      .writeText(csv)
      .then(() => {
        toast({ title: `${changeLog.length} history entries copied to clipboard` });
      })
      .catch(() => {
        toast({ title: "Failed to copy history to clipboard", variant: "destructive" });
      });
  };

  const handleExportMock = () => {
    const { workItems, backlogs, backlogTrees } = useAppStore.getState();
    const strip = (id: string) => id.split("::").pop()!;
    const rawItems = Object.fromEntries(
      Object.values(workItems).map((wi) => {
        const rawId = strip(wi.id);
        return [
          rawId,
          {
            ...wi,
            id: rawId,
            parentId: wi.parentId ? strip(wi.parentId) : null,
            childrenIds: wi.childrenIds.map(strip),
            backlogAssignments: Object.fromEntries(
              Object.entries(wi.backlogAssignments).map(([t, b]) => [strip(t), strip(b)]),
            ),
          },
        ];
      }),
    );
    const rawBacklogs = Object.fromEntries(
      Object.values(backlogs).map((bl) => {
        const rawId = strip(bl.id);
        return [
          rawId,
          {
            ...bl,
            id: rawId,
            parentId: bl.parentId ? strip(bl.parentId) : null,
            childrenIds: bl.childrenIds.map(strip),
            treeId: strip(bl.treeId),
          },
        ];
      }),
    );
    const rawTrees = Object.fromEntries(
      Object.values(backlogTrees).map((bt) => {
        const rawId = strip(bt.id);
        return [rawId, { ...bt, id: rawId, rootBacklogIds: bt.rootBacklogIds.map(strip) }];
      }),
    );
    const code = `// Auto-exported mock data\nexport const mockData = ${JSON.stringify({ workItems: rawItems, backlogs: rawBacklogs, backlogTrees: rawTrees }, null, 2)};\n`;
    navigator.clipboard.writeText(code);
    toast({ title: "Data copied to clipboard" });
  };

  const [showResetDialog, setShowResetDialog] = useState(false);
  const { isSuperuser, scrambleEnabled, toggleScramble } = useScramble();
  const effectiveSuperuser = isSuperuser && !roleOverride;
  const navigate = useNavigate();

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      autoScroll={{
        threshold: { x: 0.18, y: 0.18 },
        acceleration: 25,
        interval: 5,
      }}
    >
      <div className="h-screen flex flex-col overflow-hidden bg-background">
        {/* HEADER */}
        <header className="h-8 md:h-10 border-b flex items-center px-2 md:px-4 gap-2 md:gap-3 bg-[#f5f5f5] shrink-0 shadow-sm z-10">
          <img
            alt="Agilefant"
            className="h-5 md:h-6 w-auto"
            src="/lovable-uploads/0c81b1b5-dc1d-489d-a1c4-51656484d393.png"
          />
          <h1 className="text-sm font-bold tracking-tight hidden sm:block">
            Agilefant
            <sup className="text-xs text-primary ml-0.5 font-mono">2</sup>
          </h1>
          <OrgSwitcher />
          <button
            className="hidden sm:flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors"
            onClick={() => navigate("/settings/team#bells-whistles")}
            title="Bells & Whistles"
          >
            <Settings className="w-3.5 h-3.5 text-primary" />
            <span className="hidden md:inline">Bells &amp; Whistles</span>
          </button>
          <JobSearchRunButton />
          <RoleSimulator />

          <div className="ml-auto flex items-center gap-1 md:gap-2">
            <span className="text-xs md:text-sm text-muted-foreground truncate max-w-[100px] md:max-w-none md:mr-2 md:border-r md:pr-3">
              {user?.user_metadata?.full_name || user?.email || ""}
            </span>

            {/* Desktop: show all buttons */}
            <div className="hidden md:flex items-center gap-2">
              <button
                className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5"
                onClick={handleExportMock}
              >
                <Copy className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Export data</span>
              </button>
              <button
                className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5"
                onClick={handleExportChangelog}
              >
                <ClipboardList className="w-3.5 h-3.5" />
                <span className="hidden lg:inline">Export history</span>
              </button>
              <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
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
                {effectiveSuperuser && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${scrambleEnabled ? "text-primary bg-primary/10 hover:bg-primary/20" : "text-muted-foreground hover:text-foreground hover:bg-accent"}`}
                        onClick={toggleScramble}
                        title="Scramble names"
                      >
                        {scrambleEnabled ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{scrambleEnabled ? "Unscramble names" : "Scramble names"}</TooltipContent>
                  </Tooltip>
                )}
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      onClick={() => setShowUserGuide(true)}
                    >
                      <HelpCircle className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>User Guide</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Mobile: undo/redo + overflow menu */}
            <div className="flex md:hidden items-center gap-0.5">
              <button
                className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${undoStackLength > 0 ? "text-foreground" : "text-muted-foreground/30"}`}
                onClick={undo}
                disabled={undoStackLength === 0}
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${redoStackLength > 0 ? "text-foreground" : "text-muted-foreground/30"}`}
                onClick={redo}
                disabled={redoStackLength === 0}
              >
                <Redo2 className="w-4 h-4" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => setShowUserGuide(true)}>
                    <HelpCircle className="w-4 h-4 mr-2" />
                    User Guide
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleExportMock}>
                    <Copy className="w-4 h-4 mr-2" />
                    Export data
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportChangelog}>
                    <ClipboardList className="w-4 h-4 mr-2" />
                    Export history
                  </DropdownMenuItem>
                  {effectiveSuperuser && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={toggleScramble}>
                        {scrambleEnabled ? <EyeOff className="w-4 h-4 mr-2" /> : <Eye className="w-4 h-4 mr-2" />}
                        {scrambleEnabled ? "Unscramble names" : "Scramble names"}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* MAIN CONTENT */}
        <main className="flex-1 min-h-0 relative">
          {isMobile ? (
            /* Mobile: single-column stacked layout */
            <div className="h-full flex flex-col">
              <div className={`border-b overflow-hidden shrink-0 transition-[height] duration-200 ease-in-out ${mobileBacklogsCollapsed ? "h-8" : "h-[40%]"}`}>
                <BacklogTreePanel
                  mobileCollapsed={mobileBacklogsCollapsed}
                  onToggleMobileCollapse={() => setMobileBacklogsCollapsed((v) => !v)}
                />
              </div>
              <div className="flex-1 min-h-0 overflow-hidden">
                <WorkItemTreePanel />
              </div>
            </div>
          ) : (
            /* Desktop: resizable panels */
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
          )}
        </main>
      </div>

      <DragOverlay dropAnimation={null}>
        {activeDrag && (
          <div className="relative pointer-events-none" style={{ transform: "rotate(-1.5deg)" }}>
            <div className="flex items-center gap-2 bg-card border border-primary shadow-2xl rounded-lg pl-3 pr-4 py-2 text-sm font-semibold max-w-sm ring-2 ring-primary/30">
              <span className="inline-block w-1.5 h-5 rounded-full bg-primary shrink-0" />
              <span className="truncate">{activeDrag.title}</span>
            </div>
            {activeDrag.count && activeDrag.count > 1 && (
              <span className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shadow-lg ring-2 ring-background">
                {activeDrag.count}
              </span>
            )}
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

      <UserGuideDialog open={showUserGuide} onOpenChange={setShowUserGuide} />
      <PersistDebugOverlay />
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
    { keys: ["↑", "↓"], description: "Change selection up/down" },
    { keys: ["U"], description: "Move item up" },
    { keys: ["O"], description: "Move item down" },
    { keys: ["→"], description: "Expand selected item or backlog branch" },
    { keys: ["T"], description: "Move selection to Top" },
    { keys: ["Shift", "B"], description: "Move selection to Bottom" },
    { keys: ["Ctrl/Cmd", "A"], description: "Select all visible work items" },
    { keys: ["Esc"], description: "Deselect items" },
    { keys: ["Ctrl", "Z"], description: "Undo action" },
    { keys: ["/"], description: "Focus search / filter bar" },
    { keys: ["?"], description: "Toggle help" },
    { keys: ["N"], description: "Set status: Not Started" },
    { keys: ["D"], description: "Set status: Done" },
    { keys: ["I"], description: "Set status: In Progress" },
    { keys: ["P"], description: "Set status: Pending" },
    { keys: ["B"], description: "Set status: Blocked" },
    { keys: ["H", "Ctrl/Cmd+K"], description: "Edit hyperlinks" },
    { keys: ["L"], description: "Log spent time" },
    { keys: ["M"], description: "Move to backlog…" },
    { keys: ["R"], description: "Reparent (change parent)…" },
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
