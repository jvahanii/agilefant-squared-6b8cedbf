import { useAppStore } from "@/store/appStore";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";
import { backlogPoints } from "@/lib/backlogPoints";
import { BacklogContextMenuItems } from "./BacklogContextMenuItems";
import { BacklogPointsDialog } from "./BacklogPointsDialog";
import { useTeamStore } from "@/store/teamStore";
import { WorkItem, getEffectiveParentId } from "@/types/models";
import { useBacklogStatusesStore, getEffectiveStatusesForTree } from "@/store/backlogStatusesStore";
import { GripVertical, FileText, Plus, ClipboardPaste, Clock, X, BellOff, Search, ArrowDownAZ, List as ListIcon, LayoutGrid, Lock, Ban, ChartGantt } from "lucide-react";
import { BoardView } from "./BoardView";
import { useDraggable, useDroppable, useDndContext } from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";

import { useDeferredValue, useMemo, useState, useRef, useEffect, useCallback } from "react";
import { ActionPrompt } from "./ActionPrompt";
import { TimeLogDialog, formatDuration } from "./TimeLogDialog";
import { TimelineView } from "./TimelineView";
import { useStartEndDatesEnabled } from "@/lib/workItemStartEnd";
import { useCreatedDatesEnabled } from "@/lib/workItemCreated";
import { useDeadlinesEnabled } from "@/lib/workItemDeadline";
import { useTimeEntryStore } from "@/store/timeEntryStore";
import { useIsMobile } from "@/hooks/use-mobile";
import { focusForEdit } from "@/lib/focusEdit";
import { overlayOpen } from "@/lib/overlayLock";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useScramble } from "@/contexts/ScrambleContext";
import { scrambleName } from "@/lib/scramble";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { useScrambledListsStore } from "@/store/scrambledListsStore";
import { refuseRenameOfScrambledList } from "@/store/listScrambleStore";
import { indentTargets, rowsForReparenting } from "@/lib/workItemRows";
import { useTreeSharesStore } from "@/store/treeSharesStore";
import {
  commandBeingTyped,
  matchItem,
  matchName,
  nothingFound as searchNothingFound,
  parseQuery,
  suggestCommands,
  type ItemMatch,
  type Ranges,
  type SearchContext,
} from "@/lib/itemSearch";
import { itemChangedAt } from "@/lib/itemChangedAt";
import { PublishBacklogDialog } from "@/components/PublicLinkControls";
import { closedCheckMessage, linkedItemsIn, useClosedPostingsStore } from "@/store/closedPostingsStore";
import {
  currentListSortContext,
  saveTopLevelOrderAsRank,
  useListSortMode,
  useListSortStore,
} from "@/store/listSortStore";
import { atTopFirst, listSortLabel, listSortModes, sortTopLevel, type ListSortMode } from "@/lib/listSort";
import { useRatingsEnabled } from "@/lib/ratingsVisibility";
import { IconizedTitle } from "@/components/IconizedTitle";
import { computeBacklogTotalMinutes } from "@/lib/timeUtils";
import { useWorkItemTotalMinutes } from "@/lib/timeTotals";
import { buildVisibleRows, effectiveChildren, topLevelItems } from "@/lib/workItemRows";
import { observeWidthForRemeasure } from "@/lib/virtualRows";
import { useLabelsStore, type Label } from "@/store/labelsStore";
import { ListHeadingLabels } from "./LabelNames";
import { MobileBacklogAttributesSheet } from "./MobileAttributesSheet";
import { BacklogStatusesDialog } from "./BacklogStatusesDialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  useSnoozeStore,
} from "@/store/snoozeStore";
import { visibleWorkItemIdsRef } from "@/store/navigationRefs";
import { toast } from "@/hooks/use-toast";
import { useDeleteWithTimeGuard } from "@/hooks/useDeleteWithTimeGuard";
import {
  DRAG_THRESHOLD_PX_SQUARED,
  LabelFilterContext,
  RunningNumberContext,
  SELECTION_SHORTCUTS,
  SharedDataContext,
  rowIsDrawn,
  scrollWorkItemIntoView,
  type SharedData,
} from "./workItemRow/rowShared";
import { InlineWorkItemInput } from "./workItemRow/InlineWorkItemInput";
import { WorkItemNode } from "./workItemRow/WorkItemRow";
import { ItemMenu, type ItemActions } from "./workItemRow/ItemMenu";
import { ItemDialogs } from "./workItemRow/ItemDialogs";
import { rankToTopOfList, useCommonItemActions, useItemFeatures } from "./workItemRow/itemActions";
import { useRowDialogs } from "./workItemRow/useRowDialogs";
import { whenRowReady } from "./workItemRow/rowShared";

type SearchResultItem = {
  kind: 'workitem';
  item: WorkItem;
  treeId: string;
  backlogId: string;
  treeName: string;
  backlogName: string;
  backlogPath: string[];
  workItemAncestors: string[];
};

type SearchResultBacklog = {
  kind: 'backlog';
  treeId: string;
  backlogId: string;
  treeName: string;
  backlogName: string;
  backlogPath: string[];
};

type SearchResult = SearchResultItem | SearchResultBacklog;

function EditableBacklogName({ backlogId, isScrambled }: { backlogId: string; isScrambled: boolean }) {
  const backlog = useAppStore((s) => s.backlogs[backlogId]);
  const renameBacklog = useAppStore((s) => s.renameBacklog);
  // Scrambled for everyone from the list's menu: marked, and not editable.
  const isNameScrambled = useScrambledListsStore((s) => s.byList.has(backlogId));
  const isMobile = useIsMobile();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) focusForEdit(inputRef.current, isMobile);
  }, [isEditing, isMobile]);

  const startEditing = () => {
    if (refuseRenameOfScrambledList(backlogId)) return;
    setEditValue(backlog?.name ?? "");
    setIsEditing(true);
  };
  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== backlog?.name) renameBacklog(backlogId, trimmed);
    setIsEditing(false);
  };

  // "Insert icon" from the backlog's right-click menu over the header: at the
  // cursor while the name is being edited, otherwise at the end of the name in
  // the editor, to confirm or move — as the same item does in the tree.
  useEffect(() => {
    const onInsert = (e: Event) => {
      const { backlogId: target, shortcode } = (e as CustomEvent<{ backlogId: string; shortcode: string }>).detail;
      if (target !== backlogId) return;
      const inp = inputRef.current;
      if (isEditing && inp) {
        const start = inp.selectionStart ?? editValue.length;
        const end = inp.selectionEnd ?? start;
        setEditValue(editValue.slice(0, start) + shortcode + editValue.slice(end));
        requestAnimationFrame(() => {
          inp.focus();
          inp.setSelectionRange(start + shortcode.length, start + shortcode.length);
        });
      } else if (!refuseRenameOfScrambledList(backlogId)) {
        setEditValue((backlog?.name ?? "") + shortcode);
        setIsEditing(true);
      }
    };
    window.addEventListener("backlog-name:insert-icon", onInsert);
    return () => window.removeEventListener("backlog-name:insert-icon", onInsert);
  }, [backlogId, isEditing, editValue, backlog?.name]);

  if (!backlog) return null;

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="text-base font-semibold bg-transparent border-b border-primary/40 outline-none px-0.5 py-0 min-w-0 w-full"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitEdit();
          if (e.key === "Escape") setIsEditing(false);
          e.stopPropagation();
        }}
        onBlur={commitEdit}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <h2
      className="text-base font-semibold cursor-text hover:text-primary transition-colors break-words whitespace-normal"
      onDoubleClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
    >
      {isNameScrambled && (
        <Lock
          className="mr-1.5 inline-block h-3.5 w-3.5 align-[-1px] text-muted-foreground"
          aria-label="This list is scrambled"
        />
      )}
      {isScrambled ? scrambleName(backlog.name) : <IconizedTitle title={backlog.name} />}
      <ListHeadingLabels backlogId={backlogId} />
    </h2>
  );
}

function ReorderDropZone({
  id,
  index,
  treeId,
  backlogIds,
  parentId,
  depth,
  targetBacklogId,
}: {
  id: string;
  index: number;
  treeId: string;
  backlogIds: string[];
  parentId: string | null;
  depth: number;
  targetBacklogId?: string;
}) {
  const isMobile = useIsMobile();
  const { active } = useDndContext();
  const isDragActive = active !== null;
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "workitem-reorder", index, treeId, backlogIds, parentId, backlogId: targetBacklogId },
  });

  return (
    <div
      className="relative py-px"
      style={{ marginLeft: `${depth * 20 + 12}px` }}
    >
      {/* Absolutely-positioned hit area: expands during drag without shifting layout.
          Bigger zones make reorder gaps far easier to hit with a mouse. */}
      <div
        ref={setNodeRef}
        className={`absolute inset-x-0 ${isDragActive ? (isMobile ? "-top-2 -bottom-2" : "-top-2.5 -bottom-2.5") : "inset-y-0"}`}
      />
      {/* Indicator is absolutely positioned so showing it doesn't change layout
          (which previously caused the hit area to shift and oscillate isOver). */}
      {isOver && (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-selection shadow-[0_0_0_3px_hsl(var(--selection)/0.25)]" />
      )}
    </div>
  );
}

function WorkItemRootDropZone({
  treeId,
  backlogId,
  children,
}: {
  treeId: string;
  backlogId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `workitem-root-drop-${backlogId}`,
    data: { type: "workitem-root", treeId, backlogId },
  });

  return (
    <div
      ref={setNodeRef}
      className={`flex-1 min-h-0 flex flex-col ${isOver ? "ring-2 ring-selection/40 ring-inset rounded-md" : ""}`}
    >
      {children}
    </div>
  );
}

/**
 * A single row in the search-results or label-filter-results list.
 * Supports drag-and-drop (drop onto a backlog in the left panel) and a full
 * right-click context menu that mirrors the one on regular work-item rows.
 */
/** A name with the places the search found its words marked. */
function MarkedTitle({ title, ranges }: { title: string; ranges: Ranges }) {
  const merged: Array<[number, number]> = [];
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  if (merged.length === 0) return <IconizedTitle title={title} />;
  const parts: React.ReactNode[] = [];
  let at = 0;
  merged.forEach(([from, to], i) => {
    if (from > at) parts.push(<IconizedTitle key={`t${i}`} title={title.slice(at, from)} />);
    parts.push(
      <mark key={`m${i}`} className="bg-primary/20 text-foreground rounded-sm px-0 not-italic">
        {title.slice(from, to)}
      </mark>,
    );
    at = to;
  });
  if (at < title.length) parts.push(<IconizedTitle key="rest" title={title.slice(at)} />);
  return <>{parts}</>;
}

const MATCHED_IN_LABEL: Record<ItemMatch["elsewhere"][number]["in"], string> = {
  key: "Jira key",
  label: "label",
  description: "description",
  link: "link",
};

