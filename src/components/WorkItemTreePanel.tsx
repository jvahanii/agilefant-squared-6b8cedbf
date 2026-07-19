import { useAppStore } from "@/store/appStore";
import { useTeamStore } from "@/store/teamStore";
import { WorkItem, WORK_ITEM_STATUSES, WorkItemStatus, getEffectiveParentId } from "@/types/models";
import { useBacklogStatusesStore, DEFAULT_STATUSES, getEffectiveStatuses, getEffectiveStatusesForTree } from "@/store/backlogStatusesStore";
import { ChevronRight, ChevronDown, GripVertical, FileText, Plus, Trash2, ClipboardPaste, RotateCcw, Link2, Clock, Tag, X, SlidersHorizontal, BellOff, Bell, Search, ArrowDownAZ, FolderInput, List as ListIcon, LayoutGrid, Settings2 } from "lucide-react";
import { BoardView } from "./BoardView";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useDraggable, useDroppable, useDndContext } from "@dnd-kit/core";

import { createContext, useContext, useMemo, useState, useRef, useEffect, useCallback } from "react";
import { ActionPrompt } from "./ActionPrompt";
import { MoveToParentDialog } from "./MoveToParentDialog";
import { MoveToBacklogDialog } from "./MoveToBacklogDialog";
import { RespawnSettingsDialog } from "./RespawnSettingsDialog";
import { HyperlinksDialog } from "./HyperlinksDialog";
import { TimeLogDialog, formatDuration } from "./TimeLogDialog";
import { FinancialsDialog } from "./FinancialsDialog";
import { FinancialTotalsBadge } from "./FinancialTotalsBadge";
import { useWorkItemFinancialTotals } from "@/hooks/useFinancialTotals";
import { isSavingsIncomeEnabled } from "@/store/orgSettingsStore";
import { SnoozeDialog } from "./SnoozeDialog";
import { useTimeEntryStore } from "@/store/timeEntryStore";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { supabase } from "@/integrations/supabase/client";
import { useScramble } from "@/contexts/ScrambleContext";
import { scrambleName } from "@/lib/scramble";
import { computeBacklogTotalMinutes, computeWorkItemTotalMinutes } from "@/lib/timeUtils";
import { useLabelsStore, type Label } from "@/store/labelsStore";
import { LabelPicker } from "./LabelPicker";
import { MobileWorkItemAttributesSheet, MobileBacklogAttributesSheet } from "./MobileAttributesSheet";
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

// Minimum pointer movement (in px) required before treating an interaction as a
// drag rather than a click.  Matches PointerSensor's activationConstraint.distance.
const DRAG_THRESHOLD_PX = 8;
const DRAG_THRESHOLD_PX_SQUARED = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
const EMPTY_ARRAY: string[] = [];

