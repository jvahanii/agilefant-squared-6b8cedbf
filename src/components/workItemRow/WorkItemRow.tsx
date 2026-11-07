/**
 * A work item's row in the list: its handle, chevron, number, status, stars,
 * deadline and name, the marks after the name, its points and its buttons —
 * and, around it, its right-click menu (RowMenu), the dialogs it opens
 * (RowDialogs), and the shortcuts it answers for the selection.
 */
import { memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { ChevronDown, ChevronRight, Clock, GripVertical, Link2, Lock, Plus, RotateCcw, SlidersHorizontal, Tag, Trash2 } from "lucide-react";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/store/appStore";
import { useBacklogStatusesStore, getEffectiveStatuses } from "@/store/backlogStatusesStore";
import { useSnoozeStore } from "@/store/snoozeStore";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { type WorkItemStatus } from "@/types/models";
import { useIsMobile } from "@/hooks/use-mobile";
import { toast } from "@/hooks/use-toast";
import { useWorkItemFinancialTotals } from "@/hooks/useFinancialTotals";
import { focusForEdit } from "@/lib/focusEdit";
import { cn } from "@/lib/utils";
import { scrambleName } from "@/lib/scramble";
import { peekCurrentUser } from "@/lib/currentUser";
import { rowClickIntent } from "@/lib/rowClick";
import { effectiveChildren } from "@/lib/workItemRows";
import { useWorkItemTotalMinutes } from "@/lib/timeTotals";
import { formatDeadline, isDeadlinePassed } from "@/lib/workItemDeadline";
import { StarRating } from "@/components/StarRating";
import { IconizedTitle } from "@/components/IconizedTitle";
import { formatDuration } from "../TimeLogDialog";
import { FinancialTotalsBadge } from "../FinancialTotalsBadge";
import { LabelPicker } from "../LabelPicker";
import { LabelNames } from "../LabelNames";
import { JiraIssueTag } from "../JiraIssueTag";
import { InlineWorkItemInput } from "./InlineWorkItemInput";
import { RowBadges, RowWhereabouts } from "./RowBadges";
import { ItemDialogs } from "./ItemDialogs";
import { ItemMenu, type ItemActions, type ItemStatus } from "./ItemMenu";
import { rankToTopOfList, useCommonItemActions, useItemFeatures } from "./itemActions";
import { RowPoints } from "./RowPoints";
import { RowTeamsDropdown } from "./RowTeams";
import {
  DRAG_THRESHOLD_PX_SQUARED,
  LabelFilterContext,
  RunningNumberContext,
  SELECTION_SHORTCUTS,
  SharedDataContext,
  changeSelectionOrItem,
  isFirstSelected,
  noteRowDrawn,
  scrollWorkItemIntoView,
  selectionOrItem,
} from "./rowShared";
import { useRowDialogs } from "./useRowDialogs";

export interface WorkItemNodeProps {
  workItemId: string;
  depth: number;
  treeId: string;
  backlogId: string;
  allBacklogIds: string[];
  parentBacklogId?: string;
  isScrambled: boolean;
  selectedBacklogId: string;
  onSelect: (id: string, multi: boolean, shift: boolean) => void;
  setViewMode: (mode: "list" | "board") => void;
}

export const WorkItemNode = memo(function WorkItemNode(props: WorkItemNodeProps) {
  const labelFilter = useContext(LabelFilterContext);
  const isSnoozed = useSnoozeStore((s) => s.isSnoozed(props.workItemId));
  if (isSnoozed) return null;
  if (labelFilter !== null && !labelFilter.has(props.workItemId)) return null;
  return <WorkItemNodeContent {...props} />;
});

function WorkItemNodeContent({
  workItemId,
  depth,
  treeId,
  backlogId,
  allBacklogIds,
  parentBacklogId,
  isScrambled,
  onSelect,
  setViewMode,
  selectedBacklogId,
}: WorkItemNodeProps) {
  const isChildBacklog = backlogId !== selectedBacklogId;
  const runningNumber = useContext(RunningNumberContext)?.get(workItemId);
  const shared = useContext(SharedDataContext)!;
  const item = useAppStore((s) => s.workItems[workItemId]);

  useEffect(() => noteRowDrawn(workItemId), [workItemId]);
  const expanded = useAppStore((s) => s.expandedWorkItems.has(workItemId));
  const isSelected = useAppStore((s) => s.selectedWorkItemIds.includes(workItemId));
  const isMultiSelected = useAppStore((s) => s.selectedWorkItemIds.length > 1);
  const toggleExpand = useAppStore((s) => s.toggleWorkItemExpand);
  const expandRecursive = useAppStore((s) => s.expandWorkItemsRecursive);
  const collapseRecursive = useAppStore((s) => s.collapseWorkItemsRecursive);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const isMobile = useIsMobile();
  const { activeOrgId, labelsVisible, timeLoggingVisible, savingsIncomeVisible, teams } = shared;

  // What shows, and what the menu offers: the organization's switches, and
  // for some the item's own list's too.
  const features = useItemFeatures(item, treeId);
  const {
    points: pointsVisible,
    ratingsShown: ratingsVisible,
    deadlines: deadlinesVisible,
    createdDates: createdDatesVisible,
    startEndShown: startEndDatesVisible,
  } = features;
  const itemFinancials = useWorkItemFinancialTotals(workItemId);
  const itemTotalMinutesCached = useWorkItemTotalMinutes(workItemId);
  const itemTotalMinutes = timeLoggingVisible ? itemTotalMinutesCached : 0;

  const { labelsMap, byEntity } = shared;
  const itemLabels = useMemo(() => {
    if (!labelsVisible) return [];
    const labelIds = byEntity[`work_item:${workItemId}`] ?? [];
    return labelIds
      .map((id) => labelsMap[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [labelsVisible, byEntity, labelsMap, workItemId]);

  // Per-backlog effective statuses (walks up parent chain until a materialized
  // set is found; falls back to defaults). Board columns and status list are
  // unified — column labels ARE status labels. Subscribed so that realtime
  // updates draw the row again.
  const statusesByBacklog = useBacklogStatusesStore((s) => s.statusesByBacklog);
  const treeStatuses = useMemo<ItemStatus[]>(
    () => getEffectiveStatuses(backlogId).map((s) => ({ key: s.key, label: s.label, color: s.color, displayLabel: s.label })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backlogId, statusesByBacklog],
  );

  const dialogs = useRowDialogs();
  const { show } = dialogs;
  const [isAdding, setIsAdding] = useState(false);
  const [isAddingSibling, setIsAddingSibling] = useState(false);
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [isEditingPoints, setIsEditingPoints] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const dragStartedRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  // A plain left click on an already-selected item opens the name for editing
  // (like a file manager). The click is delayed a beat so a fast second click
  // still counts as a double-click and cancels it.
  const clickRenameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scrambling replaces the stored title with its Moomin scramble for everyone;
  // only whoever scrambled it can read it back, with their PIN.
  const scrambledBy = useScrambledItemsStore((s) => s.byItem.get(workItemId));
  const isNameScrambled = useScrambledItemsStore((s) => s.byItem.has(workItemId));
  const scrambledByMe = isNameScrambled && scrambledBy === (peekCurrentUser()?.id ?? null);

  // The children this row expands into: those under it in *this* tree and in
  // a backlog in view. childrenIds spans every tree, so it can't be used as is.
  const visibleBacklogSet = useMemo(() => new Set(allBacklogIds), [allBacklogIds]);
  const shownChildCount = useAppStore((s) => effectiveChildren(workItemId, s.workItems, treeId, visibleBacklogSet).length);
  const hasChildren = shownChildCount > 0;

  const startEditingTitle = () => {
    if (!item) return;
    // Double-click, F2 and the menu all come through here. The database keeps
    // the scrambled title whatever is sent, so say so rather than letting
    // someone type into a field whose result is quietly dropped.
    if (isNameScrambled) {
      toast({
        title: "This name is scrambled",
        description: scrambledByMe
          ? "Unscramble it before renaming it."
          : "Only the person who scrambled it can change it.",
      });
      return;
    }
    setEditTitle(item.title);
    setIsEditingTitle(true);
  };
  const commitTitle = () => {
    const trimmed = editTitle.trim();
    if (item && trimmed && trimmed !== item.title) useAppStore.getState().renameWorkItem(workItemId, trimmed);
    setIsEditingTitle(false);
  };

  /** What the row's menu, buttons and shortcuts act on: the item, or the selection it is part of. */
  const actOn = useCallback(() => selectionOrItem(workItemId), [workItemId]);
  const common = useCommonItemActions({ workItemId, actOn, dialogs, activeOrgId });
  const actions: ItemActions = {
    ...common,
    rankToTop: () => item && rankToTopOfList(item, treeId, backlogId),
    startRename: startEditingTitle,
    insertIcon: (shortcode) => {
      const ta = titleRef.current;
      if (isEditingTitle && ta) {
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        setEditTitle(editTitle.slice(0, start) + shortcode + editTitle.slice(end));
        requestAnimationFrame(() => {
          ta.focus();
          const pos = start + shortcode.length;
          ta.setSelectionRange(pos, pos);
        });
      } else if (item) {
        setEditTitle(item.title + shortcode);
        setIsEditingTitle(true);
      }
    },
    // The points are edited in place on a desktop; a phone has them in the
    // attributes sheet, which the menu opens without this.
    editPoints: isMobile ? undefined : () => setIsEditingPoints(true),
    addChild: () => {
      if (!useAppStore.getState().expandedWorkItems.has(workItemId)) toggleExpand(workItemId);
      setIsAdding(true);
    },
    // Only where the organization has boards: elsewhere the board is never
    // shown, and the entry only saved a view nobody could see.
    viewElsewhere: !features.boards ? undefined : {
      label: "View in board",
      view: "board",
      run: () => {
        setViewMode("board");
        // Select the item after view mode change and React reconciliation
        setTimeout(() => {
          useAppStore.getState().selectWorkItem(workItemId, false);
        }, 100);
      },
    },
  };
  // The shortcut listeners below stay bound; they call the latest of these.
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const teamCountRef = useRef(teams.length);
  teamCountRef.current = teams.length;


  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `workitem-${workItemId}`,
    data: {
      type: "workitem",
      workItemId,
      treeId,
      get selectedIds() {
        return selectionOrItem(workItemId);
      },
    },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `workitem-drop-${workItemId}`,
    data: { type: "workitem-parent", workItemId, treeId, backlogId },
  });

  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  // On desktop: apply dnd-kit listeners to the entire row. Extract onPointerDown so
  // it can be merged with our custom tracking handler.
  const { onPointerDown: dndPointerDown, ...restListeners } = !isMobile ? (listeners ?? {}) : {};

  useEffect(() => {
    if (isEditingTitle && titleRef.current) {
      focusForEdit(titleRef.current, isMobile);
      titleRef.current.style.height = "auto";
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    }
  }, [isEditingTitle, isMobile]);

  // The shortcuts that act on the selection. Each is answered by the row of the
  // selection's first item, except the two that add: a child under each
  // selected item, and a sibling after each.
  useEffect(() => {
    if (!isSelected) return;
    const first = (act: () => void) => () => {
      if (isFirstSelected(workItemId)) act();
    };
    const answers: Record<(typeof SELECTION_SHORTCUTS)[number], () => void> = {
      "shortcut:add-child-workitem": () => actionsRef.current.addChild(),
      "shortcut:add-sibling-workitem": () => {
        if (useAppStore.getState().selectedWorkItemIds.includes(workItemId)) setIsAddingSibling(true);
      },
      "shortcut:delete-selected": first(() => actionsRef.current.remove()),
      "shortcut:duplicate-selected": first(() => actionsRef.current.duplicate()),
      "shortcut:edit-hyperlinks": first(() => show("hyperlinks")),
      "shortcut:log-time": first(() => show("timeLog")),
      "shortcut:move-to-parent": first(() => actionsRef.current.openReparent()),
      "shortcut:move-to-backlog": first(() => actionsRef.current.openMoveToList()),
      "shortcut:open-team-assign": first(() => {
        if (teamCountRef.current > 0) setTeamDropdownOpen(true);
      }),
    };
    const names = Object.keys(answers) as (keyof typeof answers)[];
    for (const name of names) window.addEventListener(name, answers[name]);
    return () => {
      for (const name of names) window.removeEventListener(name, answers[name]);
    };
  }, [isSelected, workItemId, show]);

  // Listen for inline title-edit requests (used after duplicate to focus the new item).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ workItemId?: string }>).detail;
      if (!detail || detail.workItemId !== workItemId) return;
      setEditTitle(useAppStore.getState().workItems[workItemId]?.title ?? "");
      setIsEditingTitle(true);
    };
    window.addEventListener("shortcut:edit-title", handler);
    return () => window.removeEventListener("shortcut:edit-title", handler);
  }, [workItemId]);

  // On mount, if this is the first selected item, scroll it into view so:
  //  - a freshly created item is visible immediately (addWorkItem selects it), and
  //  - the previously-selected item is visible after restore (especially on mobile
  //    where the panel mounts fresh after a tab switch).
  // Use the deferred scroll helper because the row's position is still estimated
  // / unstable until the parent virtualizer has finished measuring rows.
  useEffect(() => {
    if (isFirstSelected(workItemId)) scrollWorkItemIntoView(workItemId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-expand a collapsed branch when a drag is held over it for a short time.
  useEffect(() => {
    if (!isOver || isDragging || !item || shownChildCount === 0 || expanded) return;
    const timer = setTimeout(() => {
      toggleExpand(workItemId);
    }, 600);
    return () => clearTimeout(timer);
  }, [isOver, isDragging, item, shownChildCount, expanded, toggleExpand, workItemId]);

  if (!item) return null;

  const setStatus = (status: WorkItemStatus) => {
    const { setWorkItemStatus } = useAppStore.getState();
    changeSelectionOrItem(workItemId, (id) => setWorkItemStatus(id, status));
  };
  const status = treeStatuses.find((s) => s.key === item.status);

  return (
    <>
      <div
        ref={combinedRef}
        style={isDragging ? { opacity: 0.4 } : undefined}
      >
        <ContextMenu>
        <ContextMenuTrigger asChild>
        <div
          {...attributes}
          {...restListeners}
          data-work-item-id={workItemId}
          data-backlog-id={backlogId}
          data-tree-id={treeId}
          title={timeLoggingVisible && itemTotalMinutes > 0 ? `${formatDuration(itemTotalMinutes)} logged` : undefined}
          className={`
            flex items-start gap-1.5 px-3 py-px rounded-md
            transition-all duration-150 ease-out group
            border select-none
            ${!isMobile ? "cursor-grab active:cursor-grabbing" : ""}
            ${isChildBacklog ? "text-muted-foreground" : ""}
            ${
              isSelected
                ? "bg-selection/10 border-selection/30 ring-1 ring-selection/30"
                : "border-transparent hover:bg-muted hover:border-border"
            }
            ${isDragging ? "shadow-lg bg-card" : ""}
            ${isOver && !isDragging ? "drag-over" : ""}
          `}
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
          onPointerDown={(e) => {
            dndPointerDown?.(e);
            dragStartedRef.current = false;
            pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
          }}
          onPointerMove={(e) => {
            if (!pointerDownPosRef.current) return;
            const dx = e.clientX - pointerDownPosRef.current.x;
            const dy = e.clientY - pointerDownPosRef.current.y;
            if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX_SQUARED) {
              dragStartedRef.current = true;
            }
          }}
          onPointerUp={() => {
            pointerDownPosRef.current = null;
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (dragStartedRef.current) return;
            const isMulti = e.ctrlKey || e.metaKey;
            const isShift = e.shiftKey;
            if (rowClickIntent({ isMulti, isShift, isMobile, isSelected, isMultiSelected }) === "rename") {
              if (clickRenameTimerRef.current) clearTimeout(clickRenameTimerRef.current);
              clickRenameTimerRef.current = setTimeout(() => {
                clickRenameTimerRef.current = null;
                // The textarea only exists while the name is being edited, and
                // a pointer still down means a drag or a second press is under way.
                if (!titleRef.current && !pointerDownPosRef.current) startEditingTitle();
              }, 500);
              return;
            }
            onSelect(workItemId, isMulti, isShift);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (dragStartedRef.current) return;
            if (clickRenameTimerRef.current) {
              clearTimeout(clickRenameTimerRef.current);
              clickRenameTimerRef.current = null;
            }
            setStatus(item.status === "done" ? "not_started" : "done");
          }}
        >
          {/* On mobile: drag handle is the only drag target (preserves row-scroll).
              On desktop: the entire row is draggable; handle is a visual affordance. */}
          <div
            {...(isMobile ? listeners : {})}
            data-drag-handle="true"
            className={`w-4 h-4 mt-0.5 flex items-center justify-center shrink-0 ${isChildBacklog ? "text-muted-foreground/30" : "text-muted-foreground/40"} ${isMobile ? "touch-none cursor-grab active:cursor-grabbing" : ""}`}
          >
            <GripVertical className="w-3.5 h-3.5" />
          </div>
          <button
            /* The chevron is only 16px, too small a target to tap. The
               ::before layer widens what takes the click to ~28x28 without
               moving anything: sideways it fills the 6px gaps on each side,
               and vertically it stays within the row so it can never toggle
               the row above or below. */
            className={`relative w-4 h-4 mt-0.5 flex items-center justify-center shrink-0 ${isChildBacklog ? "text-muted-foreground/50" : "text-muted-foreground"} hover:text-foreground transition-colors before:absolute before:-inset-x-2 before:-top-1.5 before:-bottom-1.5 before:content-['']`}
            onClick={(e) => {
              e.stopPropagation();
              if (!hasChildren) return;
              if (e.shiftKey) toggleExpand(workItemId);
              else if (expanded) collapseRecursive(workItemId);
              else expandRecursive(workItemId);
            }}
          >
            {hasChildren ? (
              expanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )
            ) : null}
          </button>
          <span className="text-sm tabular-nums text-muted-foreground shrink-0 w-6 text-right select-none" aria-hidden="true">
            {runningNumber}
          </span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* The dot is 12px, too small a target to hit reliably. The
                  ::before layer widens what takes the click to 24×20 without
                  moving anything: sideways it fills the row's 6px gap on each
                  side, and it stops at the row's own top and bottom, so it
                  can never open the menu of the row above or below. */}
              <button
                className="relative w-3 h-3 mt-1 rounded-full shrink-0 border border-background/50 transition-transform hover:scale-125 before:absolute before:-inset-x-1.5 before:-top-1 before:-bottom-1"
                style={{ backgroundColor: status?.color ?? treeStatuses[0]?.color ?? "#94a3b8" }}
                onClick={(e) => e.stopPropagation()}
                title={status?.displayLabel ?? item.status}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[140px]">
              {treeStatuses.map((s) => (
                <DropdownMenuItem
                  key={s.key}
                  onClick={(e) => {
                    e.stopPropagation();
                    setStatus(s.key as WorkItemStatus);
                  }}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  {s.displayLabel}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Stars before the title, where they can be read and set down a
              list at a glance. Only where the organization rates its items. */}
          {ratingsVisible && (
            <StarRating
              className="mt-0.5"
              rating={item.rating}
              label={item.title}
              onRate={(rating) => {
                // A rating given to a multi-selection goes to all of it, as a
                // status does.
                const { setWorkItemRating } = useAppStore.getState();
                changeSelectionOrItem(workItemId, (id) => setWorkItemRating(id, rating));
              }}
            />
          )}

          {/* The deadline before the title, where the importer used to write it
              into the name as "0930": a list still reads date first. Red once
              it has gone by. Clicking it changes it. */}
          {deadlinesVisible && item.deadline && (
            <button
              type="button"
              className={cn(
                "mt-0.5 shrink-0 rounded px-1 text-xs tabular-nums hover:bg-muted",
                isDeadlinePassed(item.deadline) ? "text-destructive" : "text-muted-foreground",
              )}
              title={`Deadline ${item.deadline}${isDeadlinePassed(item.deadline) ? " — passed" : ""}`}
              aria-label={`Deadline ${formatDeadline(item.deadline)}${isDeadlinePassed(item.deadline) ? ", passed" : ""}. Change`}
              onClick={(e) => {
                e.stopPropagation();
                show("deadline");
              }}
            >
              {formatDeadline(item.deadline)}
            </button>
          )}

          {isEditingTitle ? (
            <textarea
              ref={titleRef}
              rows={1}
              className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-1 py-0 resize-none overflow-hidden min-h-[1.25rem]"
              value={editTitle}
              onChange={(e) => {
                setEditTitle(e.target.value);
                e.target.style.height = "auto";
                e.target.style.height = `${e.target.scrollHeight}px`;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commitTitle();
                }
                if (e.key === "Escape") setIsEditingTitle(false);
              }}
              onBlur={commitTitle}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 text-sm break-words whitespace-normal py-0.5">
              <span
                className="cursor-text"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (clickRenameTimerRef.current) {
                    clearTimeout(clickRenameTimerRef.current);
                    clickRenameTimerRef.current = null;
                  }
                  startEditingTitle();
                }}
              >
                {isNameScrambled && (
                  <Lock
                    className="mr-1 inline-block h-3 w-3 align-[-1px] text-muted-foreground"
                    aria-label="This name is scrambled"
                  />
                )}
                {isScrambled ? scrambleName(item.title) : <IconizedTitle title={item.title} />}
              </span>
              {labelsVisible && <LabelNames labels={itemLabels} />}
              <JiraIssueTag workItemId={workItemId} />
              {teams.length > 0 && (
                <RowTeamsDropdown
                  workItemId={workItemId}
                  teams={teams}
                  activeOrgId={activeOrgId}
                  open={teamDropdownOpen}
                  onOpenChange={setTeamDropdownOpen}
                />
              )}
            </span>
          )}

          <RowBadges
            item={item}
            startEndDatesVisible={startEndDatesVisible}
            createdDatesVisible={createdDatesVisible}
            onOpen={(dialog) => show(dialog)}
          />
          <RowWhereabouts
            item={item}
            depth={depth}
            treeId={treeId}
            backlogId={backlogId}
            parentBacklogId={parentBacklogId}
            isChildBacklog={isChildBacklog}
            isScrambled={isScrambled}
          />

          <div className="flex items-start gap-1 mt-0.5">
            {pointsVisible && (
              <RowPoints
                item={item}
                treeId={treeId}
                editing={isEditingPoints}
                onEditingChange={setIsEditingPoints}
                onOpenAttributes={() => show("attributes")}
              />
            )}

            {savingsIncomeVisible && itemFinancials.hasData && (
              <FinancialTotalsBadge
                savings={itemFinancials.savings}
                income={itemFinancials.income}
                currency={itemFinancials.currency}
              />
            )}

            {/* Mobile actions: add a child, or open the item's attributes
                (deadline, dates, points and the rest). The long-press context
                menu is unreliable on touch — the row is user-select:none,
                which suppresses the contextmenu event on Android Chrome — so
                the sheet is the dependable way to everything else. */}
            <div className={`flex md:hidden items-center gap-0.5 shrink-0 ${!isSelected ? "invisible" : ""}`}>
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label={`Edit attributes of ${item.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  show("attributes");
                }}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.addChild();
                }}
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            {/* Desktop hover actions */}
            <div className="hidden md:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.addChild();
                }}
                title="Add child item (Shift+Enter)"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  show("respawn");
                }}
                title="Respawn settings"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  show("hyperlinks");
                }}
                title="Manage hyperlinks (H)"
              >
                <Link2 className="w-3.5 h-3.5" />
              </button>
              {labelsVisible && (
                <LabelPicker
                  entityType="work_item"
                  entityId={workItemId}
                  entityIds={isSelected && isMultiSelected ? useAppStore.getState().selectedWorkItemIds : undefined}
                >
                  <button
                    className="flex items-center gap-0.5 h-5 px-0.5 min-w-[1.25rem] justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    title="Labels"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {itemLabels.length > 0 ? (
                      <span className="text-[10px] font-medium tabular-nums leading-none">{itemLabels.length}</span>
                    ) : (
                      <Tag className="w-3.5 h-3.5" />
                    )}
                  </button>
                </LabelPicker>
              )}
              {timeLoggingVisible && (
                <button
                  className="flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors px-0.5 min-w-[1.25rem] h-5"
                  onClick={(e) => {
                    e.stopPropagation();
                    show("timeLog");
                  }}
                  title="Log time"
                >
                  {itemTotalMinutes > 0 ? (
                    <span className="text-xs font-medium tabular-nums">{formatDuration(itemTotalMinutes)}</span>
                  ) : (
                    <Clock className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  actions.remove();
                }}
                title="Delete item (Del)"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            {hasChildren && (
              <span className="text-xs text-muted-foreground tabular-nums min-w-[12px] text-right">
                {shownChildCount}
              </span>
            )}
          </div>
        </div>
        </ContextMenuTrigger>
        <ItemMenu
          item={item}
          treeId={treeId}
          backlogId={backlogId}
          moveTargets={allBacklogIds}
          statuses={treeStatuses}
          features={features}
          isScrambled={isScrambled}
          actOn={actOn}
          dialogs={dialogs}
          actions={actions}
        />
        </ContextMenu>
        {isAdding && (
          <InlineWorkItemInput
            depth={depth + 1}
            onSubmit={(title) => {
              addWorkItem(title, workItemId, backlogId, treeId);
              setIsAdding(false);
              if (!isMobile) {
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent("shortcut:add-sibling-workitem"));
                }, 50);
              }
            }}
            onCancel={() => setIsAdding(false)}
          />
        )}
      </div>
      {isAddingSibling && (
        <InlineWorkItemInput
          depth={depth}
          onSubmit={(title) => {
            addWorkItem(title, item.parentId, backlogId, treeId, (item.ranks[backlogId] ?? 0) + 1);
            setIsAddingSibling(false);
            if (!isMobile) {
              setTimeout(() => {
                window.dispatchEvent(new CustomEvent("shortcut:add-sibling-workitem"));
              }, 50);
            }
          }}
          onCancel={() => setIsAddingSibling(false)}
        />
      )}
      <ItemDialogs
        item={item}
        actOn={actOn}
        treeId={treeId}
        backlogId={backlogId}
        activeOrgId={activeOrgId}
        timeLoggingVisible={timeLoggingVisible}
        dialogs={dialogs}
        actions={actions}
      />
    </>
  );
}
