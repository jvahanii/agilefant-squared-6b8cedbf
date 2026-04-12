import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  pointerWithin,
  rectIntersection,
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
import { Undo2, Redo2, Keyboard, RotateCcw, Copy, FileText, SearchCheck, Trash2, FlaskConical, MoreVertical, HelpCircle, Eye, EyeOff, ClipboardList } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { checkDataIntegrity, cleanseData, formatIssueReport } from "@/store/dataIntegrity";
import { exportChangeLogAsCsv } from "@/store/changeLog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OrgSwitcher } from "@/components/OrgSwitcher";
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
    </ScrambleProvider>
  );
}

function AppLayoutInner() {
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
  const changeLog = useAppStore((s) => s.changeLog);

  const [activeDrag, setActiveDrag] = useState<{ id: string; type: string; title: string } | null>(null);
  const [pendingCrossTree, setPendingCrossTree] = useState<PendingCrossTreeDrop | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showUserGuide, setShowUserGuide] = useState(false);

  const isMobile = useIsMobile();

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const activeDragRef = useRef(activeDrag);
  useEffect(() => {
    activeDragRef.current = activeDrag;
  }, [activeDrag]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  // Custom collision detection: prefer pointer-within (exact pointer position) over rect
  // intersection. When multiple droppables contain the pointer, prefer the smaller/more
  // specific ones (e.g. thin reorder zones over large item rows) by sorting by area.
  const collisionDetectionStrategy = useCallback(
    (args: Parameters<typeof rectIntersection>[0]) => {
      const pointerCollisions = pointerWithin(args);
      if (pointerCollisions.length > 0) {
        return [...pointerCollisions].sort((a, b) => {
          const rA = args.droppableRects.get(a.id);
          const rB = args.droppableRects.get(b.id);
          const areaA = rA ? rA.width * rA.height : Infinity;
          const areaB = rB ? rB.width * rB.height : Infinity;
          return areaA - areaB;
        });
      }
      return rectIntersection(args);
    },
    [],
  );

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

      // Ctrl+K / Cmd+K opens the hyperlink dialog
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        const state = useAppStore.getState();
        if (state.selectedWorkItemIds.length > 0) {
          e.preventDefault();
          window.dispatchEvent(new CustomEvent("shortcut:edit-hyperlinks"));
        }
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

              // Move each to a very high index to force bottom placement
              state.selectedWorkItemIds.forEach((id) => {
                state.reorderWorkItemAmongSiblings(id, 999999, treeId, backlogIds);
              });
              toast({ title: `Moved ${state.selectedWorkItemIds.length} items to bottom` });
            }
          } else {
            // Set status to Blocked
            if (state.selectedWorkItemIds.length > 0) {
              e.preventDefault();
              state.selectedWorkItemIds.forEach((id) => state.setWorkItemStatus(id, "blocked"));
              toast({ title: `Marked ${state.selectedWorkItemIds.length} item(s) as Blocked` });
            }
          }
          break;
        }
        case "d": {
          // Set status to Done
          if (state.selectedWorkItemIds.length > 0) {
            e.preventDefault();
            state.selectedWorkItemIds.forEach((id) => state.setWorkItemStatus(id, "done"));
            toast({ title: `Marked ${state.selectedWorkItemIds.length} item(s) as Done` });
          }
          break;
        }
        case "i": {
          // Set status to In Progress
          if (state.selectedWorkItemIds.length > 0) {
            e.preventDefault();
            state.selectedWorkItemIds.forEach((id) => state.setWorkItemStatus(id, "in_progress"));
            toast({ title: `Marked ${state.selectedWorkItemIds.length} item(s) as In Progress` });
          }
          break;
        }
        case "p": {
          // Set status to Pending
          if (state.selectedWorkItemIds.length > 0) {
            e.preventDefault();
            state.selectedWorkItemIds.forEach((id) => state.setWorkItemStatus(id, "pending"));
            toast({ title: `Marked ${state.selectedWorkItemIds.length} item(s) as Pending` });
          }
          break;
        }
        case "n": {
          // Set status to Not Started
          if (state.selectedWorkItemIds.length > 0) {
            e.preventDefault();
            state.selectedWorkItemIds.forEach((id) => state.setWorkItemStatus(id, "not_started"));
            toast({ title: `Marked ${state.selectedWorkItemIds.length} item(s) as Not Started` });
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
              .sort((a, b) => (a.ranks[selectedBacklogId] ?? 0) - (b.ranks[selectedBacklogId] ?? 0));

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
    // Long-press parameters: fires top-rank command when held.
    const LONG_PRESS_DURATION = 350; // ms of held touch before long press fires
    const LONG_PRESS_CANCEL_THRESHOLD = 20; // px of movement that cancels the long press
    let longPressTimer: ReturnType<typeof setTimeout> | null = null;
    let longPressHandled = false;
    // Sentinel rank values for moving to the top or bottom of the list.
    const TOP_POSITION = 0;

    const resetState = () => {
      touchStartRef.current = null;
      touchScrolled = false;
      lockedDirection = null;
      longPressHandled = false;
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };


    const handleTouchStart = (e: TouchEvent) => {
      if (activeDragRef.current) return;
      if (e.touches.length === 1) {
        // Single-finger touch: track for swipe / double-tap detection.
        const touch = e.touches[0];
        touchStartRef.current = { x: touch.clientX, y: touch.clientY };
        touchScrolled = false;
        lockedDirection = null;
        longPressHandled = false;

        // Identify the work item row under the touch point so the long-press
        // action targets that specific item rather than the selected item(s).
        let touchedWorkItemId: string | null = null;
        let touchedBacklogId: string | null = null;
        let touchedTreeId: string | null = null;
        let node: Element | null = document.elementFromPoint(touch.clientX, touch.clientY);
        while (node) {
          const wiId = node.getAttribute("data-work-item-id");
          if (wiId) {
            touchedWorkItemId = wiId;
            touchedBacklogId = node.getAttribute("data-backlog-id");
            touchedTreeId = node.getAttribute("data-tree-id");
            break;
          }
          node = node.parentElement;
        }

        // Start long-press timer; fires top-rank command when the finger is
        // held still long enough.
        longPressTimer = setTimeout(() => {
          longPressTimer = null;
          if (touchScrolled) return;
          // Provide haptic feedback if the browser supports it.
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
          // Long press → move the touched item to top (like T)
          const state = useAppStore.getState();
          if (touchedWorkItemId && touchedTreeId && touchedBacklogId) {
            const backlogIds: string[] = [];
            const collectBacklogs = (id: string) => {
              backlogIds.push(id);
              state.backlogs[id]?.childrenIds.forEach(collectBacklogs);
            };
            collectBacklogs(touchedBacklogId);
            longPressHandled = true;
            state.reorderWorkItemAmongSiblings(touchedWorkItemId, TOP_POSITION, touchedTreeId, backlogIds);
            toast({ title: "Moved item to top" });
          }
        }, LONG_PRESS_DURATION);
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
      // Cancel the long-press timer if the finger moves too much.
      if (longPressTimer !== null) {
        if (Math.max(absDx, absDy) > LONG_PRESS_CANCEL_THRESHOLD) {
          clearTimeout(longPressTimer);
          longPressTimer = null;
        }
      }
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
      const wasLongPressHandled = longPressHandled;
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;
      const dx = endX - touchStartRef.current.x;
      const dy = endY - touchStartRef.current.y;
      resetState();

      // If the long press already handled an action, don't process further.
      if (wasLongPressHandled) return;

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
        const bl = store.backlogs[backlogId];
        if (!bl) return;
        const isDescendant = (parentId: string | null, checkId: string): boolean => {
          if (!parentId) return false;
          if (parentId === checkId) return true;
          return isDescendant(store.backlogs[parentId]?.parentId ?? null, checkId);
        };
        if (targetParentId && isDescendant(targetParentId, backlogId)) return;
        if (bl.parentId !== targetParentId) {
          moveBacklog(backlogId, targetParentId, treeId);
        }
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
      removeWorkItemFromTree,
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

  // Extract handler functions for reuse in mobile menu
  const handleExportChangelog = () => {
    if (changeLog.length === 0) { toast({ title: "No changes logged yet" }); return; }
    const csv = exportChangeLogAsCsv(changeLog);
    navigator.clipboard.writeText(csv).then(() => {
      toast({ title: `${changeLog.length} history entries copied to clipboard` });
    }).catch(() => {
      toast({ title: "Failed to copy history to clipboard", variant: "destructive" });
    });
  };

  const handleExportMock = () => {
    const { workItems, backlogs, backlogTrees } = useAppStore.getState();
    const strip = (id: string) => id.split('::').pop()!;
    const rawItems = Object.fromEntries(Object.values(workItems).map(wi => {
      const rawId = strip(wi.id);
      return [rawId, { ...wi, id: rawId, parentId: wi.parentId ? strip(wi.parentId) : null, childrenIds: wi.childrenIds.map(strip), backlogAssignments: Object.fromEntries(Object.entries(wi.backlogAssignments).map(([t, b]) => [strip(t), strip(b)])) }];
    }));
    const rawBacklogs = Object.fromEntries(Object.values(backlogs).map(bl => {
      const rawId = strip(bl.id);
      return [rawId, { ...bl, id: rawId, parentId: bl.parentId ? strip(bl.parentId) : null, childrenIds: bl.childrenIds.map(strip), treeId: strip(bl.treeId) }];
    }));
    const rawTrees = Object.fromEntries(Object.values(backlogTrees).map(bt => {
      const rawId = strip(bt.id);
      return [rawId, { ...bt, id: rawId, rootBacklogIds: bt.rootBacklogIds.map(strip) }];
    }));
    const code = `// Auto-exported mock data\nexport const mockData = ${JSON.stringify({ workItems: rawItems, backlogs: rawBacklogs, backlogTrees: rawTrees }, null, 2)};\n`;
    navigator.clipboard.writeText(code);
    toast({ title: "Data copied to clipboard" });
  };

  const handleCheckData = () => {
    const state = useAppStore.getState();
    const issues = checkDataIntegrity({ workItems: state.workItems, backlogs: state.backlogs, backlogTrees: state.backlogTrees });
    if (issues.length === 0) { toast({ title: "✅ No broken items found", description: "All 8 integrity checks passed." }); }
    else {
      const report = formatIssueReport(issues);
      navigator.clipboard.writeText(report);
      const categories = [...new Set(issues.map((i) => i.category))];
      toast({ title: `⚠️ Found ${issues.length} issue${issues.length > 1 ? "s" : ""}`, description: `Categories: ${categories.join(", ")}. See console for full report.`, variant: "destructive" });
    }
  };

  const handleCleanseData = () => {
    const state = useAppStore.getState();
    const result = cleanseData({ workItems: state.workItems, backlogs: state.backlogs, backlogTrees: state.backlogTrees });
    const allIssues = [...result.removed, ...result.fixed];
    if (allIssues.length === 0) { toast({ title: "✅ No invalid data found" }); return; }
    const report = formatIssueReport(allIssues);
    navigator.clipboard.writeText(report);
    console.log("Cleanse report:\n" + report);
    useAppStore.setState(result.data);
    toast({ title: `🧹 Cleansed ${allIssues.length} issue${allIssues.length > 1 ? "s" : ""} (${result.removed.length} removed, ${result.fixed.length} fixed)`, description: "Full report copied to clipboard." });
  };

  const handleRunTests = () => {
    const state = useAppStore.getState();
    const issues = checkDataIntegrity({ workItems: state.workItems, backlogs: state.backlogs, backlogTrees: state.backlogTrees });
    const results: string[] = [];
    const pass = (name: string) => results.push(`✅ PASS: ${name}`);
    const fail = (name: string, detail: string) => results.push(`❌ FAIL: ${name} — ${detail}`);
    const categories = ["Ghost Parent", "Orphaned Children", "Circular Reference", "Backlog Displacement", "Tree-Backlog Desync", "Duplicate Rank", "Cross-Org Pollution", "Malformed ID", "Zombie Assignment"];
    categories.forEach((cat) => {
      const catIssues = issues.filter((i) => i.category === cat);
      catIssues.length === 0 ? pass(`No ${cat.toLowerCase()}`) : fail(`${cat} found`, `${catIssues.length} items`);
    });
    const passed = results.filter((r) => r.startsWith("✅")).length;
    const failed = results.filter((r) => r.startsWith("❌")).length;
    const report = `DATA INTEGRITY TEST RESULTS\n${"=".repeat(40)}\n${results.join("\n")}\n${"=".repeat(40)}\n${passed} passed, ${failed} failed of ${results.length} tests`;
    const fullReport = issues.length > 0 ? report + "\n\nDETAILED ISSUES:\n" + formatIssueReport(issues) : report;
    navigator.clipboard.writeText(fullReport);
    toast({ title: failed === 0 ? `✅ All ${passed} tests passed` : `⚠️ ${failed} test${failed > 1 ? "s" : ""} failed`, description: `${passed} passed, ${failed} failed. Report copied to clipboard.`, variant: failed > 0 ? "destructive" : undefined });
  };

  const [showResetDialog, setShowResetDialog] = useState(false);
  const { isSuperuser, scrambleEnabled, toggleScramble } = useScramble();

  return (
    <DndContext sensors={sensors} collisionDetection={collisionDetectionStrategy} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-screen flex flex-col overflow-hidden bg-background">
        {/* HEADER */}
        <header className="h-14 md:h-16 border-b flex items-center px-2 md:px-4 gap-2 md:gap-3 bg-[#f5f5f5] shrink-0 shadow-sm z-10">
          <img
            alt="Agilefant"
            className="h-8 md:h-10 w-auto"
            src="/lovable-uploads/0c81b1b5-dc1d-489d-a1c4-51656484d393.png"
          />
          <h1 className="text-sm font-bold tracking-tight hidden sm:block">
            Agilefant
            <sup className="text-xs text-primary ml-0.5 font-mono">2</sup>
          </h1>
          <OrgSwitcher />

          <div className="ml-auto flex items-center gap-1 md:gap-2">
            <span className="text-xs md:text-sm text-muted-foreground truncate max-w-[100px] md:max-w-none md:mr-2 md:border-r md:pr-3">
              {user?.user_metadata?.full_name || user?.email || ""}
            </span>

            {/* Desktop: show all buttons */}
            <div className="hidden md:flex items-center gap-2">
              <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5" onClick={handleExportMock}>
                <Copy className="w-3.5 h-3.5" /><span className="hidden lg:inline">Export data</span>
              </button>
              <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5" onClick={handleExportChangelog}>
                <ClipboardList className="w-3.5 h-3.5" /><span className="hidden lg:inline">Export history</span>
              </button>
              <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5" onClick={handleCheckData}>
                <SearchCheck className="w-3.5 h-3.5" /><span className="hidden lg:inline">Check Data</span>
              </button>
              <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-destructive hover:text-destructive-foreground transition-colors flex items-center gap-1.5" onClick={handleCleanseData}>
                <Trash2 className="w-3.5 h-3.5" /><span className="hidden lg:inline">Cleanse Data</span>
              </button>
              <button className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5" onClick={handleRunTests}>
                <FlaskConical className="w-3.5 h-3.5" /><span className="hidden lg:inline">Run Tests</span>
              </button>
              <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Reset to mock data?</AlertDialogTitle>
                    <AlertDialogDescription>This will replace all current data with the default mock dataset. This action cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => { useAppStore.getState().resetToMockData(); toast({ title: "Data reset to mock data" }); }}>Reset</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              <div className="flex items-center gap-1 border-l pl-2">
                {isSuperuser && (
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
                    <button className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${undoStackLength > 0 ? "text-foreground hover:bg-accent" : "text-muted-foreground/30"}`} onClick={undo} disabled={undoStackLength === 0}>
                      <Undo2 className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${redoStackLength > 0 ? "text-foreground hover:bg-accent" : "text-muted-foreground/30"}`} onClick={redo} disabled={redoStackLength === 0}>
                      <Redo2 className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Redo (Ctrl+Y)</TooltipContent>
                </Tooltip>
                <button className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" onClick={() => setShowShortcuts((s) => !s)}>
                  <Keyboard className="w-4 h-4" />
                </button>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors" onClick={() => setShowUserGuide(true)}>
                      <HelpCircle className="w-4 h-4" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>User Guide</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Mobile: undo/redo + overflow menu */}
            <div className="flex md:hidden items-center gap-0.5">
              <button className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${undoStackLength > 0 ? "text-foreground" : "text-muted-foreground/30"}`} onClick={undo} disabled={undoStackLength === 0}>
                <Undo2 className="w-4 h-4" />
              </button>
              <button className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${redoStackLength > 0 ? "text-foreground" : "text-muted-foreground/30"}`} onClick={redo} disabled={redoStackLength === 0}>
                <Redo2 className="w-4 h-4" />
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors">
                    <MoreVertical className="w-4 h-4" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => setShowUserGuide(true)}><HelpCircle className="w-4 h-4 mr-2" />User Guide</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleExportMock}><Copy className="w-4 h-4 mr-2" />Export data</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportChangelog}><ClipboardList className="w-4 h-4 mr-2" />Export history</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleCheckData}><SearchCheck className="w-4 h-4 mr-2" />Check Data</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleCleanseData}><Trash2 className="w-4 h-4 mr-2" />Cleanse Data</DropdownMenuItem>
                  <DropdownMenuItem onClick={handleRunTests}><FlaskConical className="w-4 h-4 mr-2" />Run Tests</DropdownMenuItem>
                  {isSuperuser && (
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
              <div className="border-b overflow-hidden shrink-0 h-[40%]">
                <BacklogTreePanel />
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
          <div className="bg-card border-2 border-primary/20 shadow-2xl rounded-lg px-4 py-2 text-sm font-semibold max-w-xs truncate pointer-events-none ring-2 ring-background opacity-60">
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

      <UserGuideDialog open={showUserGuide} onOpenChange={setShowUserGuide} />
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
    { keys: ["→"], description: "Expand selected item or backlog branch" },
    { keys: ["T"], description: "Move selection to Top" },
    { keys: ["Shift", "B"], description: "Move selection to Bottom" },
    { keys: ["Esc"], description: "Deselect items" },
    { keys: ["Ctrl", "Z"], description: "Undo action" },
    { keys: ["?"], description: "Toggle help" },
    { keys: ["D"], description: "Set status: Done" },
    { keys: ["I"], description: "Set status: In Progress" },
    { keys: ["P"], description: "Set status: Pending" },
    { keys: ["B"], description: "Set status: Blocked" },
    { keys: ["N"], description: "Set status: Not Started" },
    { keys: ["H", "Ctrl/Cmd+K"], description: "Edit hyperlinks" },
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
