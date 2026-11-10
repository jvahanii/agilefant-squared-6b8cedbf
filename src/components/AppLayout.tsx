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
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { BacklogTreePanel } from "@/components/BacklogTreePanel";
import { WorkItemTreePanel } from "@/components/WorkItemTreePanel";
import { useAppStore } from "@/store/appStore";
import { ActionPrompt } from "@/components/ActionPrompt";
import { DeleteGuardHost } from "@/components/DeleteGuardHost";
import { RerankGuardHost } from "@/components/RerankGuardHost";
import { JobSearchRunButton } from "@/components/JobSearchRunButton";
import { JiraSyncHeaderButton } from "@/components/JiraSyncHeaderButton";
import { PatternTrainerHeaderButton } from "@/components/PatternTrainerHeaderButton";
import { handleShortcut, shortcutRowsByGroup } from "@/lib/shortcuts";
import { PersistDebugOverlay } from "@/components/PersistDebugOverlay";
import { useBurnupDialogStore } from "@/store/burnupDialogStore";
import { ListScrambleDialogHost } from "@/components/ListScrambleDialogHost";
import { JiraCreateSpaceDialogHost } from "@/components/JiraCreateSpaceDialogHost";
import { CatchingUpGuard } from "@/components/CatchingUpGuard";
import {
  Undo2,
  Redo2,
  Keyboard,
  Copy,
  MoreVertical,
  HelpCircle,
  Eye,
  EyeOff,
  ClipboardList,
  Settings,
  Clock,
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
import { backlogsToMove } from "@/lib/backlogMove";
import {
  answerCrossTree,
  countWithDescendants,
  handleDrop,
  type PendingCrossTreeDrop,
} from "@/components/dragAndDrop/drops";

// Lazy-loaded so the recharts bundle (via BurnupChartDialog) is not part of the
// initial cold-start payload; it's only fetched when a burnup chart is opened.
const BurnupChartDialog = lazy(() =>
  import("@/components/BurnupChartDialog").then((m) => ({ default: m.BurnupChartDialog })),
);

// Lazy for the same reason. Until it had a door here the report was reachable
// only from the settings pages, which are lazy themselves, so it never weighed
// on start-up; a static import would have added it to every cold start.
const TimesheetBrowserDialog = lazy(() =>
  import("@/components/TimesheetBrowserDialog").then((m) => ({ default: m.TimesheetBrowserDialog })),
);

// What starts a drag: a clear ~8 px gesture with the mouse, so that a click or
// a text selection does not, and a press held 200 ms on touch.
//
// Made once, here: given as new objects each time the layout drew, which any
// change to an item makes it do, they made the drag sensors new too, and with
// them every row's drag listeners, so every row in the list drew again.
const MOUSE_SENSOR_OPTIONS = { activationConstraint: { distance: 8 } };
const TOUCH_SENSOR_OPTIONS = { activationConstraint: { delay: 200, tolerance: 8 } };

export default function AppLayout() {
  return (
    <ScrambleProvider>
      <AppLayoutInner />
      <DeleteGuardHost />
      <RerankGuardHost />
      <BurnupDialogHost />
      <ListScrambleDialogHost />
      <JiraCreateSpaceDialogHost />
      <CatchingUpGuard />
    </ScrambleProvider>
  );
}

function BurnupDialogHost() {
  const { scope, open, close } = useBurnupDialogStore();
  // Mounted only once a chart has been asked for. Rendered from the start —
  // closed, but rendered — it fetched its lazy chunk, and the charting library
  // with it, on every start: some 370 KB of script for a dialog nobody had
  // opened, read and compiled on a phone while the items were waiting.
  if (!scope) return null;
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
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const undoStackLength = useAppStore((s) => s.undoStack.length);
  const redoStackLength = useAppStore((s) => s.redoStack.length);
  const changeLog = useAppStore((s) => s.changeLog);

  const [activeDrag, setActiveDrag] = useState<{ id: string; type: string; title: string; count?: number } | null>(null);
  const [pendingCrossTree, setPendingCrossTree] = useState<PendingCrossTreeDrop | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showUserGuide, setShowUserGuide] = useState(false);
  const [showTimesheet, setShowTimesheet] = useState(false);
  const [mobileBacklogsCollapsed, setMobileBacklogsCollapsed] = useState(false);

  const isMobile = useIsMobile();

  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const activeDragRef = useRef(activeDrag);
  useEffect(() => {
    activeDragRef.current = activeDrag;
  }, [activeDrag]);

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR_OPTIONS),
    useSensor(TouchSensor, TOUCH_SENSOR_OPTIONS),
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

    // Every shortcut, what it is for and what it does: lib/shortcuts.ts.
    const handler = (e: KeyboardEvent) =>
      handleShortcut(e, {
        dialogWasOpen,
        toggleShortcutsOverlay: () => setShowShortcuts((s) => !s),
        openTimesheet: () => setShowTimesheet(true),
      });
    window.addEventListener("keydown", noteDialogOpen, true);
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", noteDialogOpen, true);
      window.removeEventListener("keydown", handler);
    };
  }, []);

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
  // Selected rather than read through isTimeLoggingEnabled, which takes a
  // snapshot: the menu must redraw when the settings arrive, when someone
  // switches logging on, and when the organization changes.
  const timeLoggingOn = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.timeLoggingEnabled ?? false);
  const orgName = useOrgStore(
    (s) => s.memberships.find((m) => m.organization_id === s.activeOrgId)?.organization_name ?? "",
  );
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
          "List Displacement",
          "Tree-List Desync",
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
    [],
  );

  // What each drop does: components/dragAndDrop/drops.ts.
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;
    handleDrop(active.data.current, over.data.current, setPendingCrossTree);
  }, []);

  const handleCrossTreeChoice = useCallback(
    (value: string) => {
      if (!pendingCrossTree) return;
      answerCrossTree(pendingCrossTree, value);
      setPendingCrossTree(null);
    },
    [pendingCrossTree],
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
          {/* For the Jira workshop; to come out of the header again after it. */}
          <JiraSyncHeaderButton />
          <PatternTrainerHeaderButton />
          <RoleSimulator />

          <div className="ml-auto flex items-center gap-1 md:gap-2">
            <span className="text-xs md:text-sm text-muted-foreground truncate max-w-[100px] md:max-w-none md:mr-2 md:border-r md:pr-3">
              {user?.user_metadata?.full_name || user?.email || ""}
            </span>

            {/* Desktop: show all buttons */}
            <div className="hidden md:flex items-center gap-2">
              {/* Its own button here, not only in the ⋮ menu: that menu exists
                  only on narrow screens, so a door placed in it alone was no
                  door at all on a desktop. First in the row because it is a
                  view, and the two after it are exports. */}
              {timeLoggingOn && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      aria-label="Logged time"
                      className="px-2.5 py-1.5 text-xs font-medium rounded-md border bg-background hover:bg-accent transition-colors flex items-center gap-1.5"
                      onClick={() => setShowTimesheet(true)}
                    >
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      <span className="hidden lg:inline">Logged time</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Who spent time on what (Shift+L)</TooltipContent>
                </Tooltip>
              )}
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
                  <button
                    aria-label="More"
                    className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <MoreVertical className="w-4 h-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem onClick={() => setShowUserGuide(true)}>
                    <HelpCircle className="w-4 h-4 mr-2" />
                    User Guide
                  </DropdownMenuItem>
                  {/* Until this entry the report was reachable only from
                      Settings, under a name that read as maintenance, and was
                      easily forgotten. It belongs where the time is logged. */}
                  {timeLoggingOn && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowTimesheet(true)}>
                        <Clock className="w-4 h-4 mr-2" />
                        Logged time
                        <span className="ml-auto pl-2 text-[10px] text-muted-foreground">Shift+L</span>
                      </DropdownMenuItem>
                    </>
                  )}
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
          <div className="relative pointer-events-none opacity-75" style={{ transform: "rotate(-1.5deg)" }}>
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
      {/* Mounted only once asked for, so the lazy chunk is fetched on first
          open rather than on start-up. */}
      {showTimesheet && (
        <Suspense fallback={null}>
          <TimesheetBrowserDialog open={showTimesheet} onOpenChange={setShowTimesheet} orgName={orgName} />
        </Suspense>
      )}
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

  // The same list the user guide shows, from the shortcuts themselves (lib/shortcuts.ts).
  const sections = shortcutRowsByGroup();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border shadow-2xl w-full max-w-sm mx-4 rounded-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <div className="px-6 py-4 border-b bg-muted/30">
          <h3 className="text-sm font-bold flex items-center gap-2">
            <Keyboard className="w-4 h-4" /> Keyboard Shortcuts
          </h3>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-4 space-y-4">
          {sections.map(({ group, rows }) => (
            <div key={group} className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group}</p>
              {rows.map((s, i) => (
                <div key={i} className="flex items-center justify-between gap-3 group">
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                    {s.description}
                  </span>
                  <div className="flex shrink-0 items-center gap-1">
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