function EditableBacklogName({ backlogId, isScrambled }: { backlogId: string; isScrambled: boolean }) {
  const backlog = useAppStore((s) => s.backlogs[backlogId]);
  const renameBacklog = useAppStore((s) => s.renameBacklog);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

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
      {isScrambled ? scrambleName(backlog.name) : backlog.name}
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

function WorkItemNode(props: WorkItemNodeProps) {
  const labelFilter = useContext(LabelFilterContext);
  const isSnoozed = useSnoozeStore((s) => s.isSnoozed(props.workItemId));
  if (isSnoozed) return null;
  if (labelFilter !== null && !labelFilter.has(props.workItemId)) return null;
  return <WorkItemNodeContent {...props} />;
}

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
  const item = useAppStore((s) => s.workItems[workItemId]);
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const expanded = useAppStore((s) => s.expandedWorkItems.has(workItemId));
  const isSelected = useAppStore((s) => s.selectedWorkItemIds.includes(workItemId));
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
  const toggleExpand = useAppStore((s) => s.toggleWorkItemExpand);
  const setWorkItemStatus = useAppStore((s) => s.setWorkItemStatus);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const deleteWorkItemsBulk = useAppStore((s) => s.deleteWorkItemsBulk);
  const duplicateWorkItems = useAppStore((s) => s.duplicateWorkItems);
  const removeWorkItemsFromTreeBulk = useAppStore((s) => s.removeWorkItemsFromTreeBulk);
  const moveWorkItemToBacklog = useAppStore((s) => s.moveWorkItemToBacklog);
  const reorderWorkItemAmongSiblings = useAppStore((s) => s.reorderWorkItemAmongSiblings);
  const sortChildrenAlphabetically = useAppStore((s) => s.sortChildrenAlphabetically);
  const renameWorkItem = useAppStore((s) => s.renameWorkItem);
  const setWorkItemPoints = useAppStore((s) => s.setWorkItemPoints);
  const selectBacklog = useAppStore((s) => s.selectBacklog);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  const isMobile = useIsMobile();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const pointsVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.pointsEnabled ?? false);
  const timeLoggingVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.timeLoggingEnabled ?? false);
  const savingsIncomeVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.savingsIncomeEnabled ?? false);
  const itemFinancials = useWorkItemFinancialTotals(workItemId);
  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const itemTotalMinutes = useMemo(() => {
    if (!timeLoggingVisible) return 0;
    return computeWorkItemTotalMinutes(workItemId, workItems, timeEntries);
  }, [timeEntries, workItemId, workItems, timeLoggingVisible]);

  // Labels
  const labelsVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.labelsEnabled ?? false);
  const labelsMap = useLabelsStore((s) => s.labels);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const assignLabel = useLabelsStore((s) => s.assignLabel);
  const unassignLabel = useLabelsStore((s) => s.unassignLabel);
  const itemLabels = useMemo(() => {
    if (!labelsVisible) return [];
    const labelIds = byEntity[`work_item:${workItemId}`] ?? [];
    return labelIds
      .map((id) => labelsMap[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [labelsVisible, byEntity, labelsMap, workItemId]);
  const orgLabels = useMemo(
    () =>
      Object.values(labelsMap)
        .filter((l) => l.organizationId === activeOrgId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [labelsMap, activeOrgId],
  );
  const assignedIds = useMemo(
    () => new Set(byEntity[`work_item:${workItemId}`] ?? []),
    [byEntity, workItemId],
  );

  // Teams
  const teams = useTeamStore((s) => s.teams);
  const workItemTeams = useTeamStore((s) => s.workItemTeams[workItemId] ?? EMPTY_ARRAY);
  const assignTeam = useTeamStore((s) => s.assignTeamToWorkItem);
  const unassignTeam = useTeamStore((s) => s.unassignTeamFromWorkItem);

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
  const [showRespawnDialog, setShowRespawnDialog] = useState(false);
  const [showHyperlinksDialog, setShowHyperlinksDialog] = useState(false);
  const [showTimeLogDialog, setShowTimeLogDialog] = useState(false);
  const [showSnoozeDialog, setShowSnoozeDialog] = useState(false);
  const [showFinancialsDialog, setShowFinancialsDialog] = useState(false);
  const [showMobileAttributesSheet, setShowMobileAttributesSheet] = useState(false);
  const [showMoveToParentDialog, setShowMoveToParentDialog] = useState(false);
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
    const ids = isSelected && selectedWorkItemIds.length > 1 ? selectedWorkItemIds : [workItemId];
    try {
      await Promise.all(
        ids.map((id) => snoozeWorkItem({ workItemId: id, organizationId: activeOrgId, snoozedUntil: until })),
      );
    } catch (err) {
      console.error('Failed to snooze one or more items', err);
    }
  }, [workItemId, activeOrgId, snoozeWorkItem, isSelected, selectedWorkItemIds]);
  const hyperlinkCount = useAppStore((s) => (s.hyperlinks[workItemId] ?? []).length);
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
      deleteWorkItemsBulk(idsToProcess);
    }
  }, [deleteWorkItemsBulk, isSelected, item, workItemId]);

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
      selectedIds: isSelected && selectedWorkItemIds.length > 1 ? selectedWorkItemIds : [workItemId],
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
      titleRef.current.focus();
      titleRef.current.select();
      titleRef.current.style.height = "auto";
      titleRef.current.style.height = `${titleRef.current.scrollHeight}px`;
    }
  }, [isEditingTitle]);

  useEffect(() => {
    if (isEditingPoints) {
      pointsRef.current?.focus();
      pointsRef.current?.select();
    }
  }, [isEditingPoints]);

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
    window.addEventListener("shortcut:add-child-workitem", handleAddChild);
    window.addEventListener("shortcut:add-sibling-workitem", handleAddSibling);
    window.addEventListener("shortcut:delete-selected", handleDelete);
    window.addEventListener("shortcut:duplicate-selected", handleDuplicate);
    window.addEventListener("shortcut:edit-hyperlinks", handleEditHyperlinks);
    window.addEventListener("shortcut:log-time", handleLogTime);
    window.addEventListener("shortcut:move-to-parent", handleMoveToParent);
    window.addEventListener("shortcut:move-to-backlog", handleMoveToBacklog);
    return () => {
      window.removeEventListener("shortcut:add-child-workitem", handleAddChild);
      window.removeEventListener("shortcut:add-sibling-workitem", handleAddSibling);
      window.removeEventListener("shortcut:delete-selected", handleDelete);
      window.removeEventListener("shortcut:duplicate-selected", handleDuplicate);
      window.removeEventListener("shortcut:edit-hyperlinks", handleEditHyperlinks);
      window.removeEventListener("shortcut:log-time", handleLogTime);
      window.removeEventListener("shortcut:move-to-parent", handleMoveToParent);
      window.removeEventListener("shortcut:move-to-backlog", handleMoveToBacklog);
    };
  }, [expanded, handleDeleteClick, handleEditHyperlinks, handleLogTime, handleMoveToBacklog, handleMoveToParent, isSelected, toggleExpand, workItemId]);

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

  // On mount, if this is the first selected item, scroll it into view so
  // the previously-selected item is visible after restore (especially on mobile
  // where the panel mounts fresh after a tab switch).
  useEffect(() => {
    if (selectedWorkItemIds.length > 0 && selectedWorkItemIds[0] === workItemId && nodeRef.current) {
      nodeRef.current.scrollIntoView({ block: "nearest" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-expand a collapsed branch when a drag is held over it for a short time.
  useEffect(() => {
    if (!isOver || isDragging || !item || item.childrenIds.length === 0 || expanded) return;
    const timer = setTimeout(() => {
      toggleExpand(workItemId);
    }, 600);
    return () => clearTimeout(timer);
  }, [isOver, isDragging, item, expanded, toggleExpand, workItemId]);

  if (!item) return null;

  const visibleBacklogSet = new Set(allBacklogIds);
  const hasChildren = item.childrenIds.some((id) => {
    const child = workItems[id];
    if (!child) return false;
    if (getEffectiveParentId(child, treeId) !== workItemId) return false;
    const childBl = child.backlogAssignments[treeId];
    return !!childBl && visibleBacklogSet.has(childBl);
  });

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

  const parentItemChain: { id: string; title: string }[] = [];
  if (depth === 0 && item.parentId) {
    const visited = new Set<string>();
    let cur = workItems[item.parentId];
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      parentItemChain.unshift({ id: cur.id, title: cur.title });
      cur = cur.parentId ? workItems[cur.parentId] : undefined;
    }
  }

  const handleDeleteChoice = (value: string) => {
    setShowDeletePrompt(false);
    if (value === "remove-from-backlog") removeWorkItemsFromTreeBulk(deleteItemIds.map((id) => ({ workItemId: id, treeId })));
    else if (value === "delete-everywhere") deleteWorkItemsBulk(deleteItemIds);
  };

  const startEditingTitle = () => {
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
    setWorkItemPoints(workItemId, isNaN(num) || num <= 0 ? undefined : num);
    setIsEditingPoints(false);
  };

  return (
    <>
      <div
        ref={combinedRef}
        style={isDragging ? { opacity: 0.4 } : undefined}
        className="animate-fade-in-up"
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
            if (isSelected && selectedWorkItemIds.length > 1) {
              useAppStore.getState().runBulk(() => {
                selectedWorkItemIds.forEach((id) => setWorkItemStatus(id, newStatus));
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
              <button
                className="w-3 h-3 mt-1 rounded-full shrink-0 border border-background/50 transition-transform hover:scale-125"
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
                    if (isSelected && selectedWorkItemIds.length > 1) {
                      useAppStore.getState().runBulk(() => {
                        selectedWorkItemIds.forEach((id) => setWorkItemStatus(id, s.key as WorkItemStatus));
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
                {isScrambled ? scrambleName(item.title) : item.title}
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

          {parentItemChain.length > 0 && (
            <div className="hidden md:flex items-center shrink-0 mt-0.5 text-[10px] text-muted-foreground/70 max-w-[200px]">
              {parentItemChain.map((ancestor, i) => (
                <span key={ancestor.id} className="flex items-center min-w-0">
                  {i > 0 && <ChevronRight className="w-2.5 h-2.5 mx-0.5 opacity-40 shrink-0" />}
                  <span className="truncate">{isScrambled ? scrambleName(ancestor.title) : ancestor.title}</span>
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
                    {/* Mobile: read-only points display (edit via attributes sheet) — only shown when there are actual points */}
                    {totalPoints > 0 && (
                      <span
                        className={`md:hidden text-xs tabular-nums shrink-0 min-w-[20px] text-center ${isRolledUp ? "text-primary font-medium" : "text-muted-foreground"}`}
                        title={isRolledUp ? `Own: ${item.points ?? 0}, Rolled-up: ${directChildrenSum}` : "Story points"}
                      >
                        {pointsLabel}
                      </span>
                    )}
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
                  entityIds={isSelected && selectedWorkItemIds.length > 1 ? selectedWorkItemIds : undefined}
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
                {item.childrenIds.length}
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
                  if (isSelected && selectedWorkItemIds.length > 1) {
                    useAppStore.getState().runBulk(() => {
                      selectedWorkItemIds.forEach((id) => setWorkItemStatus(id, val as WorkItemStatus));
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
              reorderWorkItemAmongSiblings(workItemId, 0, treeId, backlogIds);
              toast({ title: "Moved item to top", description: item.title });
            }}
          >
            Move to top
          </ContextMenuItem>
          <ContextMenuItem className="text-xs" onSelect={startEditingTitle}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem className="text-xs" onSelect={handleDuplicate}>
            Duplicate
            <span className="ml-auto text-[10px] text-muted-foreground">⌘D</span>
          </ContextMenuItem>
          {pointsVisible && (
            <ContextMenuItem className="text-xs" onSelect={startEditingPoints}>
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
                        const ids = isSelected && selectedWorkItemIds.length > 1 ? selectedWorkItemIds : [workItemId];
                        if (ids.length > 1) {
                          useAppStore.getState().runBulk(() => {
                            ids.forEach((id) => moveWorkItemToBacklog(id, blId, treeId));
                          });
                        } else {
                          ids.forEach((id) => moveWorkItemToBacklog(id, blId, treeId));
                        }
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
              <ContextMenuSubContent>
                {orgLabels.map((label) => {
                  const contextIds = isSelected && selectedWorkItemIds.length > 1 ? selectedWorkItemIds : [workItemId];
                  const assignedCount = contextIds.filter((id) => (byEntity[`work_item:${id}`] ?? []).includes(label.id)).length;
                  const fullyAssigned = assignedCount === contextIds.length;
                  const partiallyAssigned = assignedCount > 0 && !fullyAssigned;
                  return (
                    <ContextMenuCheckboxItem
                      key={label.id}
                      className="text-xs"
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
                      {label.name}
                      {partiallyAssigned && <span className="ml-auto text-[10px] text-muted-foreground">({assignedCount}/{contextIds.length})</span>}
                    </ContextMenuCheckboxItem>
                  );
                })}
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
                    <ContextMenuCheckboxItem
                      key={team.id}
                      className="text-xs"
                      checked={isAssigned}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          assignTeam(workItemId, team.id, team.organization_id || activeOrgId!);
                        } else {
                          unassignTeam(workItemId, team.id);
                        }
                      }}
                    >
                      {team.name}
                    </ContextMenuCheckboxItem>
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
        {(expanded || isAdding) && (
          <div className="relative">
            {expanded && hasChildren && (
              <>
                <div className="absolute tree-line" style={{ left: `${depth * 20 + 24}px`, top: 0, bottom: 0 }} />

                {(() => {
                  const visibleBacklogSet = new Set(allBacklogIds);
                  const sortedChildren = [...item.childrenIds]
                    .map((id) => workItems[id])
                    .filter((child): child is WorkItem => {
                      if (!child) return false;
                      if (getEffectiveParentId(child, treeId) !== workItemId) return false;
                      // Only render children that are actually assigned to a
                      // backlog visible in this tree/backlog view. Prevents
                      // stale/legacy siblings (assigned to a different tree, or
                      // to a deleted backlog) from visually leaking into the
                      // parent's backlog.
                      const childBl = child.backlogAssignments[treeId];
                      return !!childBl && visibleBacklogSet.has(childBl);
                    })
                    .sort((a, b) => (a.ranks[a.backlogAssignments[treeId]] ?? 0) - (b.ranks[b.backlogAssignments[treeId]] ?? 0));
                  const isMultiBacklog = allBacklogIds.length > 1;
                  return (
                    <>
                      {isAdding && (
                        <InlineWorkItemInput
                          depth={depth + 1}
                          onSubmit={(title) => {
                            addWorkItem(title, workItemId, backlogId, treeId);
                            setIsAdding(false);
                            setTimeout(() => {
                              window.dispatchEvent(new CustomEvent("shortcut:add-sibling-workitem"));
                            }, 50);
                          }}
                          onCancel={() => setIsAdding(false)}
                        />
                      )}
                      {sortedChildren.map((child, index) => {
                        const childBacklogId = child.backlogAssignments[treeId];
                        return (
                          <div key={child.id}>
                            <ReorderDropZone
                              id={`reorder-${workItemId}-${index}`}
                              index={index}
                              treeId={treeId}
                              backlogIds={allBacklogIds}
                              parentId={workItemId}
                              depth={depth + 1}
                              targetBacklogId={isMultiBacklog ? childBacklogId : undefined}
                            />
                            <WorkItemNode
                              workItemId={child.id}
                              depth={depth + 1}
                              treeId={treeId}
                              backlogId={childBacklogId}
                              allBacklogIds={allBacklogIds}
                              selectedBacklogId={selectedBacklogId}
                              parentBacklogId={backlogId}
                              isScrambled={isScrambled}
                              onSelect={onSelect}
                              setViewMode={setViewMode}
                            />
                          </div>
                        );
                      })}
                      <ReorderDropZone
                        id={`reorder-${workItemId}-${sortedChildren.length}`}
                        index={sortedChildren.length}
                        treeId={treeId}
                        backlogIds={allBacklogIds}
                        parentId={workItemId}
                        depth={depth + 1}
                        targetBacklogId={isMultiBacklog ? (sortedChildren[sortedChildren.length - 1]?.backlogAssignments[treeId] ?? backlogId) : undefined}
                      />
                    </>
                  );
                })()}
              </>
            )}
            {isAdding && !hasChildren && (
              <InlineWorkItemInput
                depth={depth + 1}
                onSubmit={(title) => {
                  addWorkItem(title, workItemId, backlogId, treeId, 0);
                  setIsAdding(false);
                  setTimeout(() => {
                    window.dispatchEvent(new CustomEvent("shortcut:add-sibling-workitem"));
                  }, 50);
                }}
                onCancel={() => setIsAdding(false)}
              />
            )}
          </div>
        )}
      </div>
      {isAddingSibling && (
        <InlineWorkItemInput
          depth={depth}
          onSubmit={(title) => {
            addWorkItem(title, item.parentId, backlogId, treeId, (item.ranks[backlogId] ?? 0) + 1);
            setIsAddingSibling(false);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent("shortcut:add-sibling-workitem"));
            }, 50);
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
      <RespawnSettingsDialog
        workItemId={workItemId}
        open={showRespawnDialog}
        onOpenChange={setShowRespawnDialog}
      />
      <HyperlinksDialog
        workItemId={workItemId}
        open={showHyperlinksDialog}
        onOpenChange={setShowHyperlinksDialog}
      />
      {isSavingsIncomeEnabled(activeOrgId) && (
        <FinancialsDialog
          workItemId={workItemId}
          open={showFinancialsDialog}
          onOpenChange={setShowFinancialsDialog}
        />
      )}
      {timeLoggingVisible && (
        <TimeLogDialog
          workItemId={workItemId}
          open={showTimeLogDialog}
          onOpenChange={setShowTimeLogDialog}
        />
      )}
      <SnoozeDialog
        workItemIds={isSelected && selectedWorkItemIds.length > 1 ? selectedWorkItemIds : [workItemId]}
        open={showSnoozeDialog}
        onOpenChange={setShowSnoozeDialog}
      />
      <MobileWorkItemAttributesSheet
        workItemId={workItemId}
        open={showMobileAttributesSheet}
        onOpenChange={setShowMobileAttributesSheet}
        onOpenTimeLog={() => setShowTimeLogDialog(true)}
        onOpenRespawn={() => setShowRespawnDialog(true)}
        onOpenHyperlinks={() => setShowHyperlinksDialog(true)}
        onOpenSnooze={() => setShowSnoozeDialog(true)}
        onOpenMove={openMoveToBacklogDialog}
        onOpenReparent={openMoveToParentDialog}
        onDuplicate={handleDuplicate}
      />
      <MoveToParentDialog
        workItemIds={moveToParentItemIds}
        open={showMoveToParentDialog}
        onOpenChange={setShowMoveToParentDialog}
      />
      <MoveToBacklogDialog
        workItemIds={moveToBacklogItemIds}
        treeId={treeId}
        currentBacklogId={backlogId}
        open={showMoveToBacklogDialog}
        onOpenChange={setShowMoveToBacklogDialog}
      />
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
  requestAnimationFrame(() => {
    document
      .querySelector(`[data-work-item-id="${CSS.escape(itemId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
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
  const removeWorkItemFromTree = useAppStore((s) => s.removeWorkItemFromTree);
  const backlogs = useAppStore((s) => s.backlogs);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const labelsVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.labelsEnabled ?? false);
  const timeLoggingVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.timeLoggingEnabled ?? false);
  const labelsMap = useLabelsStore((s) => s.labels);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const assignLabel = useLabelsStore((s) => s.assignLabel);
  const unassignLabel = useLabelsStore((s) => s.unassignLabel);
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

  const workItemsSearch = useAppStore((s) => s.workItems);
  const timeEntriesSearch = useTimeEntryStore((s) => s.timeEntries);
  const itemTotalMinutes = useMemo(() => {
    if (!timeLoggingVisible) return 0;
    return computeWorkItemTotalMinutes(item.id, workItemsSearch, timeEntriesSearch);
  }, [timeEntriesSearch, item.id, workItemsSearch, timeLoggingVisible]);

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
    else deleteWorkItem(item.id);
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
    else if (value === "delete-everywhere") deleteWorkItem(item.id);
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
                <ContextMenuSubContent>
                  {orgLabels.map((label) => {
                    const isAssigned = (byEntity[`work_item:${item.id}`] ?? []).includes(label.id);
                    return (
                      <ContextMenuCheckboxItem
                        key={label.id}
                        className="text-xs"
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
                        {label.name}
                      </ContextMenuCheckboxItem>
                    );
                  })}
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
                      <ContextMenuCheckboxItem
                        key={team.id}
                        className="text-xs"
                        checked={isAssigned}
                        onCheckedChange={(checked) => {
                          if (checked) {
                            assignTeam(item.id, team.id, team.organization_id || activeOrgId!);
                          } else {
                            unassignTeam(item.id, team.id);
                          }
                        }}
                      >
                        {team.name}
                      </ContextMenuCheckboxItem>
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
      <RespawnSettingsDialog
        workItemId={item.id}
        open={showRespawnDialog}
        onOpenChange={setShowRespawnDialog}
      />
      <HyperlinksDialog
        workItemId={item.id}
        open={showHyperlinksDialog}
        onOpenChange={setShowHyperlinksDialog}
      />
      {timeLoggingVisible && (
        <TimeLogDialog
          workItemId={item.id}
          open={showTimeLogDialog}
          onOpenChange={setShowTimeLogDialog}
        />
      )}
      <SnoozeDialog
        workItemIds={[item.id]}
        open={showSnoozeDialog}
        onOpenChange={setShowSnoozeDialog}
      />
      <MoveToParentDialog
        workItemIds={[item.id]}
        open={showMoveToParentDialog}
        onOpenChange={setShowMoveToParentDialog}
      />
    </>
  );
}

export function WorkItemTreePanel() {
  const selectedBacklogIds = useAppStore((s) => s.selectedBacklogIds);
  const selectedBacklogId = selectedBacklogIds[0] ?? null;
  const selectedTreeId = useAppStore((s) => s.selectedTreeId);
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const expandedWorkItems = useAppStore((s) => s.expandedWorkItems);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const bulkAddWorkItems = useAppStore((s) => s.bulkAddWorkItems);
  const sortChildrenAlphabetically = useAppStore((s) => s.sortChildrenAlphabetically);
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
  const [showSortRootPrompt, setShowSortRootPrompt] = useState(false);
  const [showBacklogAttributesSheet, setShowBacklogAttributesSheet] = useState(false);
  const [showBacklogStatusesDialog, setShowBacklogStatusesDialog] = useState(false);
  const [showBacklogDeleteConfirm, setShowBacklogDeleteConfirm] = useState(false);
  const deleteBacklog = useAppStore((s) => s.deleteBacklog);

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
  const [filterLabelIds, setFilterLabelIds] = useState<Set<string>>(new Set());
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

  // Clear filter when switching backlogs
  useEffect(() => {
    setFilterLabelIds(new Set());
  }, [selectedBacklogId]);

  // Compute the set of item IDs that should remain visible when a filter is active.
  // Includes all items that directly have a filter label, plus all their ancestors
  // (so the path to a matching item is preserved in the tree).
  const visibleFilterSet = useMemo<Set<string> | null>(() => {
    if (filterLabelIds.size === 0) return null;

    const matching = new Set<string>();
    for (const [key, labelIds] of Object.entries(byEntity)) {
      if (!key.startsWith("work_item:")) continue;
      if (labelIds.some((id) => filterLabelIds.has(id))) {
        matching.add(key.slice("work_item:".length));
      }
    }

    // Add ancestors up to the root so the tree path remains navigable
    const visible = new Set(matching);
    for (const itemId of matching) {
      let curr = workItems[itemId];
      while (curr?.parentId) {
        visible.add(curr.parentId);
        curr = workItems[curr.parentId];
      }
    }
    return visible;
  }, [filterLabelIds, byEntity, workItems]);

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
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 3) return null;

    return Object.values(workItems)
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
  }, [searchQuery, workItems, backlogTrees, backlogs]);

  // Label search results: items from ALL trees that have one of the active filter labels.
  // Returns null when no label filter is active (normal view mode).
  const labelSearchResults = useMemo(() => {
    if (filterLabelIds.size === 0) return null;

    const matchingItemIds = new Set<string>();
    for (const [key, labelIds] of Object.entries(byEntity)) {
      if (!key.startsWith("work_item:")) continue;
      if (labelIds.some((id) => filterLabelIds.has(id))) {
        matchingItemIds.add(key.slice("work_item:".length));
      }
    }

    return Array.from(matchingItemIds)
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
  }, [filterLabelIds, byEntity, workItems, backlogTrees, backlogs]);

  // Scramble support: check whether the currently selected tree is shared with any org.
  // If it is shared, names in it are NOT scrambled even when scramble is enabled.
  const { scrambleEnabled } = useScramble();
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

  // All labels defined in the active organisation, shown in the filter chip bar.
  const allOrgLabels = useMemo(
    () =>
      Object.values(labelsMap)
        .filter((l) => l.organizationId === activeOrgId)
        .sort((a, b) => a.name.localeCompare(b.name)) as Label[],
    [labelsMap, activeOrgId],
  );

  const rootWorkItems = useMemo(() => {
    if (!selectedBacklogId || !selectedTreeId || backlogIdSet.size === 0) return [];
    return Object.values(workItems)
      .filter(
        (wi) => {
          if (!backlogIdSet.has(wi.backlogAssignments[selectedTreeId])) return false;
          const effectiveParentId = getEffectiveParentId(wi, selectedTreeId);
          return effectiveParentId === null || !backlogIdSet.has(workItems[effectiveParentId ?? ""]?.backlogAssignments[selectedTreeId]);
        },
      )
      .sort((a, b) => {
        const rankDiff = (a.ranks[a.backlogAssignments[selectedTreeId]] ?? 0) - (b.ranks[b.backlogAssignments[selectedTreeId]] ?? 0);
        return rankDiff !== 0 ? rankDiff : a.id.localeCompare(b.id);
      });
  }, [workItems, selectedBacklogId, selectedTreeId, backlogIdSet]);

  // When filter is active, hide root items that have no matching descendant-or-self.
  // Also hide root items that are currently snoozed by the current user.
  const displayedRootItems = useMemo(() => {
    let items = rootWorkItems;
    if (visibleFilterSet) items = items.filter((wi) => visibleFilterSet.has(wi.id));
    return items.filter((wi) => !snoozedItemIds.has(wi.id));
  }, [rootWorkItems, visibleFilterSet, snoozedItemIds]);

  const visibleItemIds = useMemo(() => {
    const ids: string[] = [];
    const traverse = (workItemId: string) => {
      ids.push(workItemId);
      if (expandedWorkItems.has(workItemId)) {
        const item = workItems[workItemId];
        if (item && selectedTreeId) {
          [...item.childrenIds]
            .map((cid) => workItems[cid])
            .filter((child): child is WorkItem => {
              if (!child) return false;
              const childBl = child.backlogAssignments[selectedTreeId];
              return !!childBl && backlogIdSet.has(childBl);
            })
            .sort((a, b) => (a.ranks[a.backlogAssignments[selectedTreeId]] ?? 0) - (b.ranks[b.backlogAssignments[selectedTreeId]] ?? 0))
            .forEach((child) => traverse(child.id));
        }
      }
    };
    displayedRootItems.forEach((root) => traverse(root.id));
    return ids;
  }, [displayedRootItems, expandedWorkItems, workItems, selectedTreeId, backlogIdSet]);

  // Keep a ref to the latest visible list so the Tab/Shift-Tab handler always
  // operates on the current order without requiring the effect to re-register.
  const visibleItemIdsRef = useRef<string[]>(visibleItemIds);
  useEffect(() => {
    visibleItemIdsRef.current = visibleItemIds;
    visibleWorkItemIdsRef.current = visibleItemIds;
  }, [visibleItemIds]);

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
    const traverse = (workItemId: string) => {
      const item = workItems[workItemId];
      if (!item) return;
      if (snoozedItemIds.has(workItemId)) return;
      if (visibleFilterSet !== null && !visibleFilterSet.has(workItemId)) return;
      map.set(workItemId, counter++);
      if (expandedWorkItems.has(workItemId) && selectedTreeId) {
        [...item.childrenIds]
          .map((cid) => workItems[cid])
          .filter(Boolean)
          .sort((a, b) => (a.ranks[a.backlogAssignments[selectedTreeId]] ?? 0) - (b.ranks[b.backlogAssignments[selectedTreeId]] ?? 0))
          .forEach((child) => traverse(child.id));
      }
    };
    displayedRootItems.forEach((root) => traverse(root.id));
    return map;
  }, [displayedRootItems, expandedWorkItems, workItems, selectedTreeId, snoozedItemIds, visibleFilterSet]);

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

  return (
    // In search/label-filter mode the normal tree is replaced by a flat results list,
    // so pass null (no tree-level filtering) to avoid hiding nodes in the hidden tree.
    // Null already means "no filter active" per the LabelFilterContext contract (line 57).
    <LabelFilterContext.Provider value={isSearchMode || isLabelFilterMode ? null : visibleFilterSet}>
    <RunningNumberContext.Provider value={isSearchMode || isLabelFilterMode ? null : runningNumbers}>
      <div
        className="h-full flex flex-col overflow-hidden"
        onClick={() => {
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
                  (e.target as HTMLInputElement).blur();
                } else if (e.key === "Enter") {
                  (e.target as HTMLInputElement).blur();
                }
                e.stopPropagation();
              }}
            />
            {(searchQuery || filterLabelIds.size > 0) && (
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => { setSearchQuery(""); setFilterLabelIds(new Set()); }}
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
        </div>

        {!isSearchMode && !isLabelFilterMode && (!selectedBacklogId || !selectedTreeId) ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground">
            <div className="text-center">
              <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
              <p className="text-sm">Select a backlog to view work items</p>
            </div>
          </div>
        ) : (
        <>
        {!isSearchMode && !isLabelFilterMode && selectedBacklogId ? (
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
            ) : isLabelFilterMode ? (
              <>
                <h2 className="text-base font-semibold">Label filter results</h2>
                <p className="text-xs text-foreground mt-0.5">
                  {labelSearchResults?.length ?? 0} item{labelSearchResults?.length !== 1 ? "s" : ""} found
                </p>
              </>
            ) : (
              <>
                <EditableBacklogName backlogId={selectedBacklogId!} isScrambled={isScrambled} />
                <p className="text-xs text-foreground mt-0.5">
                  {`${rootWorkItems.length} item${rootWorkItems.length !== 1 ? "s" : ""}`}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {!isSearchMode && !isLabelFilterMode && selectedBacklogId && boardsVisible && (
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
            {!isSearchMode && !isLabelFilterMode && snoozedInBacklog.length > 0 && (
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
            {!isSearchMode && !isLabelFilterMode && (
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
            {!isSearchMode && !isLabelFilterMode && rootWorkItems.length > 1 && (
              <button
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!selectedBacklogId || !selectedTreeId) return;
                  setShowSortRootPrompt(true);
                }}
                title="Sort root items A→Z"
              >
                <ArrowDownAZ className="w-4 h-4" />
              </button>
            )}
            {!isSearchMode && !isLabelFilterMode && timeLoggingVisible && (
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
            {!isSearchMode && !isLabelFilterMode && (
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
                  <h2 className="text-base font-semibold">Label filter results</h2>
                  <p className="text-xs text-foreground mt-0.5">
                    {labelSearchResults?.length ?? 0} item{labelSearchResults?.length !== 1 ? "s" : ""} found
                  </p>
                </>
              )}
            </div>
          </div>
        )}
        {!isSearchMode && !isLabelFilterMode && boardsVisible && viewMode === "board" && selectedBacklogId && selectedTreeId ? (
          <BoardView backlogId={selectedBacklogId} treeId={selectedTreeId} addWorkItem={addWorkItem} setViewMode={setViewMode} />
        ) : isSearchMode ? (
          /* Search results list: flat list of matching items with tree/backlog context */
          <div className="flex-1 overflow-y-auto p-0 md:p-0.5" onClick={(e) => e.stopPropagation()}>
            {searchResults && searchResults.length > 0 ? (
              <div className="flex flex-col">
                {(() => {
                  // Compute query string once before mapping to avoid redundant string ops per item.
                  const q = searchQuery.trim().toLowerCase();
                  return searchResults.map(({ item, treeId, backlogId, treeName, backlogPath, workItemAncestors }, idx) => {
                    const titleLower = item.title.toLowerCase();
                    const matchIdx = titleLower.indexOf(q);
                    const titleNode =
                      matchIdx >= 0 ? (
                        <>
                          {item.title.slice(0, matchIdx)}
                          <mark className="bg-primary/20 text-foreground rounded-sm px-0 not-italic">
                            {item.title.slice(matchIdx, matchIdx + q.length)}
                          </mark>
                          {item.title.slice(matchIdx + q.length)}
                        </>
                      ) : (
                        item.title
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
                            scrollWorkItemIntoView(item.id);
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
        ) : isLabelFilterMode ? (
          /* Label filter results list: flat list of items with matching labels across all backlogs */
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
                    titleNode={item.title}
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
                      setTimeout(() => {
                        selectWorkItem(item.id, false);
                        scrollWorkItemIntoView(item.id);
                      }, 50);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                No items match the selected label{filterLabelIds.size !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        ) : (
          <WorkItemRootDropZone treeId={selectedTreeId!} backlogId={selectedBacklogId!}>
          <div className="flex-1 overflow-y-auto p-0 md:p-0.5">
            {rootWorkItems.length === 0 && isAdding ? (
              <InlineWorkItemInput
                depth={0}
                onSubmit={(title) => {
                  addWorkItem(title, null, selectedBacklogId!, selectedTreeId!, 0);
                }}
                onCancel={() => setIsAdding(false)}
              />
            ) : rootWorkItems.length === 0 && !isAdding ? (
              <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                No work items in this backlog
              </div>
            ) : (
              <div className="flex flex-col">
                {isAdding && (
                  <InlineWorkItemInput
                    depth={0}
                    onSubmit={(title) => {
                      addWorkItem(title, null, selectedBacklogId!, selectedTreeId!);
                    }}
                    onCancel={() => setIsAdding(false)}
                  />
                )}
                {(() => {
                  const isMultiBacklog = allBacklogIds.length > 1;
                  return (
                    <>
                      {displayedRootItems.map((item, index) => {
                        const itemBacklogId = item.backlogAssignments[selectedTreeId!] ?? selectedBacklogId!;
                        return (
                          <div key={item.id}>
                            <ReorderDropZone
                              id={`reorder-root-${index}`}
                              index={index}
                              treeId={selectedTreeId!}
                              backlogIds={allBacklogIds}
                              parentId={null}
                              depth={0}
                              targetBacklogId={isMultiBacklog ? itemBacklogId : undefined}
                            />
                            <WorkItemNode
                              workItemId={item.id}
                              depth={0}
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
                      <ReorderDropZone
                        id={`reorder-root-${displayedRootItems.length}`}
                        index={displayedRootItems.length}
                        treeId={selectedTreeId!}
                        backlogIds={allBacklogIds}
                        parentId={null}
                        depth={0}
                        targetBacklogId={isMultiBacklog ? (displayedRootItems[displayedRootItems.length - 1]?.backlogAssignments[selectedTreeId!] ?? selectedBacklogId!) : undefined}
                      />
                    </>
                  );
                })()}
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
        {showSortRootPrompt && (
          <ActionPrompt
            title="Sort root items A→Z?"
            options={[
              {
                label: "Sort A→Z",
                description: "Sorts root items alphabetically. You can undo with Ctrl+Z.",
                value: "confirm",
                isDefault: true,
              },
            ]}
            onSelect={() => {
              if (selectedTreeId) {
                sortChildrenAlphabetically(null, selectedTreeId, allBacklogIds);
                toast({ title: "Root items sorted A→Z", description: "Press Ctrl+Z to undo" });
              }
              setShowSortRootPrompt(false);
            }}
            onCancel={() => setShowSortRootPrompt(false)}
          />
        )}
        {showBacklogAttributesSheet && selectedBacklogId && (
          <MobileBacklogAttributesSheet
            backlogId={selectedBacklogId}
            totalPoints={0}
            open={showBacklogAttributesSheet}
            onOpenChange={setShowBacklogAttributesSheet}
            onOpenTimeLog={() => setShowBacklogTimeLogDialog(true)}
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
              deleteBacklog(selectedBacklogId);
              setShowBacklogDeleteConfirm(false);
            }}
            onCancel={() => setShowBacklogDeleteConfirm(false)}
          />
        )}
        </>
        )}
      </div>
    </RunningNumberContext.Provider>
    </LabelFilterContext.Provider>
  );
}
