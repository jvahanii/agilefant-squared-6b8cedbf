import { useAppStore } from "@/store/appStore";
import { useTeamStore } from "@/store/teamStore";
import { WorkItem, WORK_ITEM_STATUSES, WorkItemStatus, getEffectiveParentId } from "@/types/models";
import { useBacklogStatusesStore, DEFAULT_STATUSES, getEffectiveStatuses, getEffectiveStatusesForTree } from "@/store/backlogStatusesStore";
import { ChevronRight, ChevronDown, GripVertical, FileText, Plus, Trash2, ClipboardPaste, RotateCcw, Link2, Clock, Tag, X, SlidersHorizontal, BellOff, Bell, Search, ArrowDownAZ, FolderInput, List as ListIcon, LayoutGrid, Settings2, Users, Lock, Ban, CalendarClock } from "lucide-react";
import { BoardView } from "./BoardView";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useDraggable, useDroppable, useDndContext } from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";

import { createContext, memo, useContext, useMemo, useState, useRef, useEffect, useCallback } from "react";
import { ActionPrompt } from "./ActionPrompt";
import { MoveToParentDialog } from "./MoveToParentDialog";
import { MoveToBacklogDialog } from "./MoveToBacklogDialog";
import { RespawnSettingsDialog } from "./RespawnSettingsDialog";
import { HyperlinksDialog } from "./HyperlinksDialog";
import { TimeLogDialog, formatDuration } from "./TimeLogDialog";
import { MoveTimeDialog } from "./MoveTimeDialog";
import { FinancialsDialog } from "./FinancialsDialog";
import { FinancialTotalsBadge } from "./FinancialTotalsBadge";
import { useWorkItemFinancialTotals } from "@/hooks/useFinancialTotals";
import { isSavingsIncomeEnabled } from "@/store/orgSettingsStore";
import { SnoozeDialog } from "./SnoozeDialog";
import { DeadlineDialog } from "./DeadlineDialog";
import { formatDeadline, isDeadlinePassed, useDeadlinesEnabled } from "@/lib/workItemDeadline";
import { useTimeEntryStore } from "@/store/timeEntryStore";
import { useIsMobile } from "@/hooks/use-mobile";
import { focusForEdit } from "@/lib/focusEdit";
import { releaseOverlayLock } from "@/lib/overlayLock";
import { cn } from "@/lib/utils";
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
import { useBurnupDialogStore } from "@/store/burnupDialogStore";
import { supabase } from "@/integrations/supabase/client";
import { useScramble } from "@/contexts/ScrambleContext";
import { scrambleName } from "@/lib/scramble";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { ScramblePinDialog, type ScramblePinResult } from "@/components/ScramblePinDialog";
import { PublishBacklogDialog } from "@/components/PublicLinkControls";
import { closedCheckMessage, linkedItemsIn, useClosedPostingsStore } from "@/store/closedPostingsStore";
import { requestTopLevelRerank } from "@/store/rerankGuardStore";
import {
  currentListSortContext,
  saveTopLevelOrderAsRank,
  useListSortMode,
  useListSortStore,
} from "@/store/listSortStore";
import { listSortLabel, listSortModes, sortTopLevel, type ListSortMode } from "@/lib/listSort";
import { StarRating } from "@/components/StarRating";
import { useRatingsEnabled } from "@/lib/ratingsVisibility";
import { peekCurrentUser } from "@/lib/currentUser";
import { IconizedTitle } from "@/components/IconizedTitle";
import { ICON_MAP, ICON_SHORTCODES } from "@/lib/iconMap";
import { computeBacklogTotalMinutes } from "@/lib/timeUtils";
import { useWorkItemTotalMinutes } from "@/lib/timeTotals";
import { buildVisibleRows, effectiveAncestors, effectiveChildren, topLevelItems } from "@/lib/workItemRows";
import { observeWidthForRemeasure } from "@/lib/virtualRows";
import { useLabelsStore, type Label } from "@/store/labelsStore";
import { LabelPicker } from "./LabelPicker";
import { MobileWorkItemAttributesSheet, MobileBacklogAttributesSheet } from "./MobileAttributesSheet";
import { usePointsVisibleForTree } from "@/lib/pointsVisibility";
import { BacklogStatusesDialog } from "./BacklogStatusesDialog";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  useSnoozeStore,
  snoozeOptionLaterToday,
  snoozeOptionTomorrowMorning,
  snoozeOptionNextWeek,
  snoozeOptionThisWeekend,
} from "@/store/snoozeStore";
import { visibleWorkItemIdsRef } from "@/store/navigationRefs";
import { toast } from "@/hooks/use-toast";
import { useDeleteWithTimeGuard } from "@/hooks/useDeleteWithTimeGuard";
/**
 * When a label filter is active, this context holds the Set of work item IDs
 * that should be visible (matching items + their ancestors).  Null means "show
 * all" (no filter active).
 */
const LabelFilterContext = createContext<Set<string> | null>(null);

/**
 * Maps each visible work item ID to its 1-based running number in the current
 * displayed list (depth-first, top-to-bottom).  Null when no backlog is selected.
 */
const RunningNumberContext = createContext<Map<string, number> | null>(null);

/** Shared data computed once per panel render — avoids per-row recomputation. */
interface SharedData {
  orgLabels: Label[];
  teams: ReturnType<typeof useTeamStore.getState>["teams"];
  labelsVisible: boolean;
  labelsMap: ReturnType<typeof useLabelsStore.getState>["labels"];
  byEntity: ReturnType<typeof useLabelsStore.getState>["byEntity"];
  assignLabel: ReturnType<typeof useLabelsStore.getState>["assignLabel"];
  unassignLabel: ReturnType<typeof useLabelsStore.getState>["unassignLabel"];
  createLabel: ReturnType<typeof useLabelsStore.getState>["createLabel"];
  deleteLabel: ReturnType<typeof useLabelsStore.getState>["deleteLabel"];
  assignTeam: ReturnType<typeof useTeamStore.getState>["assignTeamToWorkItem"];
  unassignTeam: ReturnType<typeof useTeamStore.getState>["unassignTeamFromWorkItem"];
  activeOrgId: string | null;
  timeLoggingVisible: boolean;
  savingsIncomeVisible: boolean;
  burnupsVisible: boolean;
}
const SharedDataContext = createContext<SharedData | null>(null);

// Minimum pointer movement (in px) required before treating an interaction as a
// drag rather than a click.  Matches PointerSensor's activationConstraint.distance.
const DRAG_THRESHOLD_PX = 8;
const DRAG_THRESHOLD_PX_SQUARED = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
const EMPTY_ARRAY: string[] = [];

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
  const isMobile = useIsMobile();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) focusForEdit(inputRef.current, isMobile);
  }, [isEditing, isMobile]);

  const startEditing = () => {
    setEditValue(backlog?.name ?? "");
    setIsEditing(true);
  };
  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== backlog?.name) renameBacklog(backlogId, trimmed);
    setIsEditing(false);
  };

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
      {isScrambled ? scrambleName(backlog.name) : <IconizedTitle title={backlog.name} />}
    </h2>
  );
}

function InlineWorkItemInput({
  onSubmit,
  onCancel,
  depth,
}: {
  onSubmit: (title: string) => void;
  onCancel: () => void;
  depth: number;
}) {
  const [value, setValue] = useState("");
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textAreaRef.current?.focus();
  }, []);

  const handleSubmit = (fromBlur = false) => {
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setValue("");
      if (fromBlur) onCancel();
    } else {
      onCancel();
    }
  };

  return (
    <div className="flex items-start gap-1.5 px-3 py-px" style={{ paddingLeft: `${depth * 20 + 100}px` }}>
      <textarea
        ref={textAreaRef}
        rows={1}
        className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-1 py-0.5 placeholder:text-muted-foreground/50 resize-none overflow-hidden"
        placeholder="Work item title…"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => handleSubmit(true)}
      />
    </div>
  );
}