function SearchResultItem({
  item,
  treeId,
  backlogId,
  idx,
  titleNode,
  workItemAncestors,
  treeName,
  backlogPath,
  isScrambled,
  onNavigate,
  active = false,
  note,
}: {
  item: WorkItem;
  treeId: string;
  backlogId: string;
  idx: number;
  titleNode: React.ReactNode;
  workItemAncestors: string[];
  treeName: string;
  backlogPath: string[];
  isScrambled: boolean;
  onNavigate: () => void;
  /** Chosen with the arrow keys in the search box. */
  active?: boolean;
  /** Where the search found it, when not in the name. */
  note?: string;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const backlogs = useAppStore((s) => s.backlogs);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const isSnoozed = useSnoozeStore((s) => s.isSnoozed(item.id));
  const isMobile = useIsMobile();
  const features = useItemFeatures(item, treeId);
  const itemTotalMinutesCached = useWorkItemTotalMinutes(item.id);
  const itemTotalMinutes = features.timeLogging ? itemTotalMinutesCached : 0;

  // The lists of this item's tree, for "Move to list".
  const treeBacklogIds = useMemo(() => {
    const ids: string[] = [];
    const collect = (id: string) => {
      ids.push(id);
      backlogs[id]?.childrenIds.forEach(collect);
    };
    Object.values(backlogs)
      .filter((b) => b.treeId === treeId && !b.parentId)
      .forEach((b) => collect(b.id));
    return ids;
  }, [backlogs, treeId]);

  // Search-result cards can span multiple backlogs; use the tree's default
  // status set (root backlog's effective statuses) for display.
  const statusesByBacklog = useBacklogStatusesStore((s) => s.statusesByBacklog);
  const treeStatuses = useMemo(
    () =>
      getEffectiveStatusesForTree(treeId).map((s) => ({ key: s.key, label: s.label, color: s.color, displayLabel: s.label })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [treeId, statusesByBacklog],
  );

  // The item's menu and its dialogs: the same as on its row in the list. A
  // search result is not part of the list's selection, so they act on it alone.
  const dialogs = useRowDialogs();
  const actOn = useCallback(() => [item.id], [item.id]);
  const common = useCommonItemActions({ workItemId: item.id, actOn, dialogs, activeOrgId });
  /** Go to the item in its list, and once its row is there, do `then` on it. */
  const goThen = (then: () => void) => {
    onNavigate();
    whenRowReady(item.id, then);
  };
  const actions: ItemActions = {
    ...common,
    rankToTop: () => rankToTopOfList(item, treeId, backlogId),
    // A result's name is not edited here: go to the item and edit it there.
    startRename: () =>
      goThen(() => window.dispatchEvent(new CustomEvent("shortcut:edit-title", { detail: { workItemId: item.id } }))),
    addChild: () => goThen(() => window.dispatchEvent(new CustomEvent("shortcut:add-child-workitem"))),
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: `search-workitem-${item.id}`,
    data: {
      type: "workitem",
      workItemId: item.id,
      treeId,
      selectedIds: [item.id],
    },
  });

  const dragStartedRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const { onPointerDown: dndPointerDown, ...restListeners } = !isMobile ? (listeners ?? {}) : {};

  const statusColor = treeStatuses.find((s) => s.key === item.status)?.color ?? "#94a3b8";

  return (
    <>
      <div ref={(node) => { setNodeRef(node); rowRef.current = node; }} style={isDragging ? { opacity: 0.4 } : undefined}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              {...attributes}
              {...restListeners}
              role="option"
              aria-selected={active}
              className={`flex items-start gap-2 px-3 py-1.5 text-left hover:bg-accent/60 transition-colors border-b border-border/30 last:border-b-0 group select-none${active ? " bg-accent" : ""}${!isMobile ? " cursor-grab active:cursor-grabbing" : ""}`}
              title={features.timeLogging && itemTotalMinutes > 0 ? `${formatDuration(itemTotalMinutes)} logged` : undefined}
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
                onNavigate();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onNavigate();
                }
              }}
            >
              <span
                className="text-[10px] tabular-nums text-muted-foreground shrink-0 w-5 text-right mt-1 select-none"
                aria-hidden="true"
              >
                {idx + 1}
              </span>
              <span
                className="w-3 h-3 rounded-full shrink-0 mt-1 border border-background/50"
                style={{ backgroundColor: statusColor }}
                title={item.status}
              />
              <div className="min-w-0 flex-1">
                <span className="text-sm leading-snug break-words inline-flex items-center gap-1">
                  {isSnoozed && (
                    <BellOff
                      className="w-3 h-3 text-amber-500/80 shrink-0 inline-block"
                      aria-label="Snoozed — hidden in list view; click to reveal"
                    />
                  )}
                  {titleNode}
                </span>
                {note && !isScrambled && (
                  <p className="text-[10px] text-muted-foreground mt-0 truncate italic">{note}</p>
                )}
                {workItemAncestors.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/70 mt-0 truncate">
                    {isScrambled ? "···" : workItemAncestors.join(" › ")}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {isScrambled ? "···" : [treeName, ...backlogPath].join(" › ")}
                </p>
              </div>
              {!isMobile && (
                <div className="shrink-0 mt-0.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ItemMenu
            item={item}
            treeId={treeId}
            backlogId={backlogId}
            moveTargets={treeBacklogIds}
            statuses={treeStatuses}
            features={features}
            isScrambled={isScrambled}
            actOn={actOn}
            dialogs={dialogs}
            actions={actions}
          />
        </ContextMenu>
      </div>
      <ItemDialogs
        item={item}
        actOn={actOn}
        treeId={treeId}
        backlogId={backlogId}
        activeOrgId={activeOrgId}
        timeLoggingVisible={features.timeLogging}
        dialogs={dialogs}
        actions={actions}
      />
    </>
  );
}

export function WorkItemTreePanel() {
  // "Rating ★ best first" is offered where the organization rates its items
  // and this backlog has its stars switched on.
  const orgRatingsEnabled = useRatingsEnabled();
  const selectedBacklogIds = useAppStore((s) => s.selectedBacklogIds);
  const selectedBacklogId = selectedBacklogIds[0] ?? null;
  // Deadline sort, offered where the organization uses deadlines.
  const deadlinesEnabledForSort = useDeadlinesEnabled();
  const orgCreatedDatesEnabledForSort = useCreatedDatesEnabled();
  const createdDatesEnabledForSort = useAppStore(
    (s) => orgCreatedDatesEnabledForSort && !!(selectedBacklogId && s.backlogs[selectedBacklogId]?.createdDatesEnabled),
  );
  const ratingsEnabled = useAppStore(
    (s) => orgRatingsEnabled && !!(selectedBacklogId && s.backlogs[selectedBacklogId]?.ratingsEnabled),
  );
  const selectedTreeId = useAppStore((s) => s.selectedTreeId);
  const workItems = useAppStore((s) => s.workItems);
  const workItemsLoading = useAppStore((s) => s.workItemsLoading);
  // Cached data on screen while the real data is still coming: an empty list
  // may just not have arrived yet.
  const workItemsRefreshing = useAppStore((s) => s.workItemsRefreshing);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const expandedWorkItems = useAppStore((s) => s.expandedWorkItems);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const bulkAddWorkItems = useAppStore((s) => s.bulkAddWorkItems);
  const toggleWorkItemExpand = useAppStore((s) => s.toggleWorkItemExpand);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  const clearWorkItemSelection = useAppStore((s) => s.clearWorkItemSelection);
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const timeLoggingVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.timeLoggingEnabled ?? false);
  const labelsVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.labelsEnabled ?? false);
  const boardsVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.boardsEnabled ?? false);
  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const backlogTotalMinutes = useMemo(() => {
    if (!timeLoggingVisible || !selectedBacklogId || !selectedTreeId) return 0;
    return computeBacklogTotalMinutes(selectedBacklogId, selectedTreeId, backlogs, workItems, timeEntries);
  }, [timeEntries, workItems, backlogs, selectedBacklogId, selectedTreeId, timeLoggingVisible]);
  const [showBacklogTimeLogDialog, setShowBacklogTimeLogDialog] = useState(false);
  const [showBacklogAttributesSheet, setShowBacklogAttributesSheet] = useState(false);
  // The selected backlog's public link, reachable on a phone through its
  // attributes sheet; the desktop has it in the sidebar's context menu.
  const [showBacklogPublishDialog, setShowBacklogPublishDialog] = useState(false);
  const [showBacklogStatusesDialog, setShowBacklogStatusesDialog] = useState(false);
  const [showBacklogDeleteConfirm, setShowBacklogDeleteConfirm] = useState(false);
  const [showBacklogPointsDialog, setShowBacklogPointsDialog] = useState(false);
  const deleteBacklog = useAppStore((s) => s.deleteBacklog);
  const guardedDelete = useDeleteWithTimeGuard();

  // Compute the set of currently-snoozed item IDs. The selector returns a
  // stable comma-joined string so zustand only triggers a re-render when the
  // snoozed-ID set actually changes (new snooze, unsnooze, or expiry via tick).
  const snoozedKey = useSnoozeStore((s) => {
    void s.tick; // read tick so expiry wakes are reflected
    const now = Date.now();
    return Object.values(s.snoozes)
      .filter((snooze) => new Date(snooze.snoozedUntil).getTime() > now)
      .map((snooze) => snooze.workItemId)
      .sort()
      .join(',');
  });
  const snoozedItemIds = useMemo(
    () => new Set(snoozedKey ? snoozedKey.split(',') : []),
    [snoozedKey],
  );
  const unsnoozeAll = useSnoozeStore((s) => s.unsnoozeAll);

  const isMobile = useIsMobile();

  // Label filter state
  const labelsMap = useLabelsStore((s) => s.labels);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const workItemTeamsMap = useTeamStore((s) => s.workItemTeams);
  const [filterLabelIds, setFilterLabelIds] = useState<Set<string>>(new Set());
  const [filterTeamIds, setFilterTeamIds] = useState<Set<string>>(new Set());
  const filterInputRef = useRef<HTMLInputElement>(null);
  const [isFilterBarHovered, setIsFilterBarHovered] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // View mode is persisted per backlog in the database (shared across users
  // viewing the same backlog).  Falls back to "list" when the selected backlog
  // has no stored preference.
  const setBacklogViewMode = useAppStore((s) => s.setBacklogViewMode);
  const viewMode = useAppStore((s) => {
    if (!selectedBacklogId) return "list" as const;
    return s.backlogs[selectedBacklogId]?.viewMode ?? "list";
  });
  const setViewMode = useCallback((m: "list" | "board" | "timeline") => {
    if (!selectedBacklogId) return;
    setBacklogViewMode(selectedBacklogId, m);
  }, [selectedBacklogId, setBacklogViewMode]);
  // The timeline is drawn from start and end dates, so it is offered where the
  // organization uses them. A list that prefers it while they are switched
  // off shows as a list, and goes back to its timeline if they return.
  const timelineAvailable = useStartEndDatesEnabled();
  const showTimeline = timelineAvailable && viewMode === "timeline";

  // Clear search query when switching backlogs
  useEffect(() => {
    setSearchQuery("");
  }, [selectedBacklogId, setSearchQuery]);

  // Clear filters when switching backlogs
  useEffect(() => {
    setFilterLabelIds(new Set());
    setFilterTeamIds(new Set());
  }, [selectedBacklogId]);

  // Compute the set of work item IDs that directly match the active label and/or
  // team filters (OR within each filter type, OR across the two types). Null when
  // neither filter is active.
  const filterMatch = useMemo<Set<string> | null>(() => {
    if (filterLabelIds.size === 0 && filterTeamIds.size === 0) return null;

    const matching = new Set<string>();

    if (filterLabelIds.size > 0) {
      for (const [key, labelIds] of Object.entries(byEntity)) {
        if (!key.startsWith("work_item:")) continue;
        if (labelIds.some((id) => filterLabelIds.has(id))) {
          matching.add(key.slice("work_item:".length));
        }
      }
    }

    if (filterTeamIds.size > 0) {
      for (const [workItemId, teamIds] of Object.entries(workItemTeamsMap)) {
        if (teamIds.some((tid) => filterTeamIds.has(tid))) {
          matching.add(workItemId);
        }
      }
    }

    return matching;
  }, [filterLabelIds, filterTeamIds, byEntity, workItemTeamsMap]);

  // The visible set adds ancestors to a matching item so its path remains
  // navigable in the tree (used by the tree view and auto-expand logic).
  const visibleFilterSet = useMemo<Set<string> | null>(() => {
    if (!filterMatch) return null;

    const visible = new Set(filterMatch);
    for (const itemId of filterMatch) {
      let curr = workItems[itemId];
      while (curr?.parentId) {
        visible.add(curr.parentId);
        curr = workItems[curr.parentId];
      }
    }
    return visible;
  }, [filterMatch, workItems]);

  // Auto-expand ancestors of matching items when the filter changes
  useEffect(() => {
    if (!visibleFilterSet) return;
    const state = useAppStore.getState();
    for (const id of visibleFilterSet) {
      const item = state.workItems[id];
      const hasVisibleChild = item?.childrenIds.some((cid) => visibleFilterSet.has(cid));
      if (hasVisibleChild && !state.expandedWorkItems.has(id)) {
        state.toggleWorkItemExpand(id);
      }
    }
  }, [visibleFilterSet]);

  // Keyboard shortcut: '/' focuses the unified filter input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (!isInput && e.key === "/") {
        e.preventDefault();
        filterInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Search results: items from ALL trees matching the search query, with tree/backlog context.
  // Returns null when no query is active (normal view mode).
  type SearchResultItem = {
    kind: 'workitem' | 'backlog';
    item: WorkItem;
    treeId: string;
    backlogId: string;
    treeName: string;
    backlogName: string;
    backlogPath: string[];
    workItemAncestors: string[];
    score: number;
    changedAt: number;
    ranges: Ranges;
    elsewhere: ItemMatch["elsewhere"];
  };

  type SearchResultBacklog = {
    kind: 'backlog';
    treeId: string;
    backlogId: string;
    treeName: string;
    backlogName: string;
    backlogPath: string[];
    score: number;
    ranges: Ranges;
  };

  type SearchResult = SearchResultItem | SearchResultBacklog;

  // Words and commands ("/due today") typed into the search box: itemSearch.ts.
  const scrambledItemNames = useScrambledItemsStore((s) => s.byItem);
  // A synced item is also found by its Jira key: "AF-20".
  const jiraByItem = useJiraIssuesStore((s) => s.byItem);
  const searchLabels = useLabelsStore((s) => s.labels);
  const searchLabelsByEntity = useLabelsStore((s) => s.byEntity);
  const searchTeams = useTeamStore((s) => s.teams);
  const searchWorkItemTeams = useTeamStore((s) => s.workItemTeams);
  const searchHyperlinks = useAppStore((s) => s.hyperlinks);
  // Typing stays quick: with thousands of items the results follow a moment behind.
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const parsedSearch = useMemo(() => parseQuery(deferredSearchQuery), [deferredSearchQuery]);
  const searchContext = useMemo<SearchContext>(() => {
    const teamNames = new Map(searchTeams.map((team) => [team.id, team.name]));
    return {
      jiraKey: (id) => jiraByItem.get(id)?.key,
      scrambled: scrambledItemNames,
      labelNames: (id) =>
        (searchLabelsByEntity[`work_item:${id}`] ?? []).flatMap((labelId) => {
          const name = searchLabels[labelId]?.name;
          return name ? [name] : [];
        }),
      teamNames: (id) =>
        (searchWorkItemTeams[id] ?? []).flatMap((teamId) => {
          const name = teamNames.get(teamId);
          return name ? [name] : [];
        }),
      links: (id) => (searchHyperlinks[id] ?? []).map((link) => ({ url: link.url, altText: link.altText })),
      changedAt: (item) => itemChangedAt(item),
    };
  }, [jiraByItem, scrambledItemNames, searchLabels, searchLabelsByEntity, searchTeams, searchWorkItemTeams, searchHyperlinks]);

  const searchResults = useMemo((): SearchResult[] | null => {
    if (!parsedSearch.active) return null;

    const itemResults: SearchResultItem[] = [];
    for (const wi of Object.values(workItems)) {
      const match = matchItem(wi, parsedSearch, searchContext);
      if (!match) continue;
      // One result per tree the item is in, so items present in several trees show all occurrences.
      for (const treeId of Object.keys(wi.backlogAssignments)) {
        const backlogId = wi.backlogAssignments[treeId];
        const tree = backlogTrees[treeId];
        const backlog = backlogId ? backlogs[backlogId] : null;

        // The list's path, from the top list down to the item's.
        const backlogPath: string[] = [];
        const visitedBacklogIds = new Set<string>();
        let bl = backlog;
        while (bl && !visitedBacklogIds.has(bl.id)) {
          visitedBacklogIds.add(bl.id);
          backlogPath.unshift(bl.name);
          bl = bl.parentId ? backlogs[bl.parentId] : null;
        }

        // The items above it, by its parent in this tree.
        const workItemAncestors: string[] = [];
        const visitedWorkItemIds = new Set<string>();
        let parentId = getEffectiveParentId(wi, treeId);
        while (parentId && !visitedWorkItemIds.has(parentId)) {
          visitedWorkItemIds.add(parentId);
          const parent = workItems[parentId];
          if (!parent) break;
          workItemAncestors.unshift(parent.title);
          parentId = getEffectiveParentId(parent, treeId);
        }

        itemResults.push({
          kind: 'workitem' as const,
          item: wi,
          treeId,
          backlogId: backlogId ?? "",
          treeName: tree?.name ?? "",
          backlogName: backlog?.name ?? "",
          backlogPath,
          workItemAncestors,
          score: match.score,
          changedAt: match.changedAt,
          ranges: match.ranges,
          elsewhere: match.elsewhere,
        });
      }
    }

    // Commands are about items: a list has no deadline to be due by.
    const backlogResults: SearchResultBacklog[] =
      parsedSearch.commands.length > 0 || parsedSearch.words.length === 0
        ? []
        : Object.values(backlogs).flatMap((bl) => {
            const match = matchName(bl.name, parsedSearch.words);
            if (!match) return [];
            const tree = backlogTrees[bl.treeId];
            const backlogPath: string[] = [];
            const visitedBacklogIds = new Set<string>();
            let current = bl;
            while (current && !visitedBacklogIds.has(current.id)) {
              visitedBacklogIds.add(current.id);
              backlogPath.unshift(current.name);
              current = current.parentId ? backlogs[current.parentId] : null;
            }
            return [{
              kind: 'backlog' as const,
              treeId: bl.treeId,
              backlogId: bl.id,
              treeName: tree?.name ?? '',
              backlogName: bl.name,
              backlogPath,
              score: match.score + 15,
              ranges: match.ranges,
            }];
          });

    const changedOf = (r: SearchResult) => ('item' in r ? (r as SearchResultItem).changedAt : 0);
    const nameOf = (r: SearchResult) => (r.kind === 'backlog' && !('item' in r) ? r.backlogName : (r as SearchResultItem).item.title);
    return [...itemResults, ...backlogResults]
      .filter((r) => r.treeId)
      // Equal matches: the most recently changed first (lists have no change time).
      .sort((a, b) => b.score - a.score || changedOf(b) - changedOf(a) || nameOf(a).localeCompare(nameOf(b)) || a.treeName.localeCompare(b.treeName));
  }, [parsedSearch, searchContext, workItems, backlogTrees, backlogs]);

  // Long result lists are shown fifty at a time.
  const SEARCH_PAGE = 50;
  const [searchShown, setSearchShown] = useState(SEARCH_PAGE);
  // The result chosen with the arrow keys; -1 for none.
  const [activeSearchIdx, setActiveSearchIdx] = useState(-1);
  useEffect(() => {
    setSearchShown(SEARCH_PAGE);
    setActiveSearchIdx(-1);
  }, [deferredSearchQuery]);
  const shownSearchResults = useMemo(() => searchResults?.slice(0, searchShown) ?? [], [searchResults, searchShown]);

  // The commands that fit what is being typed after a "/".
  const commandTyped = commandBeingTyped(searchQuery);
  const commandSuggestions = commandTyped ? suggestCommands(commandTyped) : [];
  const applyCommandSuggestion = (insert: string) => {
    if (!commandTyped) return;
    setSearchQuery(searchQuery.slice(0, searchQuery.length - commandTyped.length) + insert);
    filterInputRef.current?.focus();
  };

  // Filter results: items from ALL trees that match the active label and/or
  // team filters, shown as a flat list. Returns null when no filter is active.
  const labelSearchResults = useMemo(() => {
    if (!filterMatch) return null;

    return Array.from(filterMatch)
      .flatMap((itemId) => {
        const wi = workItems[itemId];
        if (!wi) return [];

        const treeIds = Object.keys(wi.backlogAssignments);
        if (treeIds.length === 0) return [];

        return treeIds.map((treeId) => {
          const backlogId = wi.backlogAssignments[treeId];
          const tree = backlogTrees[treeId];
          const backlog = backlogId ? backlogs[backlogId] : null;

          const backlogPath: string[] = [];
          const visitedBacklogIds = new Set<string>();
          let bl = backlog;
          while (bl && !visitedBacklogIds.has(bl.id)) {
            visitedBacklogIds.add(bl.id);
            backlogPath.unshift(bl.name);
            bl = bl.parentId ? backlogs[bl.parentId] : null;
          }

          const workItemAncestors: string[] = [];
          const visitedWorkItemIds = new Set<string>();
          let parentId = getEffectiveParentId(wi, treeId);
          while (parentId && !visitedWorkItemIds.has(parentId)) {
            visitedWorkItemIds.add(parentId);
            const parent = workItems[parentId];
            if (!parent) break;
            workItemAncestors.unshift(parent.title);
            parentId = getEffectiveParentId(parent, treeId);
          }

          return {
            item: wi,
            treeId,
            backlogId: backlogId ?? "",
            treeName: tree?.name ?? "",
            backlogName: backlog?.name ?? "",
            backlogPath,
            workItemAncestors,
          };
        });
      })
      .filter((r) => r.treeId !== "")
      .sort((a, b) => {
        const t = a.item.title.localeCompare(b.item.title);
        if (t !== 0) return t;
        return a.treeName.localeCompare(b.treeName);
      });
  }, [filterMatch, workItems, backlogTrees, backlogs]);

  // Scramble support: check whether the currently selected tree is shared with any org.
  // If it is shared, names in it are NOT scrambled even when scramble is enabled.
  const { scrambleEnabled, isSuperuser } = useScramble();
  // From the read the tree panel makes for every tree (treeSharesStore.ts). Until
  // it answers the tree counts as not shared; if it failed, as shared, so that
  // names are not exposed when that is not known.
  const shareTreeIdsKey = Object.keys(backlogTrees).sort().join(",");
  useEffect(() => {
    if (!activeOrgId || !shareTreeIdsKey) return;
    useTreeSharesStore.getState().ensure(activeOrgId, shareTreeIdsKey.split(","));
  }, [activeOrgId, shareTreeIdsKey]);
  const selectedTreeIsShared = useTreeSharesStore(
    (s) => !!selectedTreeId && (s.failed || (s.byTree[selectedTreeId]?.length ?? 0) > 0),
  );

  // A tree's content is scrambled only when scramble is enabled AND the tree is not shared.
  const isScrambled = scrambleEnabled && !selectedTreeIsShared;

  const handlePasteFromClipboard = async () => {
    if (!selectedBacklogId || !selectedTreeId) return;
    try {
      const text = await navigator.clipboard.readText();
      const titles = text
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
      if (titles.length === 0) return;
      const parentId = selectedWorkItemIds.length === 1 ? selectedWorkItemIds[0] : null;
      const parentBacklogId =
        parentId && workItems[parentId]?.backlogAssignments?.[selectedTreeId]
          ? workItems[parentId].backlogAssignments[selectedTreeId]
          : selectedBacklogId;
      bulkAddWorkItems(titles, parentId, parentBacklogId, selectedTreeId);
      if (parentId && !expandedWorkItems.has(parentId)) {
        toggleWorkItemExpand(parentId);
      }
    } catch (err) {
      console.error("Failed to read clipboard:", err);
    }
  };

  const [isAdding, setIsAdding] = useState(false);
  const lastSelectedId = useRef<string | null>(null);

  useEffect(() => {
    const handler = () => setIsAdding(true);
    window.addEventListener("shortcut:add-workitem", handler);
    return () => window.removeEventListener("shortcut:add-workitem", handler);
  }, []);

  // Insert key: add child item when an item is selected, otherwise add root item.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Insert") return;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isInput) return;
      // Don't fire when a modal dialog is open
      if (document.querySelector('[role="dialog"]')) return;

      e.preventDefault();
      const sel = useAppStore.getState().selectedWorkItemIds;
      if (sel.length > 0) {
        window.dispatchEvent(new CustomEvent("shortcut:add-child-workitem"));
      } else {
        setIsAdding(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const backlogIdSet = useMemo(() => {
    if (!selectedBacklogId) return new Set<string>();
    const ids = new Set<string>();
    const collect = (id: string) => {
      ids.add(id);
      backlogs[id]?.childrenIds.forEach(collect);
    };
    collect(selectedBacklogId);
    return ids;
  }, [selectedBacklogId, backlogs]);

  const allBacklogIds = useMemo(() => Array.from(backlogIdSet), [backlogIdSet]);

  // Work item IDs in the current backlog that are currently snoozed.
  const snoozedInBacklog = useMemo(() => {
    if (snoozedItemIds.size === 0 || backlogIdSet.size === 0 || !selectedTreeId) return [];
    return Object.values(workItems)
      .filter((wi) => snoozedItemIds.has(wi.id) && backlogIdSet.has(wi.backlogAssignments[selectedTreeId]))
      .map((wi) => wi.id);
  }, [workItems, snoozedItemIds, backlogIdSet, selectedTreeId]);

  // A job ad goes stale where nothing in the app can see it: applications close
  // on the board, and the item sits on the list as though it were live. Finding
  // out means fetching each posting, which only the server can do -- a job board
  // sends no CORS headers -- so the check is a button rather than something that
  // happens by itself, and only a superuser's, whose call it is to spend a burst
  // of server requests. It has nothing to do with whether the backlog is shared.
  const hyperlinks = useAppStore((s) => s.hyperlinks);
  // Every item in the backlog and its children that has a link to check.
  const linkedItemsInBacklog = useMemo(() => {
    if (!isSuperuser || backlogIdSet.size === 0 || !selectedTreeId) return [];
    return linkedItemsIn(workItems, hyperlinks, selectedTreeId, backlogIdSet);
  }, [isSuperuser, workItems, hyperlinks, backlogIdSet, selectedTreeId]);

  const closedChecking = useClosedPostingsStore((s) => s.checking);
  const closedProgress = useClosedPostingsStore((s) => s.progress);
  const closedIds = useClosedPostingsStore((s) => s.closed);
  const checkClosedPostings = useClosedPostingsStore((s) => s.check);
  const forgetClosedPostings = useClosedPostingsStore((s) => s.forget);
  const closedAtTop = useClosedPostingsStore((s) => s.atTop);
  // Marks are kept per item, so they stay put when another backlog is opened —
  // an import checks two lists at once, and switching between them must not
  // lose half the answer. The count is of this backlog's items only.
  const closedCount = useMemo(
    () => linkedItemsInBacklog.filter((item) => closedIds.has(item.id)).length,
    [linkedItemsInBacklog, closedIds],
  );

  const runClosedCheck = useCallback(async () => {
    toast(closedCheckMessage(await checkClosedPostings(linkedItemsInBacklog)));
  }, [checkClosedPostings, linkedItemsInBacklog]);

  // All labels defined in the active organisation, shown in the filter chip bar.
  const allOrgLabels = useMemo(
    () =>
      Object.values(labelsMap)
        .filter((l) => l.organizationId === activeOrgId)
        .sort((a, b) => a.name.localeCompare(b.name)) as Label[],
    [labelsMap, activeOrgId],
  );

  // The order the top level is shown in. Rank unless this browser chose another
  // order for this backlog; that choice only rearranges the view, and children
  // always stay in rank order. Teams and statuses are read so a re-sort follows
  // when someone changes them.
  const listSortMode = useListSortMode(selectedBacklogId);
  const setListSortMode = useListSortStore((s) => s.setMode);
  const sortTeams = useTeamStore((s) => s.teams);
  const sortWorkItemTeams = useTeamStore((s) => s.workItemTeams);
  const sortStatusesByBacklog = useBacklogStatusesStore((s) => s.statusesByBacklog);
  const rootWorkItems = useMemo(() => {
    if (!selectedBacklogId || !selectedTreeId || backlogIdSet.size === 0) return [];
    // Read by currentListSortContext through getState; named here so the order
    // is recomputed when they change.
    void sortTeams;
    void sortWorkItemTeams;
    void sortStatusesByBacklog;
    // Closed ads a finished check found go first, in this browser only.
    return atTopFirst(
      sortTopLevel(
        topLevelItems(workItems, selectedTreeId, backlogIdSet),
        listSortMode,
        selectedTreeId,
        currentListSortContext(selectedTreeId),
      ),
      closedAtTop,
    );
  }, [workItems, selectedBacklogId, selectedTreeId, backlogIdSet, listSortMode, sortTeams, sortWorkItemTeams, sortStatusesByBacklog, closedAtTop]);

  // When filter is active, hide root items that have no matching descendant-or-self.
  // Also hide root items that are currently snoozed by the current user.
  const displayedRootItems = useMemo(() => {
    let items = rootWorkItems;
    if (visibleFilterSet) items = items.filter((wi) => visibleFilterSet.has(wi.id));
    return items.filter((wi) => !snoozedItemIds.has(wi.id));
  }, [rootWorkItems, visibleFilterSet, snoozedItemIds]);

  // The rows top to bottom and their indentation, from one walk that follows
  // each item's parent in this tree (lib/workItemRows). Depth used to be
  // reconstructed afterwards from global parents, which put every row after a
  // re-parented multi-tree item at the top level.
  const visibleRows = useMemo(
    () =>
      selectedTreeId
        ? buildVisibleRows(displayedRootItems.map((r) => r.id), expandedWorkItems, workItems, selectedTreeId, backlogIdSet)
        : { ids: displayedRootItems.map((r) => r.id), depths: new Map<string, number>() },
    [displayedRootItems, expandedWorkItems, workItems, selectedTreeId, backlogIdSet],
  );
  const visibleItemIds = visibleRows.ids;
  const itemDepthMap = visibleRows.depths;

  // For each visible row, compute its sibling-context parent and the drop-zone
  // index *within that sibling group*. The virtualizer's flat index cannot be
  // used directly as a reorder target: in a mixed-depth tree the flat index is
  // larger than the sibling-relative index that reorderWorkItemAmongSiblings
  // expects, so drops would clamp to the bottom (or land in the wrong place).
  // This mirrors the sibling grouping used by the store: a row is a child of
  // its effective parent when that parent is inside the backlog context, and
  // "root-visible" otherwise (parent null or outside the context).
  const reorderDropMeta = useMemo(() => {
    const meta = new Map<number, { index: number; parentId: string | null }>();
    const counts = new Map<string, number>();
    visibleItemIds.forEach((id, i) => {
      const item = workItems[id];
      if (!item) return;
      const effectiveParent = selectedTreeId
        ? getEffectiveParentId(item, selectedTreeId)
        : item.parentId;
      const parentInContext =
        effectiveParent !== null &&
        backlogIdSet.has(
          workItems[effectiveParent]?.backlogAssignments[selectedTreeId ?? ""],
        );
      const contextKey = parentInContext ? `child:${effectiveParent}` : "root";
      const dropIndex = counts.get(contextKey) ?? 0;
      counts.set(contextKey, dropIndex + 1);
      meta.set(i, {
        index: dropIndex,
        parentId: parentInContext ? effectiveParent : null,
      });
    });
    return meta;
  }, [visibleItemIds, workItems, selectedTreeId, backlogIdSet]);

  // Virtualizer scroll container
  const panelRef = useRef<HTMLDivElement>(null);
  const treeScrollRef = useRef<HTMLDivElement>(null);
  // Also as state, because the scroll container is only rendered when the
  // backlog has items: switching from an empty one mounts a *new* element, and
  // an effect keyed on the virtualizer alone would still be watching the old
  // one — or nothing at all.
  const [treeScrollEl, setTreeScrollEl] = useState<HTMLDivElement | null>(null);
  const attachTreeScroll = useCallback((node: HTMLDivElement | null) => {
    treeScrollRef.current = node;
    setTreeScrollEl(node);
  }, []);
  const virtualizer = useVirtualizer({
    count: visibleItemIds.length,
    getScrollElement: () => treeScrollRef.current,
    estimateSize: () => 32,
    overscan: 10,
    measureElement: (el) => el.getBoundingClientRect().height,
    // Key rows (and their cached measurements) by work-item identity instead of
    // index. When an item is moved to another list and removed from this one,
    // every following item shifts to a new index; index-based keys would make
    // each row adopt the stale multi-line height of the previous occupant and
    // leave titles squeezed on top of each other on mobile.
    getItemKey: (index) => visibleItemIds[index] ?? index,
  });

  // Titles wrap onto multiple rows, so a row's height depends on the available
  // width. When the container width changes (mobile pane expand/collapse,
  // rotation, sidebar toggle) cached measurements go stale and rows can end up
  // painted on top of each other — read the rendered rows again.
  //
  // Not virtualizer.measure(): that clears every cached height back to the
  // 32px estimate, and rows keyed by item id keep their DOM nodes, so the
  // measureElement refs never re-run and the real heights never come back.
  // That left a wrapped title in a one-line slot with the next row on top of
  // it. Watching the width is delicate in its own right — re-measuring can
  // toggle the scrollbar, which changes the width again — so lib/virtualRows
  // watches offsetWidth, measures on the next frame, and gives up if the width
  // will not settle. Measuring on clientWidth here froze the live app.
  useEffect(() => observeWidthForRemeasure(treeScrollEl, virtualizer.measureElement), [treeScrollEl, virtualizer]);

  // A change to the visible set (expand / collapse, add, delete, filter, move
  // to another list) needs nothing here: heights are cached by work-item
  // identity (see getItemKey above), so existing rows keep theirs and new rows
  // measure on mount.




  // Keep a ref to the latest visible list so the Tab/Shift-Tab handler always
  // operates on the current order without requiring the effect to re-register.
  const visibleItemIdsRef = useRef<string[]>(visibleItemIds);
  useEffect(() => {
    visibleItemIdsRef.current = visibleItemIds;
    // The timeline shows every row with its branches open, and publishes its
    // own order for the arrow keys; the list's would move the selection onto
    // rows the timeline does not show in that place.
    if (!showTimeline) visibleWorkItemIdsRef.current = visibleItemIds;
  }, [visibleItemIds, showTimeline]);
  const timelineRootIds = useMemo(() => displayedRootItems.map((r) => r.id), [displayedRootItems]);
  // Read by the Tab handler below, which is registered once.
  const showTimelineRef = useRef(showTimeline);
  showTimelineRef.current = showTimeline;

  // Scroll a work item into view even when it isn't currently rendered by the
  // virtualizer (e.g. navigating from search/label results to an item far
  // outside the current window). virtualizer.scrollToIndex works from the list
  // index regardless of whether the target row is mounted yet; the follow-up
  // scrollIntoView corrects any drift from the dynamic row-height estimates.
  const scrollToWorkItem = useCallback(
    (itemId: string) => {
      const index = visibleItemIdsRef.current.indexOf(itemId);
      if (index === -1) {
        scrollWorkItemIntoView(itemId);
        return;
      }
      virtualizer.scrollToIndex(index, { align: "auto" });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document
            .querySelector(`[data-work-item-id="${CSS.escape(itemId)}"]`)
            ?.scrollIntoView({ block: "nearest" });
        });
      });
    },
    [virtualizer],
  );

  // Arrow-key navigation moves the selection one row at a time; the list has
  // to follow it past the edge of the view, including onto rows the
  // virtualizer has not drawn yet. Only the list that shows the row answers.
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id && visibleItemIdsRef.current.includes(id)) scrollToWorkItem(id);
    };
    window.addEventListener("shortcut:reveal-work-item", handler);
    return () => window.removeEventListener("shortcut:reveal-work-item", handler);
  }, [scrollToWorkItem]);

  // A shortcut on the selection whose first item's row is not drawn — scrolled
  // out of the window the list draws — goes unanswered. Bring the row into
  // view, and once it is drawn, and listening, send the shortcut again.
  useEffect(() => {
    let cancelled = false;
    const handler = (e: Event) => {
      if ((e as CustomEvent<{ revealed?: boolean }>).detail?.revealed) return;
      const first = useAppStore.getState().selectedWorkItemIds[0];
      if (!first || rowIsDrawn(first) || !visibleItemIdsRef.current.includes(first)) return;
      scrollToWorkItem(first);
      let frames = 0;
      const resend = () => {
        if (cancelled) return;
        if (rowIsDrawn(first)) {
          window.dispatchEvent(new CustomEvent(e.type, { detail: { revealed: true } }));
        } else if (++frames < 60) {
          requestAnimationFrame(resend);
        }
      };
      requestAnimationFrame(resend);
    };
    for (const name of SELECTION_SHORTCUTS) window.addEventListener(name, handler);
    return () => {
      cancelled = true;
      for (const name of SELECTION_SHORTCUTS) window.removeEventListener(name, handler);
    };
  }, [scrollToWorkItem]);

  // Keyboard shortcuts: Tab = indent (last child of the previous sibling),
  // Shift+Tab = outdent (elevate to parent's level).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isInput) return;
      // An open dialog keeps its Tab. Checking for a field alone was not
      // enough: from the date field the key moves to the calendar button
      // beside it, and from there the next press reparented the selected
      // item behind the dialog instead of moving on to the other date.
      if (overlayOpen()) return;

      const state = useAppStore.getState();
      if (state.selectedWorkItemIds.length === 0) return;
      if (!state.selectedTreeId || !state.selectedBacklogIds[0]) return;

      const treeId = state.selectedTreeId;
      const backlogId = state.selectedBacklogIds[0];
      // The rows on screen: the timeline's own while it is shown. Judged by
      // the list's, a row the list keeps folded away was not there to act on,
      // the key went unhandled, and the browser moved focus instead — which
      // scrolls the calendar to wherever focus landed, the bars out of sight.
      const currentIds = rowsForReparenting(showTimelineRef.current, visibleItemIdsRef.current, visibleWorkItemIdsRef.current);
      const selectedSet = new Set(state.selectedWorkItemIds);
      // Process in visible (top-to-bottom) order, restricted to currently visible items.
      const orderedSelected = currentIds.filter((id) => selectedSet.has(id));
      if (orderedSelected.length === 0) return;

      e.preventDefault();


      // Exclude items that are descendants of another selected item —
      // they'll move implicitly when their selected ancestor is reparented.
      const isDescendantOfSelected = new Set<string>();
      for (const id of orderedSelected) {
        const wi = state.workItems[id];
        let ancestor: string | null = treeId ? getEffectiveParentId(wi, treeId) : wi.parentId;
        while (ancestor) {
          if (selectedSet.has(ancestor)) {
            isDescendantOfSelected.add(id);
            break;
          }
          const ancestorWi = state.workItems[ancestor];
          ancestor = treeId && ancestorWi ? getEffectiveParentId(ancestorWi, treeId) : ancestorWi?.parentId ?? null;
        }
      }


      const topmostSelected = orderedSelected.filter((id) => !isDescendantOfSelected.has(id));

      if (e.shiftKey) {
        // Outdent: each selected item becomes a sibling of its current parent.



        // Snapshot parent ids first so reparenting doesn't affect later lookups.
        // Only the topmost: a selected item under another selected one moves with it.
        const outdentedAfter = new Map<string, number>();
        const plans = topmostSelected
          .map((id) => {
            const item = state.workItems[id];
            const effectiveParentId = treeId ? getEffectiveParentId(item, treeId) : item.parentId;
            if (!item || effectiveParentId === null) return null;
            const parent = state.workItems[effectiveParentId];
            if (!parent) return null;
            const grandparentId = treeId ? getEffectiveParentId(parent, treeId) : parent.parentId;
            const targetBacklogId = grandparentId
              ? (state.workItems[grandparentId]?.backlogAssignments[treeId] ?? backlogId)
              : backlogId;
            // Right after its former parent — and after any sibling outdented
            // before it from the same parent, or a run of them came out reversed.
            const parentRank = parent.ranks[targetBacklogId] ?? 0;
            const before = outdentedAfter.get(effectiveParentId) ?? 0;
            outdentedAfter.set(effectiveParentId, before + 1);
            const insertRank = parentRank + 1 + before;
            return { id, grandparentId, targetBacklogId, insertRank };
          })
          .filter((p): p is { id: string; grandparentId: string | null; targetBacklogId: string; insertRank: number } => p !== null);
        if (plans.length === 0) return;
        useAppStore.getState().runBulk(() => {
          plans.forEach((p) => state.reparentWorkItem(p.id, p.grandparentId, treeId, p.targetBacklogId, undefined, p.insertRank));
        });
        toast({
          title:
            plans.length === 1
              ? plans[0].grandparentId
                ? `Reparented to "${state.workItems[plans[0].grandparentId!]?.title ?? "item"}"`
                : "Moved to root (no parent)"
              : `Outdented ${plans.length} items`,
        });
      } else {
        // Indent: each selected item goes under its previous sibling, at the end
        // of that sibling's children (indentTargets).
        const targets = indentTargets(currentIds, selectedSet, (id) => {
          const wi = state.workItems[id];
          return wi ? getEffectiveParentId(wi, treeId) : null;
        });
        const plans: { id: string; parentId: string; targetBacklogId: string }[] = [];
        for (const id of topmostSelected) {
          const parentId = targets.get(id);
          if (!parentId) continue;
          const parentItem = state.workItems[parentId];
          if (!parentItem) continue;
          const targetBacklogId = parentItem.backlogAssignments[treeId] ?? backlogId;
          plans.push({ id, parentId, targetBacklogId });
        }
        if (plans.length === 0) return;
        useAppStore.getState().runBulk(() => {
          plans.forEach((p) => state.reparentWorkItem(p.id, p.parentId, treeId, p.targetBacklogId));
        });
        // Expand new parents so indented items stay visible.
        const latest = useAppStore.getState();
        const uniqueParents = Array.from(new Set(plans.map((p) => p.parentId)));
        uniqueParents.forEach((pid) => {
          if (!latest.expandedWorkItems.has(pid)) latest.toggleWorkItemExpand(pid);
        });
        toast({
          title:
            plans.length === 1
              ? `Reparented to "${state.workItems[plans[0].parentId]?.title ?? "item"}"`
              : `Indented ${plans.length} items`,
        });
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Assign a 1-based running number to each item that will actually be rendered
  // (i.e. not snoozed and not hidden by the label filter).  The numbers are
  // contiguous with no gaps, matching the visual top-to-bottom order.
  const runningNumbers = useMemo(() => {
    const map = new Map<string, number>();
    let counter = 1;
    // The same children, in the same order, as the rows (buildVisibleRows).
    const traverse = (workItemId: string) => {
      const item = workItems[workItemId];
      if (!item || map.has(workItemId)) return;
      if (snoozedItemIds.has(workItemId)) return;
      if (visibleFilterSet !== null && !visibleFilterSet.has(workItemId)) return;
      map.set(workItemId, counter++);
      if (expandedWorkItems.has(workItemId) && selectedTreeId) {
        effectiveChildren(workItemId, workItems, selectedTreeId, backlogIdSet).forEach((child) => traverse(child.id));
      }
    };
    displayedRootItems.forEach((root) => traverse(root.id));
    return map;
  }, [displayedRootItems, expandedWorkItems, workItems, selectedTreeId, backlogIdSet, snoozedItemIds, visibleFilterSet]);

  const handleSelect = useCallback(
    (id: string, multi: boolean, shift: boolean) => {
      if (shift && lastSelectedId.current && visibleItemIds.includes(lastSelectedId.current)) {
        const startIdx = visibleItemIds.indexOf(lastSelectedId.current);
        const endIdx = visibleItemIds.indexOf(id);
        const rangeIds = visibleItemIds.slice(Math.min(startIdx, endIdx), Math.max(startIdx, endIdx) + 1);

        useAppStore.getState().selectWorkItemRange(rangeIds, multi);
      } else {
        selectWorkItem(id, multi);
        lastSelectedId.current = id;
      }
    },
    [visibleItemIds, selectWorkItem],
  );

  const selectBacklog = useAppStore((s) => s.selectBacklog);
  const isSearchMode = parseQuery(searchQuery).active;

  /** Go to a search result, from a click or with Enter in the search box. */
  const openSearchResult = (result: SearchResult) => {
    if (!('item' in result)) {
      selectBacklog(result.backlogId, result.treeId);
      setSearchQuery("");
      return;
    }
    const { item, treeId, backlogId } = result;
    // If snoozed, wake the item so it appears in the destination backlog.
    if (useSnoozeStore.getState().isSnoozed(item.id)) {
      useSnoozeStore.getState().unsnoozeWorkItem(item.id);
    }
    // Expand ancestor backlogs and work items so the item is visible
    useAppStore.setState((state) => {
      const expandedBacklogs = new Set(state.expandedBacklogs);
      let bl = state.backlogs[backlogId];
      while (bl?.parentId) {
        expandedBacklogs.add(bl.parentId);
        bl = state.backlogs[bl.parentId];
      }
      const expandedWorkItems = new Set(state.expandedWorkItems);
      let wi = state.workItems[item.id];
      while (wi) {
        const pid = getEffectiveParentId(wi, treeId);
        if (!pid) break;
        expandedWorkItems.add(pid);
        wi = state.workItems[pid];
      }
      return { expandedBacklogs, expandedWorkItems };
    });
    selectBacklog(backlogId, treeId);
    setSearchQuery("");
    // Small delay lets the backlog panel re-render with the new selection
    // before we try to highlight the work item row.
    setTimeout(() => {
      selectWorkItem(item.id, false);
      scrollToWorkItem(item.id);
    }, 50);
  };
  const isLabelFilterMode = filterLabelIds.size > 0;
  const isTeamFilterMode = filterTeamIds.size > 0;
  const isFilterMode = isLabelFilterMode || isTeamFilterMode;
  const filterResultsTitle =
    isLabelFilterMode && isTeamFilterMode
      ? "Filter results"
      : isTeamFilterMode
        ? "Team filter results"
        : "Label filter results";

  // Shared data computed once per panel — avoids per-row store subscriptions.
  const savingsIncomeVisible2 = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.savingsIncomeEnabled ?? false);
  const burnupsVisible2 = useOrgSettingsStore((s) => (s.settings[activeOrgId ?? ""] as { burnupsEnabled?: boolean })?.burnupsEnabled ?? false);
  const teamsStore = useTeamStore((s) => s.teams);
  const labelsStoreMap = useLabelsStore((s) => s.labels);
  const labelsStoreByEntity = useLabelsStore((s) => s.byEntity);
  const assignLabelFn = useLabelsStore((s) => s.assignLabel);
  const unassignLabelFn = useLabelsStore((s) => s.unassignLabel);
  const createLabelFn = useLabelsStore((s) => s.createLabel);
  const deleteLabelFn = useLabelsStore((s) => s.deleteLabel);
  const assignTeamFn = useTeamStore((s) => s.assignTeamToWorkItem);
  const unassignTeamFn = useTeamStore((s) => s.unassignTeamFromWorkItem);
  const orgLabelsShared = useMemo(
    () => Object.values(labelsStoreMap).filter((l) => l.organizationId === activeOrgId).sort((a, b) => a.name.localeCompare(b.name)),
    [labelsStoreMap, activeOrgId],
  );
  // The same object until one of these changes: every row reads it, and a new
  // one each time the panel draws (as on every click that selects a row) drew
  // every row again.
  const sharedData = useMemo<SharedData>(() => ({
    orgLabels: orgLabelsShared,
    teams: teamsStore,
    labelsVisible,
    labelsMap: labelsStoreMap,
    byEntity: labelsStoreByEntity,
    assignLabel: assignLabelFn,
    unassignLabel: unassignLabelFn,
    createLabel: createLabelFn,
    deleteLabel: deleteLabelFn,
    assignTeam: assignTeamFn,
    unassignTeam: unassignTeamFn,
    activeOrgId,
    timeLoggingVisible,
    savingsIncomeVisible: savingsIncomeVisible2,
    burnupsVisible: burnupsVisible2,
  }), [
    orgLabelsShared, teamsStore, labelsVisible, labelsStoreMap, labelsStoreByEntity, assignLabelFn, unassignLabelFn,
    createLabelFn, deleteLabelFn, assignTeamFn, unassignTeamFn, activeOrgId, timeLoggingVisible,
    savingsIncomeVisible2, burnupsVisible2,
  ]);

  return (
    // In search/label-filter mode the normal tree is replaced by a flat results list,
    // so pass null (no tree-level filtering) to avoid hiding nodes in the hidden tree.
    // Null already means "no filter active" per the LabelFilterContext contract (line 57).
    <SharedDataContext.Provider value={sharedData}>
    <LabelFilterContext.Provider value={isSearchMode || isFilterMode ? null : visibleFilterSet}>
    <RunningNumberContext.Provider value={isSearchMode || isFilterMode ? null : runningNumbers}>
      <div
        ref={panelRef}
        className="h-full flex flex-col overflow-hidden"
        onClick={(e) => {
          // React bubbles events through portals, so a click inside a dialog,
          // sheet or menu rendered elsewhere in the DOM still arrives here —
          // which deselected the item whose hyperlink had just been clicked.
          // Only a click on the panel's own empty space should clear it.
          if (!panelRef.current?.contains(e.target as Node)) return;
          clearWorkItemSelection();
          lastSelectedId.current = null;
        }}
      >
        {/* Unified filter bar — keyword search and label filters in one place */}
        <div
          className="px-1 pt-1 pb-0.5 border-b shrink-0"
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={() => !isMobile && setIsFilterBarHovered(true)}
          onMouseLeave={() => !isMobile && setIsFilterBarHovered(false)}
        >
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50 pointer-events-none" />
            <input
              ref={filterInputRef}
              type="text"
              className="w-full h-7 pl-7 pr-6 text-xs bg-muted/50 rounded-md border border-transparent focus:border-primary/40 focus:bg-background outline-none transition-colors placeholder:text-muted-foreground/50"
              placeholder="Filter items... (/)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setIsSearchFocused(true)}
              onBlur={() => setIsSearchFocused(false)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setSearchQuery("");
                  setFilterLabelIds(new Set());
                  setFilterTeamIds(new Set());
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === "Tab" && !e.shiftKey && commandSuggestions.length > 0) {
                  e.preventDefault();
                  applyCommandSuggestion(commandSuggestions[0].insert);
                } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && isSearchMode && shownSearchResults.length > 0) {
                  e.preventDefault();
                  const last = shownSearchResults.length - 1;
                  setActiveSearchIdx((i) => (e.key === "ArrowDown" ? Math.min(i + 1, last) : Math.max(i - 1, 0)));
                } else if (e.key === "Enter") {
                  // The chosen result, or the best one.
                  const chosen = isSearchMode ? shownSearchResults[Math.max(activeSearchIdx, 0)] : undefined;
                  if (chosen) openSearchResult(chosen);
                  (e.target as HTMLInputElement).blur();
                }
                e.stopPropagation();
              }}
              role="combobox"
              aria-expanded={isSearchMode}
              aria-autocomplete="list"
            />
            {isSearchFocused && commandSuggestions.length > 0 && (
              <div
                className="absolute left-0 right-0 top-full z-30 mt-1 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                role="listbox"
                aria-label="Search commands"
              >
                {commandSuggestions.map((command, i) => (
                  <button
                    key={command.usage}
                    type="button"
                    role="option"
                    aria-selected={i === 0}
                    className={`flex w-full items-baseline gap-2 rounded-sm px-2 py-1 text-left text-xs hover:bg-accent${i === 0 ? " bg-accent/60" : ""}`}
                    // Keep the cursor in the search box.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyCommandSuggestion(command.insert)}
                  >
                    <span className="font-mono">{command.usage}</span>
                    <span className="text-muted-foreground">{command.description}</span>
                  </button>
                ))}
                <p className="px-2 pt-1 text-[10px] text-muted-foreground">Tab completes the first. Commands combine with words.</p>
              </div>
            )}
            {(searchQuery || filterLabelIds.size > 0 || filterTeamIds.size > 0) && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { setSearchQuery(""); setFilterLabelIds(new Set()); setFilterTeamIds(new Set()); }}
                title="Clear all filters"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {!isSearchMode && labelsVisible && allOrgLabels.length > 0 && (isMobile || isSearchFocused || isFilterBarHovered || filterLabelIds.size > 0) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {allOrgLabels.map((label) => (
                <button
                  key={label.id}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                    filterLabelIds.has(label.id)
                      ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                      : "bg-muted text-muted-foreground hover:bg-muted/60"
                  }`}
                  onClick={() =>
                    setFilterLabelIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(label.id)) next.delete(label.id);
                      else next.add(label.id);
                      return next;
                    })
                  }
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: label.color }}
                  />
                  {label.name}
                </button>
              ))}
              {filterLabelIds.size > 0 && (
                <button
                  className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground px-1 py-0.5 rounded transition-colors"
                  onClick={() => setFilterLabelIds(new Set())}
                  title="Clear label filter"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>
          )}
          {!isSearchMode && teamsStore.length > 0 && (isMobile || isSearchFocused || isFilterBarHovered || filterTeamIds.size > 0) && (
            <div className="flex flex-wrap gap-1 mt-1">
              {teamsStore.map((team) => (
                <button
                  key={team.id}
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-xs transition-colors ${
                    filterTeamIds.has(team.id)
                      ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                      : "bg-muted text-muted-foreground hover:bg-muted/60"
                  }`}
                  onClick={() =>
                    setFilterTeamIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(team.id)) next.delete(team.id);
                      else next.add(team.id);
                      return next;
                    })
                  }
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: "hsl(var(--primary))" }}
                  />
                  {team.name}
                </button>
              ))}
              {filterTeamIds.size > 0 && (
                <button
                  className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground px-1 py-0.5 rounded transition-colors"
                  onClick={() => setFilterTeamIds(new Set())}
                  title="Clear team filter"
                >
                  <X className="w-3 h-3" />
                  Clear
                </button>
              )}
            </div>
          )}
        </div>

        {!isSearchMode && !isFilterMode && (!selectedBacklogId || !selectedTreeId) ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm">Select a list to view work items</p>
            </div>
          </div>
        ) : (
        <>
        {!isSearchMode && !isFilterMode && selectedBacklogId ? (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="p-0.5 pb-0 md:p-1 md:pb-0.5 border-b flex items-start justify-between shrink-0">
          <div className="min-w-0 flex-1">
            {isSearchMode ? (
              <>
                <h2 className="text-base font-semibold">Search results</h2>
                <p className="text-xs text-foreground mt-0.5">
                  {searchResults?.length ?? 0} item{searchResults?.length !== 1 ? "s" : ""} found
                </p>
              </>
            ) : isFilterMode ? (
              <>
                <h2 className="text-base font-semibold">{filterResultsTitle}</h2>
                <p className="text-xs text-foreground mt-0.5">
                  {labelSearchResults?.length ?? 0} item{labelSearchResults?.length !== 1 ? "s" : ""} found
                </p>
              </>
            ) : (
              <>
                <EditableBacklogName backlogId={selectedBacklogId!} isScrambled={isScrambled} />
                <p className="text-xs text-foreground mt-0.5">
                  {`${rootWorkItems.length} item${rootWorkItems.length !== 1 ? "s" : ""}`}
                  {selectedWorkItemIds.length > 0 && (
                    <span className="text-primary font-medium"> · {selectedWorkItemIds.length} selected</span>
                  )}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {!isSearchMode && !isFilterMode && selectedBacklogId && (boardsVisible || timelineAvailable) && (
              <div className="flex items-center rounded-md border bg-muted/40 mr-1 overflow-hidden">
                <button
                  className={`flex items-center gap-1 h-7 px-2 text-xs font-medium transition-colors ${!(boardsVisible && viewMode === "board") && !showTimeline ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={(e) => { e.stopPropagation(); setViewMode("list"); }}
                  title="List view"
                >
                  <ListIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">List</span>
                </button>
                {boardsVisible && (
                <button
                  className={`flex items-center gap-1 h-7 px-2 text-xs font-medium transition-colors ${viewMode === "board" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={(e) => { e.stopPropagation(); setViewMode("board"); }}
                  title="Board view (leaf items by status)"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Board</span>
                </button>
                )}
                {timelineAvailable && (
                <button
                  className={`flex items-center gap-1 h-7 px-2 text-xs font-medium transition-colors ${showTimeline ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={(e) => { e.stopPropagation(); setViewMode("timeline"); }}
                  title="Timeline view (items by start and end date)"
                >
                  <ChartGantt className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Timeline</span>
                </button>
                )}
              </div>
            )}
            {!isSearchMode && !isFilterMode && snoozedInBacklog.length > 0 && (
              <button
                className="flex items-center gap-1 w-auto h-7 px-2 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  unsnoozeAll(snoozedInBacklog);
                }}
                title={`${snoozedInBacklog.length} item${snoozedInBacklog.length !== 1 ? "s" : ""} hidden by snooze — click to unsnooze all`}
              >
                <BellOff className="w-4 h-4" />
                <span className="text-xs font-medium tabular-nums">Snoozed: {snoozedInBacklog.length}</span>
              </button>
            )}
            {!isSearchMode && !isFilterMode && linkedItemsInBacklog.length > 0 && (
              <button
                className={`flex items-center gap-1 w-auto h-7 px-2 rounded-md border transition-colors disabled:opacity-60 ${
                  closedCount > 0
                    ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  void runClosedCheck();
                }}
                disabled={closedChecking}
                title={`Check the ${linkedItemsInBacklog.length} linked item${linkedItemsInBacklog.length !== 1 ? "s" : ""} in this list and mark the ads that have closed. Nothing is saved.`}
              >
                <Ban className={`w-4 h-4 ${closedChecking ? "animate-pulse" : ""}`} />
                {/* A count is worth the width on any screen; the invitation to
                    press is not, so it steps aside on a phone the way the
                    list/board labels do. */}
                <span
                  className={`text-xs font-medium tabular-nums ${
                    closedChecking || closedCount > 0 ? "" : "hidden sm:inline"
                  }`}
                >
                  {closedChecking
                    ? `Checking ${closedProgress?.done ?? 0}/${closedProgress?.total ?? 0}`
                    : closedCount > 0
                      ? `Closed: ${closedCount}`
                      : "Check for closed ads"}
                </span>
              </button>
            )}
            {/* Marks outlive a change of backlog now, so they need a way off
                other than reloading: this clears the ones in view. */}
            {!isSearchMode && !isFilterMode && closedCount > 0 && !closedChecking && (
              <button
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  forgetClosedPostings(linkedItemsInBacklog.map((item) => item.id));
                }}
                title="Clear the closed-ad marks in this list"
                aria-label="Clear the closed-ad marks in this list"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            {!isSearchMode && !isFilterMode && (
              <button
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  handlePasteFromClipboard();
                }}
                title="Paste items from clipboard"
              >
                <ClipboardPaste className="w-4 h-4" />
              </button>
            )}
            {/* The list's sort. A view only — nothing is saved until "Save
                current order as rank" — so it lives in the list view, not on
                the board, and says which order is showing whenever it is not
                rank, so a sorted list is never mistaken for the ranked one. */}
            {!isSearchMode &&
              !isFilterMode &&
              rootWorkItems.length > 1 &&
              !(boardsVisible && viewMode === "board") &&
              !showTimeline &&
              selectedBacklogId &&
              selectedTreeId && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      className={`h-7 flex items-center justify-center gap-1 rounded-md transition-colors ${
                        listSortMode === "rank"
                          ? "w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
                          : "px-2 border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
                      }`}
                      onClick={(e) => e.stopPropagation()}
                      title={
                        listSortMode === "rank"
                          ? "Sort top-level items"
                          : `Sorted by ${listSortLabel(listSortMode)} — shown in this order only for you`
                      }
                    >
                      <ArrowDownAZ className="w-4 h-4" />
                      {listSortMode !== "rank" && (
                        <span className="hidden sm:inline text-xs font-medium">{listSortLabel(listSortMode)}</span>
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
                      Sort top-level items
                    </DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={listSortMode}
                      onValueChange={(value) => setListSortMode(selectedBacklogId, value as ListSortMode)}
                    >
                      {listSortModes(ratingsEnabled, deadlinesEnabledForSort, createdDatesEnabledForSort).map(({ mode, label }) => (
                        <DropdownMenuRadioItem key={mode} value={mode} className="text-xs">
                          {label}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                    {listSortMode !== "rank" && (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-xs"
                          onSelect={() => {
                            saveTopLevelOrderAsRank(selectedTreeId, selectedBacklogId, allBacklogIds);
                            // The shown order is the rank now, so rank shows the same list.
                            setListSortMode(selectedBacklogId, "rank");
                            toast({ title: "Order saved as rank", description: "Press Ctrl+Z to undo" });
                          }}
                        >
                          Save current order as rank
                        </DropdownMenuItem>
                      </>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            {!isSearchMode && !isFilterMode && timeLoggingVisible && (
              <button
                className="flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors px-1 min-w-[1.75rem] h-7"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowBacklogTimeLogDialog(true);
                }}
                title="Log time for this list"
              >
                {backlogTotalMinutes > 0 ? (
                  <span className="text-xs font-medium tabular-nums">{formatDuration(backlogTotalMinutes)}</span>
                ) : (
                  <Clock className="w-4 h-4" />
                )}
              </button>
            )}
            {!isSearchMode && !isFilterMode && (
              <button
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  if (viewMode === "board" && boardsVisible) {
                    window.dispatchEvent(new CustomEvent("board:header-add"));
                  } else if (showTimeline) {
                    setViewMode("list");
                    setIsAdding(true);
                  } else if (isMobile && selectedWorkItemIds.length === 1) {
                    window.dispatchEvent(new CustomEvent("shortcut:add-sibling-workitem"));
                  } else {
                    setIsAdding(true);
                  }
                }}
                title="Add work item (Enter)"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
        </ContextMenuTrigger>
        {/* The same menu as right-clicking this backlog in the tree. */}
        <ContextMenuContent className="w-44">
          {selectedBacklogId && selectedTreeId && (
            <BacklogContextMenuItems
              backlogId={selectedBacklogId}
              treeId={selectedTreeId}
              isScrambled={isScrambled}
              onInsertIcon={(shortcode) =>
                window.dispatchEvent(
                  new CustomEvent("backlog-name:insert-icon", { detail: { backlogId: selectedBacklogId, shortcode } }),
                )
              }
              onAttributes={() => setShowBacklogAttributesSheet(true)}
              onStatuses={() => setShowBacklogStatusesDialog(true)}
              onPoints={() => setShowBacklogPointsDialog(true)}
              onPublish={() => setShowBacklogPublishDialog(true)}
              onDelete={() => setShowBacklogDeleteConfirm(true)}
            />
          )}
        </ContextMenuContent>
        </ContextMenu>
        ) : (
          <div className="p-0.5 pb-0 md:p-1 md:pb-0.5 border-b flex items-start justify-between shrink-0">
            <div className="min-w-0 flex-1">
              {isSearchMode ? (
                <>
                  <h2 className="text-base font-semibold">Search results</h2>
                  <p className="text-xs text-foreground mt-0.5">
                    {searchResults?.length ?? 0} item{searchResults?.length !== 1 ? "s" : ""} found
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-base font-semibold">{filterResultsTitle}</h2>
                  <p className="text-xs text-foreground mt-0.5">
                    {labelSearchResults?.length ?? 0} item{labelSearchResults?.length !== 1 ? "s" : ""} found
                  </p>
                </>
              )}
            </div>
          </div>
        )}
        {!isSearchMode && !isFilterMode && showTimeline && selectedBacklogId && selectedTreeId ? (
          <TimelineView
            treeId={selectedTreeId}
            rootIds={timelineRootIds}
            backlogIds={backlogIdSet}
            isScrambled={isScrambled}
          />
        ) : !isSearchMode && !isFilterMode && boardsVisible && viewMode === "board" && selectedBacklogId && selectedTreeId ? (
          <BoardView backlogId={selectedBacklogId} treeId={selectedTreeId} addWorkItem={addWorkItem} setViewMode={setViewMode} />
        ) : isSearchMode ? (
          /* Search results list: flat list of matching items with tree/backlog context */
          <div className="flex-1 overflow-y-auto p-0 md:p-0.5" onClick={(e) => e.stopPropagation()}>
            {searchResults && searchResults.length > 0 ? (
              <div className="flex flex-col" role="listbox" aria-label="Search results">
                {shownSearchResults.map((result, idx) => {
                  const active = idx === activeSearchIdx;
                  if (!('item' in result)) {
                    const { treeId, backlogId, treeName, backlogName, backlogPath, ranges } = result;
                    return (
                      <div
                        key={`backlog-${backlogId}`}
                        ref={(node) => { if (active) node?.scrollIntoView?.({ block: "nearest" }); }}
                        role="option"
                        aria-selected={active}
                        className={`flex items-start gap-2 px-3 py-1.5 text-left hover:bg-accent/60 transition-colors border-b border-border/30 last:border-b-0 cursor-pointer select-none${active ? " bg-accent" : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          openSearchResult(result);
                        }}
                      >
                        <span
                          className="text-[10px] tabular-nums text-muted-foreground shrink-0 w-5 text-right mt-1 select-none"
                          aria-hidden="true"
                        >
                          {idx + 1}
                        </span>
                        <span className="w-3 h-3 rounded-full shrink-0 mt-1 border border-background/50 bg-muted-foreground/40" />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm leading-snug break-words">
                            <MarkedTitle title={backlogName} ranges={ranges} />
                            <span className="text-[10px] text-muted-foreground ml-1">(list)</span>
                          </span>
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                            {isScrambled ? "···" : [treeName, ...backlogPath].join(" › ")}
                          </p>
                        </div>
                      </div>
                    );
                  }
                  const { item, treeId, backlogId, treeName, backlogPath, workItemAncestors, ranges, elsewhere } = result;
                  const note = elsewhere.length > 0
                    ? elsewhere.map((e) => (e.in === "key" ? `Jira key ${e.snippet}` : `In ${MATCHED_IN_LABEL[e.in]}: ${e.snippet}`)).join(" · ")
                    : undefined;
                  return (
                    <SearchResultItem
                      key={`${item.id}::${treeId}`}
                      item={item}
                      treeId={treeId}
                      backlogId={backlogId}
                      idx={idx}
                      titleNode={<MarkedTitle title={item.title} ranges={ranges} />}
                      workItemAncestors={workItemAncestors}
                      treeName={treeName}
                      backlogPath={backlogPath}
                      isScrambled={isScrambled}
                      active={active}
                      note={note}
                      onNavigate={() => openSearchResult(result)}
                    />
                  );
                })}
                {searchResults.length > shownSearchResults.length && (
                  <button
                    type="button"
                    className="m-2 self-center rounded-md border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearchShown((n) => n + SEARCH_PAGE);
                    }}
                  >
                    Show more ({searchResults.length - shownSearchResults.length} left)
                  </button>
                )}
              </div>
            ) : searchResults ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground px-4 text-center">
                {searchNothingFound(parsedSearch, deferredSearchQuery)}
              </div>
            ) : null}
          </div>
        ) : isFilterMode ? (
          /* Filter results list: flat list of items matching the active label/team filters across all backlogs */
          <div className="flex-1 overflow-y-auto p-0 md:p-0.5" onClick={(e) => e.stopPropagation()}>
            {labelSearchResults && labelSearchResults.length > 0 ? (
              <div className="flex flex-col">
                {labelSearchResults.map(({ item, treeId, backlogId, treeName, backlogPath, workItemAncestors }, idx) => (
                  <SearchResultItem
                    key={`${item.id}::${treeId}`}
                    item={item}
                    treeId={treeId}
                    backlogId={backlogId}
                    idx={idx}
                    titleNode={<IconizedTitle title={item.title} />}
                    workItemAncestors={workItemAncestors}
                    treeName={treeName}
                    backlogPath={backlogPath}
                    isScrambled={isScrambled}
                    onNavigate={() => {
                      // Expand ancestor backlogs and work items so the item is visible
                      useAppStore.setState((state) => {
                        const expandedBacklogs = new Set(state.expandedBacklogs);
                        let bl = state.backlogs[backlogId];
                        while (bl?.parentId) {
                          expandedBacklogs.add(bl.parentId);
                          bl = state.backlogs[bl.parentId];
                        }
                        const expandedWorkItems = new Set(state.expandedWorkItems);
                        let wi = state.workItems[item.id];
                        while (wi) {
                          const pid = getEffectiveParentId(wi, treeId);
                          if (!pid) break;
                          expandedWorkItems.add(pid);
                          wi = state.workItems[pid];
                        }
                        return { expandedBacklogs, expandedWorkItems };
                      });
                      selectBacklog(backlogId, treeId);
                      setFilterLabelIds(new Set());
                      setFilterTeamIds(new Set());
                      setTimeout(() => {
                        selectWorkItem(item.id, false);
                        scrollToWorkItem(item.id);
                      }, 50);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                No items match the selected filter{filterLabelIds.size + filterTeamIds.size !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        ) : (
          <WorkItemRootDropZone treeId={selectedTreeId!} backlogId={selectedBacklogId!}>
          <div className="flex-1 min-h-0 flex flex-col">
            {rootWorkItems.length === 0 && isAdding ? (
              <InlineWorkItemInput
                depth={0}
                onSubmit={(title) => {
                  addWorkItem(title, null, selectedBacklogId!, selectedTreeId!, 0);
                  if (isMobile) setIsAdding(false);
                }}
                onCancel={() => setIsAdding(false)}
              />
            ) : rootWorkItems.length === 0 && !isAdding ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground" role="status" aria-live="polite">
                {workItemsLoading || workItemsRefreshing ? "Loading work items…" : "No work items in this list"}
              </div>
            ) : (
              <div className="flex-1 min-h-0 flex flex-col">
                {isAdding && (
                  <InlineWorkItemInput
                    depth={0}
                    onSubmit={(title) => {
                      addWorkItem(title, null, selectedBacklogId!, selectedTreeId!);
                      if (isMobile) setIsAdding(false);
                    }}
                    onCancel={() => setIsAdding(false)}
                  />
                )}
                <div
                  ref={attachTreeScroll}
                  className="flex-1 overflow-y-auto p-0 md:p-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div
                    className="relative"
                    style={{ height: `${virtualizer.getTotalSize()}px` }}
                  >
                    {virtualizer.getVirtualItems().map((virtualRow) => {
                      const i = virtualRow.index;
                      const id = visibleItemIds[i];
                      const wi = workItems[id];
                      if (!wi) return null;
                      const depth = itemDepthMap.get(id) ?? 0;
                      const dropMeta = reorderDropMeta.get(i);
                      const itemBacklogId = wi.backlogAssignments[selectedTreeId!] ?? selectedBacklogId!;
                      return (
                        <div
                          key={id}
                          data-index={i}
                          ref={virtualizer.measureElement}
                          className="absolute top-0 left-0 w-full"
                          style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                          <ReorderDropZone
                            id={`reorder-flat-${i}`}
                            index={dropMeta?.index ?? 0}
                            treeId={selectedTreeId!}
                            backlogIds={allBacklogIds}
                            parentId={dropMeta?.parentId ?? null}
                            depth={depth}
                            targetBacklogId={allBacklogIds.length > 1 ? itemBacklogId : undefined}
                          />
                          <WorkItemNode
                            workItemId={id}
                            depth={depth}
                            treeId={selectedTreeId!}
                            backlogId={itemBacklogId}
                            allBacklogIds={allBacklogIds}
                            parentBacklogId={selectedBacklogId!}
                            isScrambled={isScrambled}
                            selectedBacklogId={selectedBacklogId!}
                            onSelect={handleSelect}
                            setViewMode={setViewMode}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        </WorkItemRootDropZone>
        )}
        {timeLoggingVisible && selectedBacklogId && (
          <TimeLogDialog
            backlogId={selectedBacklogId}
            open={showBacklogTimeLogDialog}
            onOpenChange={setShowBacklogTimeLogDialog}
          />
        )}
        {showBacklogAttributesSheet && selectedBacklogId && (
          <MobileBacklogAttributesSheet
            backlogId={selectedBacklogId}
            totalPoints={selectedTreeId ? backlogPoints(selectedBacklogId, selectedTreeId, workItems, backlogs).effective : 0}
            open={showBacklogAttributesSheet}
            onOpenChange={setShowBacklogAttributesSheet}
            onOpenTimeLog={() => setShowBacklogTimeLogDialog(true)}
            onOpenPublicLink={() => setShowBacklogPublishDialog(true)}
          />
        )}
        {showBacklogPublishDialog && selectedBacklogId && selectedTreeId && (
          <PublishBacklogDialog
            treeId={selectedTreeId}
            backlogId={selectedBacklogId}
            backlogName={backlogs[selectedBacklogId]?.name ?? ""}
            open
            onOpenChange={setShowBacklogPublishDialog}
          />
        )}
        {showBacklogPointsDialog && selectedBacklogId && selectedTreeId && (
          <BacklogPointsDialog
            backlogId={selectedBacklogId}
            treeId={selectedTreeId}
            open
            onOpenChange={setShowBacklogPointsDialog}
          />
        )}
        {showBacklogStatusesDialog && selectedBacklogId && (
          <BacklogStatusesDialog
            backlogId={selectedBacklogId}
            backlogName={backlogs[selectedBacklogId]?.name ?? ""}
            open={showBacklogStatusesDialog}
            onOpenChange={setShowBacklogStatusesDialog}
          />
        )}
        {showBacklogDeleteConfirm && selectedBacklogId && (
          <ActionPrompt
            title="Delete list?"
            options={[
              {
                label: "Delete",
                description: `Permanently delete "${isScrambled ? scrambleName(backlogs[selectedBacklogId]?.name ?? "") : (backlogs[selectedBacklogId]?.name ?? "")}" and all its contents. This action cannot be undone.`,
                value: "confirm",
                variant: "destructive",
                isDefault: true,
              },
            ]}
            onSelect={() => {
              setShowBacklogDeleteConfirm(false);
              const id = selectedBacklogId;
              guardedDelete({ kind: 'backlog', id }, backlogs[id]?.name ?? 'this list', () => deleteBacklog(id));
            }}
            onCancel={() => setShowBacklogDeleteConfirm(false)}
          />
        )}
        </>
        )}
      </div>
    </RunningNumberContext.Provider>
    </LabelFilterContext.Provider>
    </SharedDataContext.Provider>
  );
}