interface WorkItemNodeProps {
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

const WorkItemNode = memo(function WorkItemNode(props: WorkItemNodeProps) {
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
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const expanded = useAppStore((s) => s.expandedWorkItems.has(workItemId));
  const isSelected = useAppStore((s) => s.selectedWorkItemIds.includes(workItemId));
  const isMultiSelected = useAppStore((s) => s.selectedWorkItemIds.length > 1);
  const toggleExpand = useAppStore((s) => s.toggleWorkItemExpand);
  const setWorkItemStatus = useAppStore((s) => s.setWorkItemStatus);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const deleteWorkItemsBulk = useAppStore((s) => s.deleteWorkItemsBulk);
  const guardedDeleteBulk = useDeleteWithTimeGuard();
  const duplicateWorkItems = useAppStore((s) => s.duplicateWorkItems);
  const removeWorkItemsFromTreeBulk = useAppStore((s) => s.removeWorkItemsFromTreeBulk);
  const moveWorkItemsToBacklog = useAppStore((s) => s.moveWorkItemsToBacklog);
  const reorderWorkItemAmongSiblings = useAppStore((s) => s.reorderWorkItemAmongSiblings);
  const sortChildrenAlphabetically = useAppStore((s) => s.sortChildrenAlphabetically);
  const renameWorkItem = useAppStore((s) => s.renameWorkItem);
  const setWorkItemPoints = useAppStore((s) => s.setWorkItemPoints);
  const setWorkItemRating = useAppStore((s) => s.setWorkItemRating);
  const selectBacklog = useAppStore((s) => s.selectBacklog);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  const isMobile = useIsMobile();
  const activeOrgId = shared.activeOrgId;
  const pointsVisible = usePointsVisibleForTree(treeId);
  const orgRatingsEnabled = useRatingsEnabled();
  // The backlog this row is shown in decides too, and starts off.
  const rowBacklogId = item.backlogAssignments?.[treeId];
  const rowBacklogRatings = useAppStore((s) => (rowBacklogId ? s.backlogs[rowBacklogId]?.ratingsEnabled ?? false : false));
  const ratingsVisible = orgRatingsEnabled && rowBacklogRatings;
  const deadlinesVisible = useDeadlinesEnabled();
  const labelsVisible = shared.labelsVisible;
  const timeLoggingVisible = shared.timeLoggingVisible;
  const savingsIncomeVisible = shared.savingsIncomeVisible;
  const burnupsVisible = shared.burnupsVisible;
  const itemFinancials = useWorkItemFinancialTotals(workItemId);
  const itemTotalMinutesCached = useWorkItemTotalMinutes(workItemId);
  const itemTotalMinutes = timeLoggingVisible ? itemTotalMinutesCached : 0;

  // Labels — from shared context (computed once per panel)
  const labelsMap = shared.labelsMap;
  const byEntity = shared.byEntity;
  const assignLabel = shared.assignLabel;
  const unassignLabel = shared.unassignLabel;
  const createLabel = shared.createLabel;
  const deleteLabel = shared.deleteLabel;
  const orgLabels = shared.orgLabels;
  const itemLabels = useMemo(() => {
    if (!labelsVisible) return [];
    const labelIds = byEntity[`work_item:${workItemId}`] ?? [];
    return labelIds
      .map((id) => labelsMap[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [labelsVisible, byEntity, labelsMap, workItemId]);

  // Teams — from shared context
  const teams = shared.teams;
  const workItemTeams = useTeamStore((s) => s.workItemTeams[workItemId] ?? EMPTY_ARRAY);
  const assignTeam = shared.assignTeam;
  const unassignTeam = shared.unassignTeam;

  // Per-backlog effective statuses (walks up parent chain until a materialized
  // set is found; falls back to defaults). Board columns and status list are
  // now unified — column labels ARE status labels.
  // Subscribe to the store so re-renders happen on realtime updates.
  useBacklogStatusesStore((s) => s.statusesByBacklog[backlogId]);
  const treeStatuses = useMemo(
    () =>
      getEffectiveStatuses(backlogId).map((s) => ({
        key: s.key,
        label: s.label,
        color: s.color,
        displayLabel: s.label,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backlogId, useBacklogStatusesStore((s) => s.statusesByBacklog)],
  );

  const [isAdding, setIsAdding] = useState(false);
  const [isAddingSibling, setIsAddingSibling] = useState(false);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [deleteItemIds, setDeleteItemIds] = useState<string[]>([]);
  const [showSortPrompt, setShowSortPrompt] = useState(false);
  // Inline new-label creation in context menu
  const [ctxNewLabelForm, setCtxNewLabelForm] = useState(false);
  const [ctxNewLabelName, setCtxNewLabelName] = useState("");
  const [ctxNewLabelColor, setCtxNewLabelColor] = useState("#6366f1");
  const [ctxLabelSearchQuery, setCtxLabelSearchQuery] = useState("");
  const [ctxTeamSearchQuery, setCtxTeamSearchQuery] = useState("");
  const [teamDropdownOpen, setTeamDropdownOpen] = useState(false);
  const suppressTeamDropdownCloseRef = useRef(false);
  const ctxNewLabelNameRef = useRef<HTMLInputElement>(null);
  const [ctxDeleteLabelId, setCtxDeleteLabelId] = useState<string | null>(null);
  const [showRespawnDialog, setShowRespawnDialog] = useState(false);
  const [showHyperlinksDialog, setShowHyperlinksDialog] = useState(false);
  const [showTimeLogDialog, setShowTimeLogDialog] = useState(false);
  const [showMoveTimeDialog, setShowMoveTimeDialog] = useState(false);
  const [moveTimeEntryIds, setMoveTimeEntryIds] = useState<string[]>([]);
  const [showSnoozeDialog, setShowSnoozeDialog] = useState(false);
  const [showDeadlineDialog, setShowDeadlineDialog] = useState(false);
  const [showFinancialsDialog, setShowFinancialsDialog] = useState(false);
  const [showMobileAttributesSheet, setShowMobileAttributesSheet] = useState(false);
  const [showMoveToParentDialog, setShowMoveToParentDialog] = useState(false);
  // Scrambling replaces the stored title with its Moomin scramble for everyone;
  // only whoever scrambled it can read it back, with their PIN.
  const scrambledBy = useScrambledItemsStore((s) => s.byItem.get(workItemId));
  const isNameScrambled = useScrambledItemsStore((s) => s.byItem.has(workItemId));
  const [scramblePrompt, setScramblePrompt] = useState<
    null | { kind: "scramble" | "reveal" | "unscramble"; mode: "set" | "enter" }
  >(null);
  // The PIN lives per organization, and an item shared in from another one
  // belongs to that organization, not the active one. These are the owning
  // organizations of the rows about to be scrambled that have no PIN yet, so
  // the PIN is asked for and sent only where it is actually needed.
  const orgsNeedingPinRef = useRef<Set<string>>(new Set());
  const [moveToParentItemIds, setMoveToParentItemIds] = useState<string[]>([]);
  const [showMoveToBacklogDialog, setShowMoveToBacklogDialog] = useState(false);
  const [moveToBacklogItemIds, setMoveToBacklogItemIds] = useState<string[]>([]);

  // Snooze store
  const snoozeWorkItem = useSnoozeStore((s) => s.snoozeWorkItem);
  const unsnoozeWorkItem = useSnoozeStore((s) => s.unsnoozeWorkItem);
  const isSnoozed = useSnoozeStore((s) => s.isSnoozed(workItemId));
  const activeSnooze = useSnoozeStore((s) => s.getActiveSnooze(workItemId));

  const handleQuickSnooze = useCallback(async (until: Date) => {
    if (!activeOrgId) return;
    const ids = isSelected && isMultiSelected ? useAppStore.getState().selectedWorkItemIds : [workItemId];
    try {
      await Promise.all(
        ids.map((id) => snoozeWorkItem({ workItemId: id, organizationId: activeOrgId, snoozedUntil: until })),
      );
    } catch (err) {
      console.error('Failed to snooze one or more items', err);
    }
  }, [workItemId, activeOrgId, snoozeWorkItem, isSelected, isMultiSelected]);
  const hyperlinkCount = useAppStore((s) => (s.hyperlinks[workItemId] ?? []).length);
  const postingClosed = useClosedPostingsStore((s) => s.closed.has(workItemId));
  const postingUnknown = useClosedPostingsStore((s) => s.unknown.has(workItemId));
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [isEditingPoints, setIsEditingPoints] = useState(false);
  const [editPoints, setEditPoints] = useState("");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);
  const dragStartedRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const nodeRef = useRef<HTMLDivElement>(null);
  const assignmentCount = item ? Object.keys(item.backlogAssignments).length : 0;

  const handleDeleteClick = useCallback(() => {
    if (!item) return;
    const state = useAppStore.getState();
    const selectedIds = state.selectedWorkItemIds;
    const idsToProcess = isSelected && selectedIds.length > 1 ? [...selectedIds] : [workItemId];
    setDeleteItemIds(idsToProcess);
    const anyMultiAssigned = idsToProcess.some((id) => {
      const wi = state.workItems[id];
      return wi && Object.keys(wi.backlogAssignments).length > 1;
    });
    if (anyMultiAssigned) {
      setShowDeletePrompt(true);
    } else {
      const targets = idsToProcess.map((id) => ({ kind: 'work_item' as const, id }));
      const label = idsToProcess.length === 1
        ? (state.workItems[idsToProcess[0]]?.title ?? 'this item')
        : `${idsToProcess.length} items`;
      guardedDeleteBulk(targets, label, () => deleteWorkItemsBulk(idsToProcess));
    }
  }, [deleteWorkItemsBulk, guardedDeleteBulk, isSelected, item, workItemId]);

  const handleEditHyperlinks = useCallback(() => {
    if (useAppStore.getState().selectedWorkItemIds[0] !== workItemId) return;
    setShowHyperlinksDialog(true);
  }, [workItemId]);

  const handleLogTime = useCallback(() => {
    if (useAppStore.getState().selectedWorkItemIds[0] !== workItemId) return;
    setShowTimeLogDialog(true);
  }, [workItemId]);

  const openMoveToParentDialog = useCallback(() => {
    const ids = useAppStore.getState().selectedWorkItemIds;
    setMoveToParentItemIds(ids.includes(workItemId) && ids.length > 1 ? ids : [workItemId]);
    setShowMoveToParentDialog(true);
  }, [workItemId]);

  const handleMoveToParent = useCallback(() => {
    if (useAppStore.getState().selectedWorkItemIds[0] !== workItemId) return;
    openMoveToParentDialog();
  }, [workItemId, openMoveToParentDialog]);

  const openMoveToBacklogDialog = useCallback(() => {
    const ids = useAppStore.getState().selectedWorkItemIds;
    setMoveToBacklogItemIds(ids.includes(workItemId) && ids.length > 1 ? ids : [workItemId]);
    setShowMoveToBacklogDialog(true);
  }, [workItemId]);

  const handleMoveToBacklog = useCallback(() => {
    if (useAppStore.getState().selectedWorkItemIds[0] !== workItemId) return;
    openMoveToBacklogDialog();
  }, [workItemId, openMoveToBacklogDialog]);

  const handleDuplicate = useCallback(() => {
    const state = useAppStore.getState();
    const selectedIds = state.selectedWorkItemIds;
    const ids = isSelected && selectedIds.length > 1 ? [...selectedIds] : [workItemId];
    const newRootIds = duplicateWorkItems(ids);
    // When a single item was duplicated, focus its title for inline rename.
    if (newRootIds.length === 1) {
      const newId = newRootIds[0];
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("shortcut:edit-title", { detail: { workItemId: newId } }));
      }, 50);
    }
  }, [duplicateWorkItems, isSelected, workItemId]);

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
        const ids = useAppStore.getState().selectedWorkItemIds;
        return ids.includes(workItemId) && ids.length > 1 ? ids : [workItemId];
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
      nodeRef.current = node;
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

  useEffect(() => {
    if (isEditingPoints) focusForEdit(pointsRef.current, isMobile);
  }, [isEditingPoints, isMobile]);

  useEffect(() => {
    if (!isSelected) return;
    const handleAddChild = () => {
      if (!expanded) toggleExpand(workItemId);
      setIsAdding(true);
    };
    const handleAddSibling = () => {
      if (!useAppStore.getState().selectedWorkItemIds.includes(workItemId)) return;
      setIsAddingSibling(true);
    };
    const handleDelete = () => {
      if (useAppStore.getState().selectedWorkItemIds[0] !== workItemId) return;
      handleDeleteClick();
    };
    const handleDuplicate = () => {
      if (useAppStore.getState().selectedWorkItemIds[0] !== workItemId) return;
      handleDuplicateRef.current();
    };
    const handleOpenTeamAssign = () => {
      if (useAppStore.getState().selectedWorkItemIds[0] !== workItemId) return;
      if (teams.length > 0) setTeamDropdownOpen(true);
    };
    window.addEventListener("shortcut:add-child-workitem", handleAddChild);
    window.addEventListener("shortcut:add-sibling-workitem", handleAddSibling);
    window.addEventListener("shortcut:delete-selected", handleDelete);
    window.addEventListener("shortcut:duplicate-selected", handleDuplicate);
    window.addEventListener("shortcut:edit-hyperlinks", handleEditHyperlinks);
    window.addEventListener("shortcut:log-time", handleLogTime);
    window.addEventListener("shortcut:move-to-parent", handleMoveToParent);
    window.addEventListener("shortcut:move-to-backlog", handleMoveToBacklog);
    window.addEventListener("shortcut:open-team-assign", handleOpenTeamAssign);
    return () => {
      window.removeEventListener("shortcut:add-child-workitem", handleAddChild);
      window.removeEventListener("shortcut:add-sibling-workitem", handleAddSibling);
      window.removeEventListener("shortcut:delete-selected", handleDelete);
      window.removeEventListener("shortcut:duplicate-selected", handleDuplicate);
      window.removeEventListener("shortcut:edit-hyperlinks", handleEditHyperlinks);
      window.removeEventListener("shortcut:log-time", handleLogTime);
      window.removeEventListener("shortcut:move-to-parent", handleMoveToParent);
      window.removeEventListener("shortcut:move-to-backlog", handleMoveToBacklog);
      window.removeEventListener("shortcut:open-team-assign", handleOpenTeamAssign);
    };
  }, [expanded, handleDeleteClick, handleEditHyperlinks, handleLogTime, handleMoveToBacklog, handleMoveToParent, isSelected, teams.length, toggleExpand, workItemId]);

  // Keep a stable ref to handleDuplicate so the listener above doesn't need
  // to re-bind every time isSelected changes.
  const handleDuplicateRef = useRef(handleDuplicate);
  useEffect(() => { handleDuplicateRef.current = handleDuplicate; }, [handleDuplicate]);

  // Listen for inline title-edit requests (used after duplicate to focus the new item).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ workItemId?: string }>).detail;
      if (!detail || detail.workItemId !== workItemId) return;
      setEditTitle(item?.title ?? "");
      setIsEditingTitle(true);
    };
    window.addEventListener("shortcut:edit-title", handler);
    return () => window.removeEventListener("shortcut:edit-title", handler);
  }, [workItemId, item?.title]);

  // On mount, if this is the first selected item, scroll it into view so:
  //  - a freshly created item is visible immediately (addWorkItem selects it), and
  //  - the previously-selected item is visible after restore (especially on mobile
  //    where the panel mounts fresh after a tab switch).
  // Use the deferred scroll helper because the row's position is still estimated
  // / unstable until the parent virtualizer has finished measuring rows.
  useEffect(() => {
    const initialSelectedIds = useAppStore.getState().selectedWorkItemIds;
    if (initialSelectedIds.length > 0 && initialSelectedIds[0] === workItemId) {
      scrollWorkItemIntoView(workItemId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The children this row expands into: those under it in *this* tree and in
  // a backlog in view. childrenIds spans every tree, so it can't be used as is.
  const visibleBacklogSet = new Set(allBacklogIds);
  const shownChildCount = effectiveChildren(workItemId, workItems, treeId, visibleBacklogSet).length;

  // Auto-expand a collapsed branch when a drag is held over it for a short time.
  useEffect(() => {
    if (!isOver || isDragging || !item || shownChildCount === 0 || expanded) return;
    const timer = setTimeout(() => {
      toggleExpand(workItemId);
    }, 600);
    return () => clearTimeout(timer);
  }, [isOver, isDragging, item, shownChildCount, expanded, toggleExpand, workItemId]);

  if (!item) return null;

  const hasChildren = shownChildCount > 0;

  const getBacklogPath = (backlogId: string): { id: string; name: string }[] => {
    const path: { id: string; name: string }[] = [];
    let current = backlogs[backlogId];
    while (current) {
      path.unshift({ id: current.id, name: current.name });
      current = current.parentId ? backlogs[current.parentId] : undefined;
    }
    return path;
  };

  const backlogPaths = Object.entries(item.backlogAssignments)
    .filter(([tid]) => tid !== treeId)
    .map(([tid, blId]) => ({ treeId: tid, path: getBacklogPath(blId) }))
    .filter(({ path }) => path.length > 0);

  // A top-level row whose parent is outside the backlog in view shows where it
  // sits — by its parents in this tree, not its global ones.
  const parentItemChain: { id: string; title: string }[] =
    depth === 0 ? effectiveAncestors(workItemId, workItems, treeId).map((a) => ({ id: a.id, title: a.title })) : [];

  const scrambledByMe = isNameScrambled && scrambledBy === (peekCurrentUser()?.id ?? null);

  /** The rows a scramble action applies to: the selection when this row is part
   *  of it, otherwise this row alone — as the other bulk actions here work. */
  const scrambleTargets = (): string[] =>
    isSelected && isMultiSelected ? useAppStore.getState().selectedWorkItemIds : [workItemId];

  const runScramble = async (pin: string): Promise<ScramblePinResult> => {
    const scrambled = useScrambledItemsStore.getState().byItem;
    const items = useAppStore.getState().workItems;
    const ids = scrambleTargets().filter((id) => items[id] && !scrambled.has(id));
    const me = peekCurrentUser()?.id ?? null;
    const needPin = orgsNeedingPinRef.current;
    let done = 0;
    // One at a time: the first call may be the one that sets the PIN, and two
    // at once would collide on it.
    for (const id of ids) {
      // The PIN belongs to the organization that owns the item, so it is sent
      // only for the organizations that have none yet; sending it where one is
      // already set would be checked against it and rejected.
      const itemOrg = items[id].organizationId ?? activeOrgId;
      const sendPin = !itemOrg || needPin.has(itemOrg);
      // The scrambled title is built here so the words match the app's own
      // scramble; the database keeps the original where nobody can read it.
      const { error } = await supabase.rpc("scramble_work_item", {
        _work_item_id: id,
        _scrambled_title: scrambleName(items[id].title),
        _pin: sendPin ? (pin || null) : null,
      });
      if (error) {
        if (done > 0) toast({ title: `${done} scrambled, then it stopped`, description: error.message, variant: "destructive" });
        return { error: error.message };
      }
      useScrambledItemsStore.getState().setScrambled(id, me);
      done += 1;
    }
    if (done > 0) {
      toast({
        title: done === 1 ? "Name scrambled" : `${done} names scrambled`,
        description: done === 1 ? "Only you can read it, with your PIN." : "Only you can read them, with your PIN.",
      });
    }
    return {};
  };

  const startScramble = async () => {
    // Which organizations own the rows about to be scrambled — an item shared
    // in from a partner belongs to that partner, not the active organization,
    // and its PIN is checked there.
    const items = useAppStore.getState().workItems;
    const scrambledNow = useScrambledItemsStore.getState().byItem;
    const orgIds = [
      ...new Set(
        scrambleTargets()
          .filter((id) => items[id] && !scrambledNow.has(id))
          .map((id) => items[id].organizationId ?? activeOrgId)
          .filter((org): org is string => !!org),
      ),
    ];
    if (orgIds.length === 0) return;

    const needPin = new Set<string>();
    for (const orgId of orgIds) {
      const { data, error } = await supabase.rpc("has_scramble_pin", { _organization_id: orgId });
      if (error) {
        toast({ title: "Could not scramble", description: error.message, variant: "destructive" });
        return;
      }
      if (!data) needPin.add(orgId);
    }
    orgsNeedingPinRef.current = needPin;

    // The first scramble in an organization sets the PIN there. Later ones do
    // not ask: hiding a name needs no permission, reading one does.
    if (needPin.size > 0) {
      setScramblePrompt({ kind: "scramble", mode: "set" });
      return;
    }
    const result = await runScramble("");
    if (result.error) toast({ title: "Could not scramble", description: result.error, variant: "destructive" });
  };

  const runReveal = async (pin: string): Promise<ScramblePinResult> => {
    const { data, error } = await supabase.rpc("reveal_scrambled_title", { _work_item_id: workItemId, _pin: pin });
    if (error) return { error: error.message };
    return { revealed: data ?? "" };
  };

  const runUnscramble = async (pin: string): Promise<ScramblePinResult> => {
    const scrambled = useScrambledItemsStore.getState().byItem;
    const me = peekCurrentUser()?.id ?? null;
    // Only the ones this person scrambled: the database refuses the rest, and
    // there is no point asking it.
    const ids = scrambleTargets().filter((id) => scrambled.has(id) && scrambled.get(id) === me);
    let done = 0;
    for (const id of ids) {
      const { error } = await supabase.rpc("unscramble_work_item", { _work_item_id: id, _pin: pin });
      if (error) {
        if (done > 0) toast({ title: `${done} restored, then it stopped`, description: error.message, variant: "destructive" });
        return { error: error.message };
      }
      useScrambledItemsStore.getState().setScrambled(id, undefined);
      done += 1;
    }
    if (done > 0) toast({ title: done === 1 ? "Name restored" : `${done} names restored` });
    return {};
  };


  const handleDeleteChoice = (value: string) => {
    setShowDeletePrompt(false);
    if (value === "remove-from-backlog") removeWorkItemsFromTreeBulk(deleteItemIds.map((id) => ({ workItemId: id, treeId })));
    else if (value === "delete-everywhere") {
      const targets = deleteItemIds.map((id) => ({ kind: 'work_item' as const, id }));
      const label = deleteItemIds.length === 1 ? (workItems[deleteItemIds[0]]?.title ?? 'this item') : `${deleteItemIds.length} items`;
      guardedDeleteBulk(targets, label, () => deleteWorkItemsBulk(deleteItemIds));
    }
  };

  const startEditingTitle = () => {
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
    if (trimmed && trimmed !== item.title) renameWorkItem(workItemId, trimmed);
    setIsEditingTitle(false);
  };

  const startEditingPoints = () => {
    setEditPoints(item.points != null ? String(item.points) : "");
    setIsEditingPoints(true);
  };

  const commitPoints = () => {
    const num = parseInt(editPoints, 10);
    const points = isNaN(num) || num <= 0 ? undefined : num;
    if (isSelected && isMultiSelected) {
      const sel = useAppStore.getState().selectedWorkItemIds;
      useAppStore.getState().runBulk(() => {
        sel.forEach((id) => setWorkItemPoints(id, points));
      });
    } else {
      setWorkItemPoints(workItemId, points);
    }
    setIsEditingPoints(false);
  };

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
            onSelect(workItemId, isMulti, isShift);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (dragStartedRef.current) return;
            const newStatus: WorkItemStatus = item.status === "done" ? "not_started" : "done";
            if (isSelected && isMultiSelected) {
              const sel = useAppStore.getState().selectedWorkItemIds;
              useAppStore.getState().runBulk(() => {
                sel.forEach((id) => setWorkItemStatus(id, newStatus));
              });
            } else {
              setWorkItemStatus(workItemId, newStatus);
            }
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
            className={`w-4 h-4 mt-0.5 flex items-center justify-center shrink-0 ${isChildBacklog ? "text-muted-foreground/50" : "text-muted-foreground"} hover:text-foreground transition-colors`}
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleExpand(workItemId);
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
          <span className="text-sm tabular-nums text-muted-foreground/40 shrink-0 w-6 text-right select-none" aria-hidden="true">
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
                style={{
                  backgroundColor:
                    treeStatuses.find((s) => s.key === item.status)?.color ?? treeStatuses[0]?.color ?? "#94a3b8",
                }}
                onClick={(e) => e.stopPropagation()}
                title={treeStatuses.find((s) => s.key === item.status)?.displayLabel ?? item.status}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[140px]">
              {treeStatuses.map((s) => (
                <DropdownMenuItem
                  key={s.key}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isSelected && isMultiSelected) {
                      const sel = useAppStore.getState().selectedWorkItemIds;
                      useAppStore.getState().runBulk(() => {
                        sel.forEach((id) => setWorkItemStatus(id, s.key as WorkItemStatus));
                      });
                    } else {
                      setWorkItemStatus(workItemId, s.key as WorkItemStatus);
                    }
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
                if (isSelected && isMultiSelected) {
                  const sel = useAppStore.getState().selectedWorkItemIds;
                  useAppStore.getState().runBulk(() => {
                    sel.forEach((id) => setWorkItemRating(id, rating));
                  });
                } else {
                  setWorkItemRating(workItemId, rating);
                }
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
                setShowDeadlineDialog(true);
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
              {labelsVisible && itemLabels.length > 0 && (
                <span className="ml-1">
                  {itemLabels.length === 1 ? (
                    <span style={{ color: itemLabels[0].color }}>{itemLabels[0].name}</span>
                  ) : (
                    <>
                      {"["}
                      {itemLabels.map((label, i) => (
                        <span key={label.id}>
                          {i > 0 && ", "}
                          <span style={{ color: label.color }}>{label.name}</span>
                        </span>
                      ))}
                      {"]"}
                    </>
                  )}
                </span>
              )}
              {teams.length > 0 && (
                <span className="ml-1 text-muted-foreground inline-flex items-center gap-0.5">
                  <DropdownMenu open={teamDropdownOpen} onOpenChange={(open) => {
                    if (!open && suppressTeamDropdownCloseRef.current) {
                      suppressTeamDropdownCloseRef.current = false;
                      return;
                    }
                    setTeamDropdownOpen(open);
                  }}>
                    <DropdownMenuTrigger asChild>
                      <span className="inline-flex items-center gap-0.5 cursor-pointer hover:bg-muted rounded px-0.5 -ml-0.5 transition-colors">
                        {workItemTeams.length > 0 ? (
                          workItemTeams.map((teamId, i) => (
                            <span key={teamId}>
                              {i > 0 && <span>, </span>}
                              {teams.find(t => t.id === teamId)?.name ?? teamId}
                            </span>
                          ))
                        ) : (
                          <Users className="w-3 h-3 text-muted-foreground/50" />
                        )}
                      </span>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-[120px]" onKeyDown={(e) => { if (e.key === 'Escape') e.stopPropagation(); }}>
                      <div className="px-2 pt-1 pb-0.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-1 rounded border border-input bg-background px-1.5 py-0.5">
                          <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                          <input
                            className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
                            placeholder="Search teams…"
                            value={ctxTeamSearchQuery}
                            onChange={(e) => { setCtxTeamSearchQuery(e.target.value); }}
                            onKeyDown={(e) => e.stopPropagation()}
                          />
                          {ctxTeamSearchQuery && (
                            <button className="text-muted-foreground hover:text-foreground" onClick={(e2) => { e2.stopPropagation(); setCtxTeamSearchQuery(""); }}>
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      {teams
                        .filter((t) => !ctxTeamSearchQuery.trim() || t.name.toLowerCase().includes(ctxTeamSearchQuery.toLowerCase()))
                        .map((team) => {
                          const contextIds = isSelected && isMultiSelected ? useAppStore.getState().selectedWorkItemIds : [workItemId];
                          const assignedCount = contextIds.filter((id) => {
                            const ids = useTeamStore.getState().workItemTeams[id] ?? EMPTY_ARRAY;
                            return ids.includes(team.id);
                          }).length;
                          const fullyAssigned = assignedCount === contextIds.length;
                          const partiallyAssigned = assignedCount > 0 && !fullyAssigned;
                          return (
                            <DropdownMenuItem
                              key={team.id}
                              className="text-xs"
                              onSelect={(e) => e.preventDefault()}
                              onClick={(e) => {
                                e.stopPropagation();
                                suppressTeamDropdownCloseRef.current = true;
                                if (fullyAssigned) {
                                  contextIds.forEach((id) => unassignTeam(id, team.id));
                                } else {
                                  contextIds.forEach((id) => {
                                    const ids = useTeamStore.getState().workItemTeams[id] ?? EMPTY_ARRAY;
                                    if (!ids.includes(team.id)) {
                                      assignTeam(id, team.id, team.organization_id || activeOrgId!);
                                    }
                                  });
                                }
                              }}
                            >
                              <span
                                className="w-2.5 h-2.5 rounded-full mr-1 shrink-0 inline-block"
                                style={{
                                  backgroundColor: fullyAssigned ? "hsl(var(--primary))" : partiallyAssigned ? "hsl(var(--primary) / 0.4)" : "transparent",
                                  border: fullyAssigned ? "none" : "1px solid hsl(var(--muted-foreground)/0.4)",
                                }}
                              />
                              {team.name}
                              {partiallyAssigned && <span className="ml-1 text-[10px] text-muted-foreground">({assignedCount}/{contextIds.length})</span>}
                            </DropdownMenuItem>
                          );
                        })}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              )}
            </span>
          )}

          {item.respawnEnabled && (() => {
            const days = item.respawnIntervalDays ?? 7;
            return (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="shrink-0 mt-0.5 text-primary/70" onClick={(e) => e.stopPropagation()}>
                      <RotateCcw className="w-3 h-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs">
                    Respawns every {days} day{days !== 1 ? "s" : ""}
                    {item.respawnHour != null ? ` at ${item.respawnHour}:00` : ""}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            );
          })()}

          {isSnoozed && activeSnooze && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="shrink-0 mt-0.5 text-amber-500/80 hover:text-amber-500 transition-colors"
                    onClick={(e) => { e.stopPropagation(); unsnoozeWorkItem(workItemId); }}
                  >
                    <BellOff className="w-3 h-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  Snoozed until {new Date(activeSnooze.snoozedUntil).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (click to unsnooze)
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {hyperlinkCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="shrink-0 mt-0.5 text-primary/70 hover:text-primary transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowHyperlinksDialog(true);
                    }}
                  >
                    <Link2 className="w-3 h-3" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  {hyperlinkCount} hyperlink{hyperlinkCount !== 1 ? "s" : ""}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* Set by the header's ad check, and only until the page reloads:
              the posting said it is no longer taking applications. */}
          {postingClosed && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 mt-0.5 flex items-center gap-0.5 rounded px-1 text-[10px] font-medium bg-destructive/10 text-destructive">
                    <Ban className="w-2.5 h-2.5" />
                    Closed
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  This ad is no longer accepting applications
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {/* The check reached nothing here, which is not the same as the ad
              being live — say so rather than leave the row looking checked. */}
          {postingUnknown && !postingClosed && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="shrink-0 mt-0.5 rounded px-1 text-[10px] font-medium bg-muted text-muted-foreground">
                    ?
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  The board would not answer, so this one is unchecked
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}

          {parentItemChain.length > 0 && (
            <div className="hidden md:flex items-center shrink-0 mt-0.5 text-[10px] text-muted-foreground/70 max-w-[200px]">
              {parentItemChain.map((ancestor, i) => (
                <span key={ancestor.id} className="flex items-center min-w-0">
                  {i > 0 && <ChevronRight className="w-2.5 h-2.5 mx-0.5 opacity-40 shrink-0" />}
                  <span className="truncate">{isScrambled ? scrambleName(ancestor.title) : <IconizedTitle title={ancestor.title} />}</span>
                </span>
              ))}
              <ChevronRight className="w-2.5 h-2.5 mx-0.5 opacity-40 shrink-0" />
            </div>
          )}

          {(isChildBacklog || backlogPaths.length > 0) && (
            <div className="hidden md:flex items-center gap-1.5 shrink-0 ml-auto mt-0.5">
              {isChildBacklog && (parentBacklogId === undefined || backlogId !== parentBacklogId) && backlogs[backlogId] && (
                <div className="flex items-center text-[10px] text-muted-foreground/70">
                  <span className="mr-0.5">in</span>
                  <button
                    className="hover:text-foreground hover:underline transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectBacklog(backlogId, treeId);
                    }}
                  >
                    {isScrambled ? scrambleName(backlogs[backlogId].name) : backlogs[backlogId].name}
                  </button>
                </div>
              )}
              {backlogPaths.map(({ treeId: tid, path }) => (
                <div key={tid} className="flex items-center text-[10px] text-foreground">
                  <span className="mr-0.5">also in</span>
                  {path.map((seg, i) => (
                    <span key={seg.id} className="flex items-center">
                      {i > 0 && <ChevronRight className="w-2.5 h-2.5 mx-0.5 opacity-40" />}
                      <button
                        className="hover:text-foreground hover:underline transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          selectBacklog(seg.id, tid);
                        }}
                      >
                        {isScrambled ? scrambleName(seg.name) : seg.name}
                      </button>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-1 mt-0.5">
            {pointsVisible && (() => {
                const getEffectivePoints = (wi: any): number => {
                  const own = wi.points ?? 0;
                  const childrenSum = wi.childrenIds.reduce((sum: number, cid: string) => {
                    const child = workItems[cid];
                    return sum + (child ? getEffectivePoints(child) : 0);
                  }, 0);
                  return Math.max(own, childrenSum);
                };
                const getCompletedPoints = (wi: any): number => {
                  if (wi.status === 'done') return getEffectivePoints(wi);
                  return wi.childrenIds.reduce((sum: number, cid: string) => {
                    const child = workItems[cid];
                    return sum + (child ? getCompletedPoints(child) : 0);
                  }, 0);
                };
                const totalPoints = getEffectivePoints(item);
                const directChildrenSum = item.childrenIds.reduce((sum, cid) => {
                  const child = workItems[cid];
                  return sum + (child ? getEffectivePoints(child) : 0);
                }, 0);
                const isRolledUp = directChildrenSum > 0 && directChildrenSum > (item.points ?? 0);
                const hasChildren = item.childrenIds.length > 0;
                const completedPoints = hasChildren ? getCompletedPoints(item) : 0;
                const pointsLabel = hasChildren && totalPoints > 0
                  ? `${completedPoints}/${totalPoints}`
                  : totalPoints > 0 ? String(totalPoints) : "–";
                return (
                  <>
                    {/* Desktop: inline editable points */}
                    {isEditingPoints ? (
                      <input
                        ref={pointsRef}
                        className="hidden md:block w-10 text-xs text-center bg-transparent border-b border-primary/40 outline-none tabular-nums"
                        value={editPoints}
                        onChange={(e) => setEditPoints(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitPoints();
                          if (e.key === "Escape") setIsEditingPoints(false);
                        }}
                        onBlur={commitPoints}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className={`hidden md:inline text-xs tabular-nums cursor-text shrink-0 min-w-[20px] text-center ${isRolledUp ? "text-primary font-medium" : "text-muted-foreground"}`}
                        onClick={(e) => { e.stopPropagation(); startEditingPoints(); }}
                        title={
                          isRolledUp
                            ? `Own: ${item.points ?? 0}, Rolled-up: ${directChildrenSum}`
                            : "Story points (click to edit)"
                        }
                      >
                        {pointsLabel}
                      </span>
                    )}
                    {/* Mobile: points display — tappable to open the attributes sheet for editing.
                        Always visible when points are enabled so zero-point items can also be edited. */}
                    <span
                      className={`md:hidden text-xs tabular-nums cursor-pointer shrink-0 min-w-[20px] text-center ${(totalPoints > 0 && isRolledUp) ? "text-primary font-medium" : "text-muted-foreground"}`}
                      title="Story points (tap to edit)"
                      onClick={(e) => { e.stopPropagation(); setShowMobileAttributesSheet(true); }}
                    >
                      {totalPoints > 0 ? pointsLabel : "–"}
                    </span>
                  </>
                );
              })()}

            {savingsIncomeVisible && itemFinancials.hasData && (
              <FinancialTotalsBadge
                savings={itemFinancials.savings}
                income={itemFinancials.income}
                currency={itemFinancials.currency}
              />
            )}


            {/* Mobile actions: Plus only — other actions via context menu (long-press) */}
            <div className={`flex md:hidden items-center gap-0.5 shrink-0 ${!isSelected ? "invisible" : ""}`}>
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!expanded) toggleExpand(workItemId);
                  setIsAdding(true);
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
                  if (!expanded) toggleExpand(workItemId);
                  setIsAdding(true);
                }}
                title="Add child item (Shift+Enter)"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowRespawnDialog(true);
                }}
                title="Respawn settings"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowHyperlinksDialog(true);
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
                    setShowTimeLogDialog(true);
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
                  handleDeleteClick();
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
        <ContextMenuContent className="w-52">
          <ContextMenuLabel className="text-xs truncate">{item.title}</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger className="text-xs">
              <span
                className="w-2 h-2 rounded-full mr-2 shrink-0 inline-block"
                style={{ backgroundColor: treeStatuses.find((s) => s.key === item.status)?.color ?? "#94a3b8" }}
              />
              Status
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={item.status}
                onValueChange={(val) => {
                  if (isSelected && isMultiSelected) {
                    const sel = useAppStore.getState().selectedWorkItemIds;
                    useAppStore.getState().runBulk(() => {
                      sel.forEach((id) => setWorkItemStatus(id, val as WorkItemStatus));
                    });
                  } else {
                    setWorkItemStatus(workItemId, val as WorkItemStatus);
                  }
                }}
              >
                {treeStatuses.map((s) => (
                  <ContextMenuRadioItem key={s.key} value={s.key} className="text-xs">
                    <span className="w-2 h-2 rounded-full mr-1 shrink-0 inline-block" style={{ backgroundColor: s.color }} />
                    {s.displayLabel}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          {deadlinesVisible && (
            <ContextMenuItem className="text-xs" onSelect={() => setShowDeadlineDialog(true)}>
              <CalendarClock className="w-3 h-3 mr-2" />
              {item.deadline ? "Change deadline…" : "Set deadline…"}
            </ContextMenuItem>
          )}
          <ContextMenuItem className="text-xs" onSelect={() => {
            setViewMode("board");
            // Select the item after view mode change and React reconciliation
            setTimeout(() => {
              selectWorkItem(workItemId, false);
            }, 100);
          }}>
            <LayoutGrid className="w-3 h-3 mr-2" />
            View in board
          </ContextMenuItem>
          {burnupsVisible && (
            <ContextMenuItem
              className="text-xs"
              onSelect={() =>
                useBurnupDialogStore.getState().openBurnup({ kind: 'work_item', id: workItemId, name: item.title })
              }
            >
              View burnup…
            </ContextMenuItem>
          )}
          <ContextMenuItem
            className="text-xs"
            onSelect={() => {
              const state = useAppStore.getState();
              const backlogIds: string[] = [];
              const collectBacklogs = (id: string) => {
                backlogIds.push(id);
                state.backlogs[id]?.childrenIds.forEach(collectBacklogs);
              };
              collectBacklogs(backlogId);
              const viewedBacklogId = state.selectedBacklogIds[0] ?? backlogId;
              const inView = new Set(backlogIds);
              const parentId = getEffectiveParentId(item, treeId);
              requestTopLevelRerank({
                treeId,
                backlogId: viewedBacklogId,
                backlogIds,
                touchesTopLevel: parentId === null || !inView.has(state.workItems[parentId]?.backlogAssignments[treeId]),
                proceed: () => {
                  reorderWorkItemAmongSiblings(workItemId, 0, treeId, backlogIds);
                  toast({ title: "Moved item to top", description: item.title });
                },
              });
            }}
          >
            Rank to top
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger className="text-xs">Insert icon</ContextMenuSubTrigger>
            <ContextMenuSubContent
              className="max-h-60 overflow-y-auto w-56 max-w-[calc(100vw-1.5rem)]"
              collisionPadding={8}
            >
              <div className="grid grid-cols-6 gap-0.5 p-1">
                {ICON_SHORTCODES.map((sc) => (
                  <button
                    key={sc}
                    className="w-8 h-8 flex items-center justify-center rounded hover:bg-accent text-lg"
                    title={`:${sc}:`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const shortcode = `:${sc}:`;
                      if (isEditingTitle && titleRef.current) {
                        const ta = titleRef.current;
                        const start = ta.selectionStart;
                        const end = ta.selectionEnd;
                        const before = editTitle.slice(0, start);
                        const after = editTitle.slice(end);
                        const newTitle = before + shortcode + after;
                        setEditTitle(newTitle);
                        requestAnimationFrame(() => {
                          ta.focus();
                          const pos = start + shortcode.length;
                          ta.setSelectionRange(pos, pos);
                        });
                      } else {
                        setEditTitle(item.title + shortcode);
                        setIsEditingTitle(true);
                      }
                    }}
                  >
                    {ICON_MAP[sc]}
                  </button>
                ))}
              </div>
            </ContextMenuSubContent>
          </ContextMenuSub>
          {/* A scrambled name cannot be edited — the database refuses it, since
              a rename would be lost when the original is put back, and would
              let anyone replace a name they cannot read. */}
          {!isNameScrambled && (
            <ContextMenuItem className="text-xs" onSelect={startEditingTitle}>
              Rename
            </ContextMenuItem>
          )}
          {!isNameScrambled ? (
            <ContextMenuItem className="text-xs" onSelect={() => void startScramble()}>
              Scramble {isSelected && isMultiSelected ? "names" : "name"}…
            </ContextMenuItem>
          ) : scrambledByMe ? (
            <>
              {/* Revealing is always about this one row; a dialog cannot show
                  several names at once, and each is worth asking for. */}
              <ContextMenuItem className="text-xs" onSelect={() => setScramblePrompt({ kind: "reveal", mode: "enter" })}>
                Show real name…
              </ContextMenuItem>
              <ContextMenuItem className="text-xs" onSelect={() => setScramblePrompt({ kind: "unscramble", mode: "enter" })}>
                Unscramble {isSelected && isMultiSelected ? "names" : "name"}…
              </ContextMenuItem>
            </>
          ) : (
            <ContextMenuItem className="text-xs" disabled>
              Scrambled by someone else
            </ContextMenuItem>
          )}
          <ContextMenuItem className="text-xs" onSelect={handleDuplicate}>
            Duplicate
            <span className="ml-auto text-[10px] text-muted-foreground">⌘D</span>
          </ContextMenuItem>
          {pointsVisible && (
            <ContextMenuItem
              className="text-xs"
              onSelect={() => {
                // The inline points input only exists on desktop; on mobile the
                // points field lives in the attributes sheet.
                if (isMobile) setShowMobileAttributesSheet(true);
                else startEditingPoints();
              }}
            >
              Edit story points
            </ContextMenuItem>
          )}


          <ContextMenuItem
            className="text-xs"
            onSelect={() => {
              if (!expanded) toggleExpand(workItemId);
              setIsAdding(true);
            }}
          >
            Add child item
          </ContextMenuItem>
          {item.childrenIds.length > 1 && (
            <ContextMenuItem
              className="text-xs"
              onSelect={() => setShowSortPrompt(true)}
            >
              <ArrowDownAZ className="w-3 h-3 mr-1.5 shrink-0" />
              Sort children A→Z
            </ContextMenuItem>
          )}
          <ContextMenuItem className="text-xs" onSelect={openMoveToBacklogDialog}>
            <FolderInput className="w-3 h-3 mr-1.5 shrink-0" />
            Move…
            <span className="ml-auto text-[10px] text-muted-foreground">M</span>
          </ContextMenuItem>
          {allBacklogIds.length > 1 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-xs">
                Move to backlog
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {allBacklogIds
                  .filter((blId) => blId !== backlogId)
                  .map((blId) => (
                    <ContextMenuItem
                      key={blId}
                      className="text-xs"
                      onSelect={() => {
                        const ids = isSelected && isMultiSelected ? useAppStore.getState().selectedWorkItemIds : [workItemId];
                        moveWorkItemsToBacklog(ids, blId, treeId);
                      }}
                    >
                      {isScrambled ? scrambleName(backlogs[blId]?.name ?? blId) : (backlogs[blId]?.name ?? blId)}
                    </ContextMenuItem>
                  ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          <ContextMenuItem
            className="text-xs"
            onSelect={openMoveToParentDialog}
          >
            Reparent…
          </ContextMenuItem>
          <ContextMenuSeparator />
          {labelsVisible && orgLabels.length > 0 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-xs">Labels</ContextMenuSubTrigger>
              <ContextMenuSubContent
                className="max-h-60 overflow-y-auto w-56 max-w-[calc(100vw-1.5rem)]"
                collisionPadding={8}
              >
                <div className="px-2 pt-1 pb-0.5">
                  <div className="flex items-center gap-1 rounded border border-input bg-background px-1.5 py-0.5">
                    <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                    <input
                      className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
                      placeholder="Search labels…"
                      value={ctxLabelSearchQuery}
                      onChange={(e) => setCtxLabelSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                    {ctxLabelSearchQuery && (
                      <button className="text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); setCtxLabelSearchQuery(""); }}>
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
                {orgLabels
                  .filter((l) => !ctxLabelSearchQuery.trim() || l.name.toLowerCase().includes(ctxLabelSearchQuery.toLowerCase()))
                  .map((label) => {
                    const contextIds = isSelected && isMultiSelected ? useAppStore.getState().selectedWorkItemIds : [workItemId];
                    const assignedCount = contextIds.filter((id) => (byEntity[`work_item:${id}`] ?? []).includes(label.id)).length;
                    const fullyAssigned = assignedCount === contextIds.length;
                    const partiallyAssigned = assignedCount > 0 && !fullyAssigned;
                    return (
                      <ContextMenuCheckboxItem
                        key={label.id}
                        className="text-xs pr-1"
                        checked={fullyAssigned}
                        data-partially={partiallyAssigned || undefined}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            contextIds.forEach((id) => assignLabel(label.id, "work_item", id, label.organizationId));
                          } else {
                            contextIds.forEach((id) => unassignLabel(label.id, "work_item", id));
                          }
                        }}
                      >
                        <span className="w-2 h-2 rounded-full mr-1 shrink-0 inline-block" style={{ backgroundColor: label.color }} />
                        <span className="flex-1 min-w-0 truncate">{label.name}</span>
                        {partiallyAssigned && <span className="ml-1 shrink-0 text-[10px] text-muted-foreground">({assignedCount}/{contextIds.length})</span>}
                        <button
                          className="ml-1 shrink-0 p-1 -my-1 rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setCtxDeleteLabelId(label.id); }}
                          title={`Delete label "${label.name}"`}
                          aria-label={`Delete label ${label.name}`}
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </ContextMenuCheckboxItem>
                    );
                  })}
                <ContextMenuSeparator />
                {ctxNewLabelForm ? (
                  <div className="px-2 py-1.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center gap-2">
                      <input type="color" value={ctxNewLabelColor} onChange={(e) => setCtxNewLabelColor(e.target.value)} className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0" />
                      <input ref={ctxNewLabelNameRef} className="flex-1 text-xs bg-transparent border-b border-primary/40 outline-none px-1 py-0.5" placeholder="Label name…" value={ctxNewLabelName} onChange={(e) => setCtxNewLabelName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const handleCreate = async () => { if (!activeOrgId || !ctxNewLabelName.trim()) return; const label = await createLabel(activeOrgId, ctxNewLabelName.trim(), ctxNewLabelColor); if (label) { const contextIds = isSelected && isMultiSelected ? useAppStore.getState().selectedWorkItemIds : [workItemId]; contextIds.forEach((id) => assignLabel(label.id, "work_item", id, activeOrgId)); } setCtxNewLabelName(""); setCtxNewLabelForm(false); }; handleCreate(); } if (e.key === "Escape") { setCtxNewLabelForm(false); setCtxNewLabelName(""); } e.stopPropagation(); }} />
                      <button className="text-muted-foreground hover:text-foreground" onClick={() => { setCtxNewLabelForm(false); setCtxNewLabelName(""); }}><X className="w-3.5 h-3.5" /></button>
                    </div>
                    <button className="w-full text-xs text-center py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={!ctxNewLabelName.trim()} onClick={async () => { if (!activeOrgId || !ctxNewLabelName.trim()) return; const label = await createLabel(activeOrgId, ctxNewLabelName.trim(), ctxNewLabelColor); if (label) { const contextIds = isSelected && isMultiSelected ? useAppStore.getState().selectedWorkItemIds : [workItemId]; contextIds.forEach((id) => assignLabel(label.id, "work_item", id, activeOrgId)); } setCtxNewLabelName(""); setCtxNewLabelForm(false); }}>Create</button>
                  </div>
                ) : (
                  <ContextMenuItem className="text-xs" onSelect={(e) => { e.preventDefault(); setCtxNewLabelForm(true); setCtxLabelSearchQuery(""); }}>
                    <Plus className="w-3 h-3 mr-2" /> New label
                  </ContextMenuItem>
                )}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          {teams.length > 0 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-xs">Assign teams</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                  <div className="px-2 pt-1 pb-0.5">
                    <div className="flex items-center gap-1 rounded border border-input bg-background px-1.5 py-0.5">
                      <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                      <input
                        className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
                        placeholder="Search teams…"
                        value={ctxTeamSearchQuery}
                        onChange={(e) => { setCtxTeamSearchQuery(e.target.value); }}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                      {ctxTeamSearchQuery && (
                        <button className="text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); setCtxTeamSearchQuery(""); }}>
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {teams
                    .filter((t) => !ctxTeamSearchQuery.trim() || t.name.toLowerCase().includes(ctxTeamSearchQuery.toLowerCase()))
                    .map((team) => {
                  const contextIds = isSelected && isMultiSelected ? useAppStore.getState().selectedWorkItemIds : [workItemId];
                  const assignedCount = contextIds.filter((id) => {
                    const ids = useTeamStore.getState().workItemTeams[id] ?? EMPTY_ARRAY;
                    return ids.includes(team.id);
                  }).length;
                  const fullyAssigned = assignedCount === contextIds.length;
                  const partiallyAssigned = assignedCount > 0 && !fullyAssigned;
                  return (
                    <ContextMenuItem
                      key={team.id}
                      className="text-xs"
                      onSelect={(e) => e.preventDefault()}
                      onClick={() => {
                        if (fullyAssigned) {
                          contextIds.forEach((id) => unassignTeam(id, team.id));
                        } else {
                          contextIds.forEach((id) => {
                            const ids = useTeamStore.getState().workItemTeams[id] ?? EMPTY_ARRAY;
                            if (!ids.includes(team.id)) {
                              assignTeam(id, team.id, team.organization_id || activeOrgId!);
                            }
                          });
                        }
                      }}
                    >
                      <span
                        className="w-2.5 h-2.5 rounded-full mr-1 shrink-0 inline-block"
                        style={{
                          backgroundColor: fullyAssigned ? "hsl(var(--primary))" : partiallyAssigned ? "hsl(var(--primary) / 0.4)" : "transparent",
                          border: fullyAssigned ? "none" : "1px solid hsl(var(--muted-foreground)/0.4)",
                        }}
                      />
                      {team.name}
                      {partiallyAssigned && <span className="ml-1 text-[10px] text-muted-foreground">({assignedCount}/{contextIds.length})</span>}
                    </ContextMenuItem>
                  );
                })}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          {timeLoggingVisible && (
            <>
              <ContextMenuItem className="text-xs" onSelect={() => setShowTimeLogDialog(true)}>
                Log time
              </ContextMenuItem>
              <ContextMenuItem className="text-xs" onSelect={() => {
                const ids = Object.values(useTimeEntryStore.getState().timeEntries)
                  .filter(e => e.workItemId === workItemId)
                  .map(e => e.id);
                setMoveTimeEntryIds(ids);
                setShowMoveTimeDialog(true);
              }}>
                Transfer time entries
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSub>
            <ContextMenuSubTrigger className="text-xs">
              <BellOff className="w-3 h-3 mr-2" />
              Snooze
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionLaterToday())}>
                <span className="flex-1">Later Today</span>
                <span className="ml-4 text-muted-foreground text-[10px]">3h from now</span>
              </ContextMenuItem>
              <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionTomorrowMorning())}>
                <span className="flex-1">Tomorrow Morning</span>
                <span className="ml-4 text-muted-foreground text-[10px]">7:00 AM</span>
              </ContextMenuItem>
              <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionThisWeekend())}>
                <span className="flex-1">This Weekend</span>
                <span className="ml-4 text-muted-foreground text-[10px]">Sat 7:00 AM</span>
              </ContextMenuItem>
              <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionNextWeek())}>
                <span className="flex-1">Next Week</span>
                <span className="ml-4 text-muted-foreground text-[10px]">Mon 7:00 AM</span>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem className="text-xs" onSelect={() => setShowSnoozeDialog(true)}>
                Pick Date / Time…
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          {isSnoozed && (
            <ContextMenuItem className="text-xs" onSelect={() => unsnoozeWorkItem(workItemId)}>
              <Bell className="w-3 h-3 mr-2" />
              Unsnooze
            </ContextMenuItem>
          )}
          <ContextMenuItem className="text-xs" onSelect={() => setShowRespawnDialog(true)}>
            Respawn settings
          </ContextMenuItem>
          <ContextMenuItem className="text-xs" onSelect={() => setShowHyperlinksDialog(true)}>
            Hyperlinks
          </ContextMenuItem>
          {isSavingsIncomeEnabled(activeOrgId) && (
            <ContextMenuItem className="text-xs" onSelect={() => setShowFinancialsDialog(true)}>
              Savings &amp; Income
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-xs text-destructive focus:text-destructive"
            onSelect={handleDeleteClick}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
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
      {showDeletePrompt && (
        <ActionPrompt
          title={deleteItemIds.length > 1 ? `Delete ${deleteItemIds.length} selected items?` : `"${item.title}" is in ${assignmentCount} backlogs`}
          options={[
            {
              label: "Remove from this backlog",
              description: deleteItemIds.length > 1
                ? `Remove all selected items from this backlog only. Keeps them in other backlogs.`
                : `Remove from "${backlogs[item.backlogAssignments[treeId]]?.name}" only. Keeps it in other backlogs.`,
              value: "remove-from-backlog",
              isDefault: true,
            },
            {
              label: "Delete everywhere",
              description: deleteItemIds.length > 1
                ? "Permanently delete all selected items from all backlogs."
                : "Permanently delete this item from all backlogs.",
              value: "delete-everywhere",
              variant: "destructive",
            },
          ]}
          onSelect={handleDeleteChoice}
          onCancel={() => setShowDeletePrompt(false)}
        />
      )}
      {showSortPrompt && (
        <ActionPrompt
          title="Sort children A→Z?"
          options={[
            {
              label: "Sort A→Z",
              description: "Sorts children alphabetically. You can undo with Ctrl+Z.",
              value: "confirm",
              isDefault: true,
            },
          ]}
          onSelect={() => {
            const state = useAppStore.getState();
            const backlogIds: string[] = [];
            const collectBacklogs = (id: string) => {
              backlogIds.push(id);
              state.backlogs[id]?.childrenIds.forEach(collectBacklogs);
            };
            collectBacklogs(backlogId);
            sortChildrenAlphabetically(workItemId, treeId, backlogIds);
            toast({ title: "Children sorted A→Z", description: "Press Ctrl+Z to undo" });
            setShowSortPrompt(false);
          }}
          onCancel={() => setShowSortPrompt(false)}
        />
      )}
      {ctxDeleteLabelId && (
        <ActionPrompt
          title={`Delete label "${labelsMap[ctxDeleteLabelId]?.name ?? ctxDeleteLabelId}"?`}
          options={[
            {
              label: "Delete",
              description: "Permanently delete this label from all items. This cannot be undone.",
              value: "confirm",
              variant: "destructive",
              isDefault: true,
            },
          ]}
          onSelect={() => { deleteLabel(ctxDeleteLabelId); setCtxDeleteLabelId(null); }}
          onCancel={() => setCtxDeleteLabelId(null)}
        />
      )}
      {showRespawnDialog && (
        <RespawnSettingsDialog
          workItemId={workItemId}
          open
          onOpenChange={(o) => { setShowRespawnDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
      {scramblePrompt && (
        <ScramblePinDialog
          open
          onOpenChange={(o) => { if (!o) { setScramblePrompt(null); releaseOverlayLock(); } }}
          mode={scramblePrompt.mode}
          action={
            scramblePrompt.kind === "scramble"
              ? "Scramble"
              : scramblePrompt.kind === "reveal"
                ? "Show name"
                : "Unscramble"
          }
          itemTitle={item.title}
          onConfirm={
            scramblePrompt.kind === "scramble"
              ? runScramble
              : scramblePrompt.kind === "reveal"
                ? runReveal
                : runUnscramble
          }
        />
      )}
      {showHyperlinksDialog && (
        <HyperlinksDialog
          workItemId={workItemId}
          open
          onOpenChange={(o) => { setShowHyperlinksDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
      {showFinancialsDialog && isSavingsIncomeEnabled(activeOrgId) && (
        <FinancialsDialog
          workItemId={workItemId}
          open
          onOpenChange={(o) => { setShowFinancialsDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
      {showTimeLogDialog && timeLoggingVisible && (
        <TimeLogDialog
          workItemId={workItemId}
          open
          onOpenChange={(o) => { setShowTimeLogDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
      {showMoveTimeDialog && timeLoggingVisible && (
        <MoveTimeDialog
          entryIds={moveTimeEntryIds}
          title={`Transfer time entries from "${item.title}"`}
          open
          onOpenChange={(o) => { setShowMoveTimeDialog(o); if (!o) releaseOverlayLock(); }}
          excludeTarget={{ kind: "work_item", id: workItemId }}
        />
      )}
      {showSnoozeDialog && (
        <SnoozeDialog
          workItemIds={isSelected && isMultiSelected ? useAppStore.getState().selectedWorkItemIds : [workItemId]}
          open
          onOpenChange={(o) => { setShowSnoozeDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
      {showDeadlineDialog && (
        <DeadlineDialog
          workItemIds={isSelected && isMultiSelected ? useAppStore.getState().selectedWorkItemIds : [workItemId]}
          open
          onOpenChange={(o) => { setShowDeadlineDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
      {showMobileAttributesSheet && (
        <MobileWorkItemAttributesSheet
          workItemId={workItemId}
          open
          onOpenChange={(o) => { setShowMobileAttributesSheet(o); if (!o) releaseOverlayLock(); }}
          onOpenTimeLog={() => setShowTimeLogDialog(true)}
          onOpenRespawn={() => setShowRespawnDialog(true)}
          onOpenHyperlinks={() => setShowHyperlinksDialog(true)}
          onOpenSnooze={() => setShowSnoozeDialog(true)}
          onScrambleName={() => void startScramble()}
          onRevealName={() => setScramblePrompt({ kind: "reveal", mode: "enter" })}
          onUnscrambleName={() => setScramblePrompt({ kind: "unscramble", mode: "enter" })}
          onOpenMove={openMoveToBacklogDialog}
          onOpenReparent={openMoveToParentDialog}
          onDuplicate={handleDuplicate}
        />
      )}
      {showMoveToParentDialog && (
        <MoveToParentDialog
          workItemIds={moveToParentItemIds}
          treeId={treeId}
          open
          onOpenChange={(o) => { setShowMoveToParentDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
      {showMoveToBacklogDialog && (
        <MoveToBacklogDialog
          workItemIds={moveToBacklogItemIds}
          treeId={treeId}
          currentBacklogId={backlogId}
          open
          onOpenChange={(o) => { setShowMoveToBacklogDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
    </>
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

function scrollWorkItemIntoView(itemId: string) {
  // Wait two animation frames so the parent virtualizer has measured and
  // positioned the (possibly newly added) row before we scroll to it.
  // Otherwise scrollIntoView can target the row's stale/estimated position.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-work-item-id="${CSS.escape(itemId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  });
}

/**
 * A single row in the search-results or label-filter-results list.
 * Supports drag-and-drop (drop onto a backlog in the left panel) and a full
 * right-click context menu that mirrors the one on regular work-item rows.
 */
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
}) {
  const setWorkItemStatus = useAppStore((s) => s.setWorkItemStatus);
  const moveWorkItemToBacklog = useAppStore((s) => s.moveWorkItemToBacklog);
  const deleteWorkItem = useAppStore((s) => s.deleteWorkItem);
  const guardedDelete = useDeleteWithTimeGuard();
  const removeWorkItemFromTree = useAppStore((s) => s.removeWorkItemFromTree);
  const backlogs = useAppStore((s) => s.backlogs);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const labelsVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.labelsEnabled ?? false);
  const timeLoggingVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.timeLoggingEnabled ?? false);
  const labelsMap = useLabelsStore((s) => s.labels);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const assignLabel = useLabelsStore((s) => s.assignLabel);
  const unassignLabel = useLabelsStore((s) => s.unassignLabel);
  const createLabel = useLabelsStore((s) => s.createLabel);
  const deleteLabel = useLabelsStore((s) => s.deleteLabel);
  const snoozeWorkItem = useSnoozeStore((s) => s.snoozeWorkItem);
  const unsnoozeWorkItem = useSnoozeStore((s) => s.unsnoozeWorkItem);
  const isSnoozed = useSnoozeStore((s) => s.isSnoozed(item.id));
  const isMobile = useIsMobile();
  const teams = useTeamStore((s) => s.teams);
  const workItemTeams = useTeamStore((s) => s.workItemTeams[item.id] ?? EMPTY_ARRAY);
  const assignTeam = useTeamStore((s) => s.assignTeamToWorkItem);
  const unassignTeam = useTeamStore((s) => s.unassignTeamFromWorkItem);

  const [showRespawnDialog, setShowRespawnDialog] = useState(false);
  const [showHyperlinksDialog, setShowHyperlinksDialog] = useState(false);
  const [showTimeLogDialog, setShowTimeLogDialog] = useState(false);
  const [showSnoozeDialog, setShowSnoozeDialog] = useState(false);
  const [showMoveToParentDialog, setShowMoveToParentDialog] = useState(false);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  // Inline new-label creation in context menu (SearchResultItem)
  const [srNewLabelForm, setSrNewLabelForm] = useState(false);
  const [srNewLabelName, setSrNewLabelName] = useState("");
  const [srNewLabelColor, setSrNewLabelColor] = useState("#6366f1");
  const [srLabelSearch, setSrLabelSearch] = useState("");
  const srNewLabelNameRef = useRef<HTMLInputElement>(null);
  const [srDeleteLabelId, setSrDeleteLabelId] = useState<string | null>(null);

  const itemTotalMinutesCached = useWorkItemTotalMinutes(item.id);
  const itemTotalMinutes = timeLoggingVisible ? itemTotalMinutesCached : 0;

  const orgLabels = useMemo(
    () =>
      Object.values(labelsMap)
        .filter((l) => l.organizationId === activeOrgId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [labelsMap, activeOrgId],
  );

  // All backlog IDs in this item's tree, for the "Move to backlog" sub-menu.
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
  useBacklogStatusesStore((s) => s.statusesByBacklog);
  const treeStatuses = useMemo(
    () =>
      getEffectiveStatusesForTree(treeId).map((s) => ({ key: s.key, label: s.label, color: s.color })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [treeId, useBacklogStatusesStore((s) => s.statusesByBacklog)],
  );

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
  const assignmentCount = Object.keys(item.backlogAssignments).length;

  const handleDeleteClick = useCallback(() => {
    if (assignmentCount > 1) setShowDeletePrompt(true);
    else guardedDelete({ kind: 'work_item', id: item.id }, item.title, () => deleteWorkItem(item.id));
  }, [assignmentCount, deleteWorkItem, item.id]);

  const handleQuickSnooze = useCallback(
    async (until: Date) => {
      if (!activeOrgId) return;
      await snoozeWorkItem({ workItemId: item.id, organizationId: activeOrgId, snoozedUntil: until });
    },
    [item.id, activeOrgId, snoozeWorkItem],
  );

  const handleDeleteChoice = (value: string) => {
    setShowDeletePrompt(false);
    if (value === "remove-from-backlog") removeWorkItemFromTree(item.id, treeId);
    else if (value === "delete-everywhere") guardedDelete({ kind: 'work_item', id: item.id }, item.title, () => deleteWorkItem(item.id));
  };

  return (
    <>
      <div ref={setNodeRef} style={isDragging ? { opacity: 0.4 } : undefined}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              {...attributes}
              {...restListeners}
              className={`flex items-start gap-2 px-3 py-1.5 text-left hover:bg-accent/60 transition-colors border-b border-border/30 last:border-b-0 group select-none${!isMobile ? " cursor-grab active:cursor-grabbing" : ""}`}
              title={timeLoggingVisible && itemTotalMinutes > 0 ? `${formatDuration(itemTotalMinutes)} logged` : undefined}
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
                className="text-[10px] tabular-nums text-muted-foreground/40 shrink-0 w-5 text-right mt-1 select-none"
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
                      aria-label="Snoozed — hidden in backlog view; click to reveal"
                    />
                  )}
                  {titleNode}
                </span>
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
          <ContextMenuContent className="w-52">
            <ContextMenuLabel className="text-xs truncate">{item.title}</ContextMenuLabel>
            <ContextMenuSeparator />
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-xs">
                <span
                  className="w-2 h-2 rounded-full mr-2 shrink-0 inline-block"
                  style={{ backgroundColor: treeStatuses.find((s) => s.key === item.status)?.color ?? "#94a3b8" }}
                />
                Status
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuRadioGroup
                  value={item.status}
                  onValueChange={(val) => setWorkItemStatus(item.id, val as WorkItemStatus)}
                >
                  {treeStatuses.map((s) => (
                    <ContextMenuRadioItem key={s.key} value={s.key} className="text-xs">
                      <span className="w-2 h-2 rounded-full mr-1 shrink-0 inline-block" style={{ backgroundColor: s.color }} />
                      {s.label}
                    </ContextMenuRadioItem>
                  ))}
                </ContextMenuRadioGroup>
              </ContextMenuSubContent>
            </ContextMenuSub>
            <ContextMenuItem className="text-xs" onSelect={() => setShowMoveToParentDialog(true)}>
              Reparent…
            </ContextMenuItem>
            {treeBacklogIds.length > 1 && (
              <ContextMenuSub>
                <ContextMenuSubTrigger className="text-xs">Move to backlog</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {treeBacklogIds
                    .filter((blId) => blId !== backlogId)
                    .map((blId) => (
                      <ContextMenuItem
                        key={blId}
                        className="text-xs"
                        onSelect={() => moveWorkItemToBacklog(item.id, blId, treeId)}
                      >
                        {isScrambled ? scrambleName(backlogs[blId]?.name ?? blId) : (backlogs[blId]?.name ?? blId)}
                      </ContextMenuItem>
                    ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            <ContextMenuSeparator />
            {labelsVisible && orgLabels.length > 0 && (
              <ContextMenuSub>
              <ContextMenuSubTrigger className="text-xs">Labels</ContextMenuSubTrigger>
                <ContextMenuSubContent
                  className="max-h-60 overflow-y-auto w-56 max-w-[calc(100vw-1.5rem)]"
                  collisionPadding={8}
                >
                  <div className="px-2 pt-1 pb-0.5">
                    <div className="flex items-center gap-1 rounded border border-input bg-background px-1.5 py-0.5">
                      <Search className="w-3 h-3 text-muted-foreground shrink-0" />
                      <input
                        className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
                        placeholder="Search labels…"
                        value={srLabelSearch}
                        onChange={(e) => setSrLabelSearch(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                      {srLabelSearch && (
                        <button className="text-muted-foreground hover:text-foreground" onClick={(e) => { e.stopPropagation(); setSrLabelSearch(""); }}>
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  {orgLabels
                    .filter((l) => !srLabelSearch.trim() || l.name.toLowerCase().includes(srLabelSearch.toLowerCase()))
                    .map((label) => {
                      const isAssigned = (byEntity[`work_item:${item.id}`] ?? []).includes(label.id);
                      return (
                        <ContextMenuCheckboxItem
                          key={label.id}
                          className="text-xs pr-1"
                          checked={isAssigned}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              assignLabel(label.id, "work_item", item.id, label.organizationId);
                            } else {
                              unassignLabel(label.id, "work_item", item.id);
                            }
                          }}
                        >
                          <span className="w-2 h-2 rounded-full mr-1 shrink-0 inline-block" style={{ backgroundColor: label.color }} />
                          <span className="flex-1 min-w-0 truncate">{label.name}</span>
                          <button
                            className="ml-1 shrink-0 p-1 -my-1 rounded text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10"
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSrDeleteLabelId(label.id); }}
                            title={`Delete label "${label.name}"`}
                            aria-label={`Delete label ${label.name}`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </ContextMenuCheckboxItem>
                      );
                    })}
                  <ContextMenuSeparator />
                  {srNewLabelForm ? (
                    <div className="px-2 py-1.5 space-y-1.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <input type="color" value={srNewLabelColor} onChange={(e) => setSrNewLabelColor(e.target.value)} className="w-5 h-5 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0" />
                        <input ref={srNewLabelNameRef} className="flex-1 text-xs bg-transparent border-b border-primary/40 outline-none px-1 py-0.5" placeholder="Label name…" value={srNewLabelName} onChange={(e) => setSrNewLabelName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { const hc = async () => { if (!activeOrgId || !srNewLabelName.trim()) return; const lbl = await createLabel(activeOrgId, srNewLabelName.trim(), srNewLabelColor); if (lbl) { assignLabel(lbl.id, "work_item", item.id, activeOrgId); } setSrNewLabelName(""); setSrNewLabelForm(false); }; hc(); } if (e.key === "Escape") { setSrNewLabelForm(false); setSrNewLabelName(""); } e.stopPropagation(); }} />
                        <button className="text-muted-foreground hover:text-foreground" onClick={() => { setSrNewLabelForm(false); setSrNewLabelName(""); }}><X className="w-3.5 h-3.5" /></button>
                      </div>
                      <button className="w-full text-xs text-center py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50" disabled={!srNewLabelName.trim()} onClick={async () => { if (!activeOrgId || !srNewLabelName.trim()) return; const lbl = await createLabel(activeOrgId, srNewLabelName.trim(), srNewLabelColor); if (lbl) { assignLabel(lbl.id, "work_item", item.id, activeOrgId); } setSrNewLabelName(""); setSrNewLabelForm(false); }}>Create</button>
                    </div>
                  ) : (
                    <ContextMenuItem className="text-xs" onSelect={(e) => { e.preventDefault(); setSrNewLabelForm(true); setSrLabelSearch(""); }}>
                      <Plus className="w-3 h-3 mr-2" /> New label
                    </ContextMenuItem>
                  )}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            {teams.length > 0 && (
              <ContextMenuSub>
                <ContextMenuSubTrigger className="text-xs">Assign teams</ContextMenuSubTrigger>
                <ContextMenuSubContent>
                  {teams.map((team) => {
                    const isAssigned = workItemTeams.includes(team.id);
                    return (
                      <ContextMenuItem
                        key={team.id}
                        className="text-xs"
                        onSelect={(e) => e.preventDefault()}
                        onClick={() => {
                          if (isAssigned) {
                            unassignTeam(item.id, team.id);
                          } else {
                            assignTeam(item.id, team.id, team.organization_id || activeOrgId!);
                          }
                        }}
                      >
                        <span
                          className="w-2.5 h-2.5 rounded-full mr-1 shrink-0 inline-block"
                          style={{
                            backgroundColor: isAssigned ? "hsl(var(--primary))" : "transparent",
                            border: isAssigned ? "none" : "1px solid hsl(var(--muted-foreground)/0.4)",
                          }}
                        />
                        {team.name}
                      </ContextMenuItem>
                    );
                  })}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}
            {timeLoggingVisible && (
              <ContextMenuItem className="text-xs" onSelect={() => setShowTimeLogDialog(true)}>
                Log time
              </ContextMenuItem>
            )}
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-xs">
                <BellOff className="w-3 h-3 mr-2" />
                Snooze
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionLaterToday())}>
                  <span className="flex-1">Later Today</span>
                  <span className="ml-4 text-muted-foreground text-[10px]">3h from now</span>
                </ContextMenuItem>
                <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionTomorrowMorning())}>
                  <span className="flex-1">Tomorrow Morning</span>
                  <span className="ml-4 text-muted-foreground text-[10px]">7:00 AM</span>
                </ContextMenuItem>
                <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionThisWeekend())}>
                  <span className="flex-1">This Weekend</span>
                  <span className="ml-4 text-muted-foreground text-[10px]">Sat 7:00 AM</span>
                </ContextMenuItem>
                <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionNextWeek())}>
                  <span className="flex-1">Next Week</span>
                  <span className="ml-4 text-muted-foreground text-[10px]">Mon 7:00 AM</span>
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem className="text-xs" onSelect={() => setShowSnoozeDialog(true)}>
                  Pick Date / Time…
                </ContextMenuItem>
              </ContextMenuSubContent>
            </ContextMenuSub>
            {isSnoozed && (
              <ContextMenuItem className="text-xs" onSelect={() => unsnoozeWorkItem(item.id)}>
                <Bell className="w-3 h-3 mr-2" />
                Unsnooze
              </ContextMenuItem>
            )}
            <ContextMenuItem className="text-xs" onSelect={() => setShowRespawnDialog(true)}>
              Respawn settings
            </ContextMenuItem>
            <ContextMenuItem className="text-xs" onSelect={() => setShowHyperlinksDialog(true)}>
              Hyperlinks
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-xs text-destructive focus:text-destructive"
              onSelect={handleDeleteClick}
            >
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </div>
      {srDeleteLabelId && (
        <ActionPrompt
          title={`Delete label "${labelsMap[srDeleteLabelId]?.name ?? srDeleteLabelId}"?`}
          options={[
            {
              label: "Delete",
              description: "Permanently delete this label from all items. This cannot be undone.",
              value: "confirm",
              variant: "destructive",
              isDefault: true,
            },
          ]}
          onSelect={() => { deleteLabel(srDeleteLabelId); setSrDeleteLabelId(null); }}
          onCancel={() => setSrDeleteLabelId(null)}
        />
      )}
      {showDeletePrompt && (
        <ActionPrompt
          title={`"${item.title}" is in ${assignmentCount} backlogs`}
          options={[
            {
              label: "Remove from this backlog",
              description: `Remove from "${backlogs[backlogId]?.name ?? backlogId}" only. Keeps it in other backlogs.`,
              value: "remove-from-backlog",
              isDefault: true,
            },
            {
              label: "Delete everywhere",
              description: "Permanently delete this item from all backlogs.",
              value: "delete-everywhere",
              variant: "destructive",
            },
          ]}
          onSelect={handleDeleteChoice}
          onCancel={() => setShowDeletePrompt(false)}
        />
      )}
      {showRespawnDialog && (
        <RespawnSettingsDialog
          workItemId={item.id}
          open
          onOpenChange={(o) => { setShowRespawnDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
      {showHyperlinksDialog && (
        <HyperlinksDialog
          workItemId={item.id}
          open
          onOpenChange={(o) => { setShowHyperlinksDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
      {showTimeLogDialog && timeLoggingVisible && (
        <TimeLogDialog
          workItemId={item.id}
          open
          onOpenChange={(o) => { setShowTimeLogDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
      {showSnoozeDialog && (
        <SnoozeDialog
          workItemIds={[item.id]}
          open
          onOpenChange={(o) => { setShowSnoozeDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
      {showMoveToParentDialog && (
        <MoveToParentDialog
          workItemIds={[item.id]}
          treeId={treeId}
          open
          onOpenChange={(o) => { setShowMoveToParentDialog(o); if (!o) releaseOverlayLock(); }}
        />
      )}
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
  const setViewMode = useCallback((m: "list" | "board") => {
    if (!selectedBacklogId) return;
    setBacklogViewMode(selectedBacklogId, m);
  }, [selectedBacklogId, setBacklogViewMode]);

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

  const searchResults = useMemo((): SearchResult[] | null => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 3) return null;

    const itemResults: SearchResultItem[] = Object.values(workItems)
      .filter((wi) => wi.title.toLowerCase().includes(q))
      .flatMap((wi) => {
        // Emit one result per backlog tree this item is assigned to,
        // so items present in multiple trees show all occurrences.
        const treeIds = Object.keys(wi.backlogAssignments);
        if (treeIds.length === 0) return [];

        return treeIds.map((treeId) => {
          const backlogId = wi.backlogAssignments[treeId];
          const tree = backlogTrees[treeId];
          const backlog = backlogId ? backlogs[backlogId] : null;

          // Build full backlog ancestry path from root backlog down to the item's backlog.
          const backlogPath: string[] = [];
          const visitedBacklogIds = new Set<string>();
          let bl = backlog;
          while (bl && !visitedBacklogIds.has(bl.id)) {
            visitedBacklogIds.add(bl.id);
            backlogPath.unshift(bl.name);
            bl = bl.parentId ? backlogs[bl.parentId] : null;
          }

          // Build work item ancestor chain using per-tree effective parent.
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
            kind: 'workitem' as const,
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
      .filter((r) => r.treeId)
      .sort((a, b) => {
        const t = a.item.title.localeCompare(b.item.title);
        if (t !== 0) return t;
        return a.treeName.localeCompare(b.treeName);
      });

    const backlogResults: SearchResultBacklog[] = Object.values(backlogs)
      .filter((bl) => bl.name.toLowerCase().includes(q))
      .map((bl) => {
        const tree = backlogTrees[bl.treeId];
        const backlogPath: string[] = [];
        const visitedBacklogIds = new Set<string>();
        let current = bl;
        while (current && !visitedBacklogIds.has(current.id)) {
          visitedBacklogIds.add(current.id);
          backlogPath.unshift(current.name);
          current = current.parentId ? backlogs[current.parentId] : null;
        }
        return {
          kind: 'backlog' as const,
          treeId: bl.treeId,
          backlogId: bl.id,
          treeName: tree?.name ?? '',
          backlogName: bl.name,
          backlogPath,
        };
      })
      .filter((r) => r.treeId)
      .sort((a, b) => {
        const t = a.backlogName.localeCompare(b.backlogName);
        if (t !== 0) return t;
        return a.treeName.localeCompare(b.treeName);
      });

    return [...itemResults, ...backlogResults];
  }, [searchQuery, workItems, backlogTrees, backlogs]);

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
  const [selectedTreeIsShared, setSelectedTreeIsShared] = useState(false);

  useEffect(() => {
    if (!selectedTreeId || !activeOrgId) {
      setSelectedTreeIsShared(false);
      return;
    }
    supabase
      .rpc("get_tree_sharing_info", {
        _tree_id: selectedTreeId,
        _exclude_org_id: activeOrgId,
      })
      .then(({ data, error }) => {
        if (error) {
          console.error("WorkItemTreePanel: failed to fetch tree sharing info", error);
          // Default to treating the tree as shared (not scrambled) on error, to avoid
          // accidentally exposing names when share status is unknown.
          setSelectedTreeIsShared(true);
          return;
        }
        setSelectedTreeIsShared(Array.isArray(data) && data.length > 0);
      });
  }, [selectedTreeId, activeOrgId]);

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
    return sortTopLevel(
      topLevelItems(workItems, selectedTreeId, backlogIdSet),
      listSortMode,
      selectedTreeId,
      currentListSortContext(selectedTreeId),
    );
  }, [workItems, selectedBacklogId, selectedTreeId, backlogIdSet, listSortMode, sortTeams, sortWorkItemTeams, sortStatusesByBacklog]);

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
    visibleWorkItemIdsRef.current = visibleItemIds;
  }, [visibleItemIds]);

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

  // Keyboard shortcuts: Tab = indent (make child of item above),
  // Shift+Tab = outdent (elevate to parent's level).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isInput) return;

      const state = useAppStore.getState();
      if (state.selectedWorkItemIds.length === 0) return;
      if (!state.selectedTreeId || !state.selectedBacklogIds[0]) return;

      const treeId = state.selectedTreeId;
      const backlogId = state.selectedBacklogIds[0];
      const currentIds = visibleItemIdsRef.current;
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
        const plans = orderedSelected
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
            // Place the outdented item right after its former parent.
            const parentRank = parent.ranks[targetBacklogId] ?? 0;
            const insertRank = parentRank + 1;
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
        // Indent: each selected item becomes a child of the nearest preceding
        // item that is NOT itself selected (preserves relative grouping).
        const plans: { id: string; parentId: string; targetBacklogId: string }[] = [];
        for (const id of topmostSelected) {
          const idx = currentIds.indexOf(id);
          let parentId: string | null = null;
          for (let i = idx - 1; i >= 0; i--) {
            // Skip other selected items
            if (selectedSet.has(currentIds[i])) continue;
            // Skip items that are descendants of any selected item (prevent cycles)
            const candidateId = currentIds[i];
            const candidate = state.workItems[candidateId];
            let isDescendant = false;
            if (candidate) {
              let cur: string | null = treeId ? getEffectiveParentId(candidate, treeId) : candidate.parentId;
              while (cur) {
                if (selectedSet.has(cur)) { isDescendant = true; break; }
                const curWi = state.workItems[cur];
                cur = treeId && curWi ? getEffectiveParentId(curWi, treeId) : curWi?.parentId ?? null;
              }
            }
            if (isDescendant) continue;
            {
              parentId = currentIds[i];
              break;
            }
          }
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

        if (multi) {
          rangeIds.forEach((rid) => selectWorkItem(rid, true));
        } else {
          clearWorkItemSelection();
          rangeIds.forEach((rid) => selectWorkItem(rid, true));
        }
      } else {
        selectWorkItem(id, multi);
        lastSelectedId.current = id;
      }
    },
    [visibleItemIds, selectWorkItem, clearWorkItemSelection],
  );

  const selectBacklog = useAppStore((s) => s.selectBacklog);
  const isSearchMode = searchQuery.trim().length >= 3;
  const isLabelFilterMode = filterLabelIds.size > 0;
  const isTeamFilterMode = filterTeamIds.size > 0;
  const isFilterMode = isLabelFilterMode || isTeamFilterMode;
  const filterResultsTitle =
    isLabelFilterMode && isTeamFilterMode
      ? "Filter results"
      : isTeamFilterMode
        ? "Team filter results"
        : "Label filter results";

  // Shared data computed once per panel render — avoids per-row store subscriptions.
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
  const sharedData: SharedData = {
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
  };

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
                } else if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
                e.stopPropagation();
              }}
            />
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
              <p className="text-sm">Select a backlog to view work items</p>
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
            {!isSearchMode && !isFilterMode && selectedBacklogId && boardsVisible && (
              <div className="flex items-center rounded-md border bg-muted/40 mr-1 overflow-hidden">
                <button
                  className={`flex items-center gap-1 h-7 px-2 text-xs font-medium transition-colors ${viewMode === "list" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={(e) => { e.stopPropagation(); setViewMode("list"); }}
                  title="List view"
                >
                  <ListIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">List</span>
                </button>
                <button
                  className={`flex items-center gap-1 h-7 px-2 text-xs font-medium transition-colors ${viewMode === "board" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                  onClick={(e) => { e.stopPropagation(); setViewMode("board"); }}
                  title="Board view (leaf items by status)"
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Board</span>
                </button>
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
                title={`Check the ${linkedItemsInBacklog.length} linked item${linkedItemsInBacklog.length !== 1 ? "s" : ""} in this backlog and mark the ads that have closed. Nothing is saved.`}
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
                title="Clear the closed-ad marks in this backlog"
                aria-label="Clear the closed-ad marks in this backlog"
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
                      {listSortModes(ratingsEnabled, deadlinesEnabledForSort).map(({ mode, label }) => (
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
                title="Log time for this backlog"
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
        <ContextMenuContent className="w-44">
          <ContextMenuLabel className="text-xs truncate">{isScrambled ? scrambleName(backlogs[selectedBacklogId!]?.name ?? "") : (backlogs[selectedBacklogId!]?.name ?? "")}</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-xs"
            onSelect={() => setShowBacklogAttributesSheet(true)}
          >
            <SlidersHorizontal className="w-3 h-3 mr-2" />
            Attributes
          </ContextMenuItem>
          <ContextMenuItem
            className="text-xs"
            onSelect={() => setShowBacklogStatusesDialog(true)}
          >
            <Settings2 className="w-3 h-3 mr-2" />
            Statuses…
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-xs text-destructive focus:text-destructive"
            onSelect={() => setShowBacklogDeleteConfirm(true)}
          >
            <Trash2 className="w-3 h-3 mr-2" />
            Delete backlog
          </ContextMenuItem>
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
        {!isSearchMode && !isFilterMode && boardsVisible && viewMode === "board" && selectedBacklogId && selectedTreeId ? (
          <BoardView backlogId={selectedBacklogId} treeId={selectedTreeId} addWorkItem={addWorkItem} setViewMode={setViewMode} />
        ) : isSearchMode ? (
          /* Search results list: flat list of matching items with tree/backlog context */
          <div className="flex-1 overflow-y-auto p-0 md:p-0.5" onClick={(e) => e.stopPropagation()}>
            {searchResults && searchResults.length > 0 ? (
              <div className="flex flex-col">
                {(() => {
                  // Compute query string once before mapping to avoid redundant string ops per item.
                  const q = searchQuery.trim().toLowerCase();
                  return searchResults.map((result, idx) => {
                    if (result.kind === 'backlog') {
                      const { treeId, backlogId, treeName, backlogName, backlogPath } = result;
                      const nameLower = backlogName.toLowerCase();
                      const matchIdx = nameLower.indexOf(q);
                      const titleNode =
                        matchIdx >= 0 ? (
                          <>
                            <IconizedTitle title={backlogName.slice(0, matchIdx)} />
                            <mark className="bg-primary/20 text-foreground rounded-sm px-0 not-italic">
                              {backlogName.slice(matchIdx, matchIdx + q.length)}
                            </mark>
                            <IconizedTitle title={backlogName.slice(matchIdx + q.length)} />
                          </>
                        ) : (
                          <IconizedTitle title={backlogName} />
                        );
                      return (
                        <div
                          key={`backlog-${backlogId}`}
                          className="flex items-start gap-2 px-3 py-1.5 text-left hover:bg-accent/60 transition-colors border-b border-border/30 last:border-b-0 cursor-pointer select-none"
                          onClick={(e) => {
                            e.stopPropagation();
                            selectBacklog(backlogId, treeId);
                            setSearchQuery("");
                          }}
                        >
                          <span
                            className="text-[10px] tabular-nums text-muted-foreground/40 shrink-0 w-5 text-right mt-1 select-none"
                            aria-hidden="true"
                          >
                            {idx + 1}
                          </span>
                          <span className="w-3 h-3 rounded-full shrink-0 mt-1 border border-background/50 bg-muted-foreground/40" />
                          <div className="min-w-0 flex-1">
                            <span className="text-sm leading-snug break-words">
                              {titleNode}
                              <span className="text-[10px] text-muted-foreground ml-1">(backlog)</span>
                            </span>
                            <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                              {isScrambled ? "···" : [treeName, ...backlogPath].join(" › ")}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    const { item, treeId, backlogId, treeName, backlogPath, workItemAncestors } = result;
                    const titleLower = item.title.toLowerCase();
                    const matchIdx = titleLower.indexOf(q);
                    const titleNode =
                      matchIdx >= 0 ? (
                        <>
                          <IconizedTitle title={item.title.slice(0, matchIdx)} />
                          <mark className="bg-primary/20 text-foreground rounded-sm px-0 not-italic">
                            {item.title.slice(matchIdx, matchIdx + q.length)}
                          </mark>
                          <IconizedTitle title={item.title.slice(matchIdx + q.length)} />
                        </>
                      ) : (
                        <IconizedTitle title={item.title} />
                      );
                    return (
                      <SearchResultItem
                        key={`${item.id}::${treeId}`}
                        item={item}
                        treeId={treeId}
                        backlogId={backlogId}
                        idx={idx}
                        titleNode={titleNode}
                        workItemAncestors={workItemAncestors}
                        treeName={treeName}
                        backlogPath={backlogPath}
                        isScrambled={isScrambled}
                        onNavigate={() => {
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
                        }}
                      />
                    );
                  });
                })()}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                No items match &ldquo;{searchQuery}&rdquo;
              </div>
            )}
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
                {workItemsLoading || workItemsRefreshing ? "Loading work items…" : "No work items in this backlog"}
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
            totalPoints={0}
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
            title="Delete backlog?"
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
              guardedDelete({ kind: 'backlog', id }, backlogs[id]?.name ?? 'this backlog', () => deleteBacklog(id));
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
