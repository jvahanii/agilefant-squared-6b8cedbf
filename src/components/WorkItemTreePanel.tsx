import { useAppStore } from "@/store/appStore";
import { TeamAssignmentCell } from "./TeamAssignmentCell";
import { WORK_ITEM_STATUSES, WorkItemStatus } from "@/types/models";
import { useTreeStatusesStore, DEFAULT_TREE_STATUSES } from "@/store/treeStatusesStore";
import { ChevronRight, ChevronDown, GripVertical, FileText, Plus, Trash2, ClipboardPaste, RotateCcw, Link2, Clock, Tag, X, SlidersHorizontal, BellOff, Bell } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import { createContext, useContext, useMemo, useState, useRef, useEffect, useCallback } from "react";
import { ActionPrompt } from "./ActionPrompt";
import { MoveToParentDialog } from "./MoveToParentDialog";
import { RespawnSettingsDialog } from "./RespawnSettingsDialog";
import { HyperlinksDialog } from "./HyperlinksDialog";
import { TimeLogDialog, formatDuration } from "./TimeLogDialog";
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
import { useLabelsStore, type Label } from "@/store/labelsStore";
import { LabelPicker } from "./LabelPicker";
import { MobileWorkItemAttributesSheet } from "./MobileAttributesSheet";
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
/**
 * When a label filter is active, this context holds the Set of work item IDs
 * that should be visible (matching items + their ancestors).  Null means "show
 * all" (no filter active).
 */
const LabelFilterContext = createContext<Set<string> | null>(null);

// Minimum pointer movement (in px) required before treating an interaction as a
// drag rather than a click.  Matches PointerSensor's activationConstraint.distance.
const DRAG_THRESHOLD_PX = 5;
const DRAG_THRESHOLD_PX_SQUARED = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;

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
    <div className="flex items-start gap-1.5 px-3 py-px" style={{ paddingLeft: `${depth * 20 + 32}px` }}>
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
  isChildBacklog?: boolean;
  isScrambled: boolean;
  onSelect: (id: string, multi: boolean, shift: boolean) => void;
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
  isChildBacklog,
  isScrambled,
  onSelect,
}: WorkItemNodeProps) {
  const item = useAppStore((s) => s.workItems[workItemId]);
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const expanded = useAppStore((s) => s.expandedWorkItems.has(workItemId));
  const isSelected = useAppStore((s) => s.selectedWorkItemIds.includes(workItemId));
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
  const toggleExpand = useAppStore((s) => s.toggleWorkItemExpand);
  const setWorkItemStatus = useAppStore((s) => s.setWorkItemStatus);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const deleteWorkItem = useAppStore((s) => s.deleteWorkItem);
  const removeWorkItemFromTree = useAppStore((s) => s.removeWorkItemFromTree);
  const renameWorkItem = useAppStore((s) => s.renameWorkItem);
  const setWorkItemPoints = useAppStore((s) => s.setWorkItemPoints);
  const selectBacklog = useAppStore((s) => s.selectBacklog);
  const isMobile = useIsMobile();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const orgSettings = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""] ?? { pointsEnabled: false, timeLoggingEnabled: false });
  const pointsVisible = orgSettings.pointsEnabled;
  const timeLoggingVisible = orgSettings.timeLoggingEnabled;
  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const itemTotalMinutes = useMemo(() => {
    if (!timeLoggingVisible) return 0;
    return Object.values(timeEntries)
      .filter((e) => e.workItemId === workItemId)
      .reduce((sum, e) => sum + e.durationMinutes, 0);
  }, [timeEntries, workItemId, timeLoggingVisible]);

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

  // Per-tree status definitions (falls back to defaults if not loaded yet).
  const treeStatusList = useTreeStatusesStore((s) => s.statusesByTree[treeId]);
  const treeStatuses = useMemo(
    () =>
      treeStatusList && treeStatusList.length > 0
        ? treeStatusList.map((s) => ({ key: s.key, label: s.label, color: s.color }))
        : DEFAULT_TREE_STATUSES.map((s) => ({ key: s.key, label: s.label, color: s.color })),
    [treeStatusList],
  );

  const [isAdding, setIsAdding] = useState(false);
  const [isAddingSibling, setIsAddingSibling] = useState(false);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [showRespawnDialog, setShowRespawnDialog] = useState(false);
  const [showHyperlinksDialog, setShowHyperlinksDialog] = useState(false);
  const [showTimeLogDialog, setShowTimeLogDialog] = useState(false);
  const [showSnoozeDialog, setShowSnoozeDialog] = useState(false);
  const [showMobileAttributesSheet, setShowMobileAttributesSheet] = useState(false);
  const [showMoveToParentDialog, setShowMoveToParentDialog] = useState(false);

  // Snooze store
  const snoozeWorkItem = useSnoozeStore((s) => s.snoozeWorkItem);
  const unsnoozeWorkItem = useSnoozeStore((s) => s.unsnoozeWorkItem);
  const isSnoozed = useSnoozeStore((s) => s.isSnoozed(workItemId));
  const activeSnooze = useSnoozeStore((s) => s.getActiveSnooze(workItemId));

  const handleQuickSnooze = useCallback(async (until: Date) => {
    if (!activeOrgId) return;
    await snoozeWorkItem({ workItemId, organizationId: activeOrgId, snoozedUntil: until });
  }, [workItemId, activeOrgId, snoozeWorkItem]);
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
    if (assignmentCount > 1) setShowDeletePrompt(true);
    else deleteWorkItem(workItemId);
  }, [assignmentCount, deleteWorkItem, item, workItemId]);

  const handleEditHyperlinks = useCallback(() => {
    if (useAppStore.getState().selectedWorkItemIds[0] !== workItemId) return;
    setShowHyperlinksDialog(true);
  }, [workItemId]);

  const handleLogTime = useCallback(() => {
    if (useAppStore.getState().selectedWorkItemIds[0] !== workItemId) return;
    setShowTimeLogDialog(true);
  }, [workItemId]);

  const handleMoveToParent = useCallback(() => {
    if (useAppStore.getState().selectedWorkItemIds[0] !== workItemId) return;
    setShowMoveToParentDialog(true);
  }, [workItemId]);

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
    const handleAddSibling = () => setIsAddingSibling(true);
    const handleDelete = () => handleDeleteClick();
    window.addEventListener("shortcut:add-child-workitem", handleAddChild);
    window.addEventListener("shortcut:add-sibling-workitem", handleAddSibling);
    window.addEventListener("shortcut:delete-selected", handleDelete);
    window.addEventListener("shortcut:edit-hyperlinks", handleEditHyperlinks);
    window.addEventListener("shortcut:log-time", handleLogTime);
    window.addEventListener("shortcut:move-to-parent", handleMoveToParent);
    return () => {
      window.removeEventListener("shortcut:add-child-workitem", handleAddChild);
      window.removeEventListener("shortcut:add-sibling-workitem", handleAddSibling);
      window.removeEventListener("shortcut:delete-selected", handleDelete);
      window.removeEventListener("shortcut:edit-hyperlinks", handleEditHyperlinks);
      window.removeEventListener("shortcut:log-time", handleLogTime);
      window.removeEventListener("shortcut:move-to-parent", handleMoveToParent);
    };
  }, [expanded, handleDeleteClick, handleEditHyperlinks, handleLogTime, handleMoveToParent, isSelected, toggleExpand, workItemId]);

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

  const hasChildren = item.childrenIds.length > 0;

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
    let cur = workItems[item.parentId];
    while (cur) {
      parentItemChain.unshift({ id: cur.id, title: cur.title });
      cur = cur.parentId ? workItems[cur.parentId] : undefined;
    }
  }

  const handleDeleteChoice = (value: string) => {
    setShowDeletePrompt(false);
    if (value === "remove-from-backlog") removeWorkItemFromTree(workItemId, treeId);
    else if (value === "delete-everywhere") deleteWorkItem(workItemId);
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
              selectedWorkItemIds.forEach((id) => setWorkItemStatus(id, newStatus));
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-3 h-3 mt-1 rounded-full shrink-0 border border-background/50 transition-transform hover:scale-125"
                style={{
                  backgroundColor:
                    treeStatuses.find((s) => s.key === item.status)?.color ?? treeStatuses[0]?.color ?? "#94a3b8",
                }}
                onClick={(e) => e.stopPropagation()}
                title={treeStatuses.find((s) => s.key === item.status)?.label ?? item.status}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[140px]">
              {treeStatuses.map((s) => (
                <DropdownMenuItem
                  key={s.key}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isSelected && selectedWorkItemIds.length > 1) {
                      selectedWorkItemIds.forEach((id) => setWorkItemStatus(id, s.key as WorkItemStatus));
                    } else {
                      setWorkItemStatus(workItemId, s.key as WorkItemStatus);
                    }
                  }}
                  className="flex items-center gap-2 text-xs"
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                  {s.label}
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
            </span>
          )}

          {labelsVisible && itemLabels.length > 0 && (
            <div className="flex items-center gap-0.5 shrink-0 mt-0.5 flex-wrap">
              {itemLabels.map((label) => (
                <TooltipProvider key={label.id}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                        style={{ backgroundColor: label.color }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs">{label.name}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
            </div>
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

          {backlogPaths.length > 0 && (
            <div className="hidden md:flex items-center gap-1.5 shrink-0 ml-auto mt-0.5">
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
            <div className="shrink-0">
              <TeamAssignmentCell workItemId={workItemId} />
            </div>
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

            {/* Mobile actions: Plus + rotor (attributes sheet) + Delete */}
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
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMobileAttributesSheet(true);
                }}
                title="Attributes"
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteClick();
                }}
              >
                <Trash2 className="w-3.5 h-3.5" />
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
                    selectedWorkItemIds.forEach((id) => setWorkItemStatus(id, val as WorkItemStatus));
                  } else {
                    setWorkItemStatus(workItemId, val as WorkItemStatus);
                  }
                }}
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
          <ContextMenuItem className="text-xs" onSelect={startEditingTitle}>
            Rename
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
          <ContextMenuItem
            className="text-xs"
            onSelect={() => setShowMoveToParentDialog(true)}
          >
            Move under parent…
          </ContextMenuItem>
          <ContextMenuSeparator />
          {labelsVisible && orgLabels.length > 0 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-xs">Labels</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {orgLabels.map((label) => (
                  <ContextMenuCheckboxItem
                    key={label.id}
                    className="text-xs"
                    checked={assignedIds.has(label.id)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        assignLabel(label.id, "work_item", workItemId, label.organizationId);
                      } else {
                        unassignLabel(label.id, "work_item", workItemId);
                      }
                    }}
                  >
                    <span className="w-2 h-2 rounded-full mr-1 shrink-0 inline-block" style={{ backgroundColor: label.color }} />
                    {label.name}
                  </ContextMenuCheckboxItem>
                ))}
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

                {[...item.childrenIds]
                  .map((id) => workItems[id])
                  .filter(Boolean)
                  .sort((a, b) => (a.ranks[a.backlogAssignments[treeId]] ?? 0) - (b.ranks[b.backlogAssignments[treeId]] ?? 0))
                  .map((child, index) => {
                    const childBacklogId = child.backlogAssignments[treeId] ?? backlogId;
                    return (
                      <div key={child.id}>
                        <ReorderDropZone
                          id={`reorder-${workItemId}-${index}`}
                          index={index}
                          treeId={treeId}
                          backlogIds={allBacklogIds}
                          parentId={workItemId}
                          depth={depth + 1}
                        />
                        <WorkItemNode
                          workItemId={child.id}
                          depth={depth + 1}
                          treeId={treeId}
                          backlogId={childBacklogId}
                          allBacklogIds={allBacklogIds}
                          isChildBacklog={isChildBacklog}
                          isScrambled={isScrambled}
                          onSelect={onSelect}
                        />
                      </div>
                    );
                  })}
                <ReorderDropZone
                  id={`reorder-${workItemId}-${item.childrenIds.length}`}
                  index={item.childrenIds.length}
                  treeId={treeId}
                  backlogIds={allBacklogIds}
                  parentId={workItemId}
                  depth={depth + 1}
                />
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
          title={`"${item.title}" is in ${assignmentCount} backlogs`}
          options={[
            {
              label: "Remove from this backlog",
              description: `Remove from "${backlogs[item.backlogAssignments[treeId]]?.name}" only. Keeps it in other backlogs.`,
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
        workItemId={workItemId}
        open={showRespawnDialog}
        onOpenChange={setShowRespawnDialog}
      />
      <HyperlinksDialog
        workItemId={workItemId}
        open={showHyperlinksDialog}
        onOpenChange={setShowHyperlinksDialog}
      />
      {timeLoggingVisible && (
        <TimeLogDialog
          workItemId={workItemId}
          open={showTimeLogDialog}
          onOpenChange={setShowTimeLogDialog}
        />
      )}
      <SnoozeDialog
        workItemId={workItemId}
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
      />
      <MoveToParentDialog
        workItemIds={isSelected && selectedWorkItemIds.length > 1 ? selectedWorkItemIds : [workItemId]}
        open={showMoveToParentDialog}
        onOpenChange={setShowMoveToParentDialog}
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
}: {
  id: string;
  index: number;
  treeId: string;
  backlogIds: string[];
  parentId: string | null;
  depth: number;
}) {
  const isMobile = useIsMobile();
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "workitem-reorder", index, treeId, backlogIds, parentId },
  });

  return (
    <div
      ref={setNodeRef}
      className={`relative py-px`}
      style={{ marginLeft: `${depth * 20 + 12}px` }}
    >
      <div className={`rounded-full transition-all ${isOver ? "h-1 bg-selection" : ""}`} />
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
  const toggleWorkItemExpand = useAppStore((s) => s.toggleWorkItemExpand);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  const clearWorkItemSelection = useAppStore((s) => s.clearWorkItemSelection);
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const setSearchQuery = useAppStore((s) => s.setSearchQuery);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const timeLoggingVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.timeLoggingEnabled ?? false);
  const labelsVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.labelsEnabled ?? false);
  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const backlogTotalMinutes = useMemo(() => {
    if (!timeLoggingVisible || !selectedBacklogId) return 0;
    return Object.values(timeEntries)
      .filter((e) => e.backlogId === selectedBacklogId && e.workItemId === null)
      .reduce((sum, e) => sum + e.durationMinutes, 0);
  }, [timeEntries, selectedBacklogId, timeLoggingVisible]);
  const [showBacklogTimeLogDialog, setShowBacklogTimeLogDialog] = useState(false);

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

  // Label filter state
  const labelsMap = useLabelsStore((s) => s.labels);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const [filterLabelIds, setFilterLabelIds] = useState<Set<string>>(new Set());

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

  // Search results: items from ALL trees matching the search query, with tree/backlog context.
  // Returns null when no query is active (normal view mode).
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;

    return Object.values(workItems)
      .filter((wi) => wi.title.toLowerCase().includes(q))
      .map((wi) => {
        // Pick the first tree assignment to provide context labels.
        const treeIds = Object.keys(wi.backlogAssignments);
        const treeId = treeIds[0] ?? null;
        const backlogId = treeId ? wi.backlogAssignments[treeId] : null;
        const tree = treeId ? backlogTrees[treeId] : null;
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

        // Build work item ancestor chain from root ancestor down to the direct parent.
        const workItemAncestors: string[] = [];
        const visitedWorkItemIds = new Set<string>();
        let parent = wi.parentId ? workItems[wi.parentId] : null;
        while (parent && !visitedWorkItemIds.has(parent.id)) {
          visitedWorkItemIds.add(parent.id);
          workItemAncestors.unshift(parent.title);
          parent = parent.parentId ? workItems[parent.parentId] : null;
        }

        return {
          item: wi,
          treeId: treeId ?? "",
          backlogId: backlogId ?? "",
          treeName: tree?.name ?? "",
          backlogName: backlog?.name ?? "",
          backlogPath,
          workItemAncestors,
        };
      })
      .filter((r) => r.treeId)
      .sort((a, b) => a.item.title.localeCompare(b.item.title));
  }, [searchQuery, workItems, backlogTrees, backlogs]);

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

  // Labels used by work items that belong to the selected backlog (and its children).
  // Only these labels are shown in the filter chip bar.
  const backlogLabels = useMemo(() => {
    if (!selectedTreeId || backlogIdSet.size === 0) return [];
    const labelIdSet = new Set<string>();
    for (const wi of Object.values(workItems)) {
      if (!backlogIdSet.has(wi.backlogAssignments[selectedTreeId])) continue;
      const ids = byEntity[`work_item:${wi.id}`];
      if (ids) ids.forEach((id) => labelIdSet.add(id));
    }
    return Array.from(labelIdSet)
      .map((id) => labelsMap[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name)) as Label[];
  }, [workItems, selectedTreeId, backlogIdSet, byEntity, labelsMap]);

  const rootWorkItems = useMemo(() => {
    if (!selectedBacklogId || !selectedTreeId || backlogIdSet.size === 0) return [];
    return Object.values(workItems)
      .filter(
        (wi) =>
          backlogIdSet.has(wi.backlogAssignments[selectedTreeId]) &&
          (wi.parentId === null || !backlogIdSet.has(workItems[wi.parentId ?? ""]?.backlogAssignments[selectedTreeId])),
      )
      .sort((a, b) => (a.ranks[a.backlogAssignments[selectedTreeId]] ?? 0) - (b.ranks[b.backlogAssignments[selectedTreeId]] ?? 0));
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
            .filter(Boolean)
            .sort((a, b) => (a.ranks[a.backlogAssignments[selectedTreeId]] ?? 0) - (b.ranks[b.backlogAssignments[selectedTreeId]] ?? 0))
            .forEach((child) => traverse(child.id));
        }
      }
    };
    displayedRootItems.forEach((root) => traverse(root.id));
    return ids;
  }, [displayedRootItems, expandedWorkItems, workItems, selectedTreeId]);

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
  const isSearchMode = searchQuery.trim().length > 0;

  if (!isSearchMode && (!selectedBacklogId || !selectedTreeId)) {
    return (
      <div className="h-full flex flex-col overflow-hidden">
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center">
            <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm">Select a backlog to view work items</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    // In search mode, pass null so all WorkItemNodes in the (hidden) normal view are unfiltered.
    // Null already means "no filter active" per the LabelFilterContext contract (line 57).
    <LabelFilterContext.Provider value={isSearchMode ? null : visibleFilterSet}>
      <div
        className="h-full flex flex-col overflow-hidden"
        onClick={() => {
          clearWorkItemSelection();
          lastSelectedId.current = null;
        }}
      >
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
                <EditableBacklogName backlogId={selectedBacklogId!} isScrambled={isScrambled} />
                <p className="text-xs text-foreground mt-0.5">
                  {visibleFilterSet
                    ? `${displayedRootItems.length} of ${rootWorkItems.length} item${rootWorkItems.length !== 1 ? "s" : ""} (filtered)`
                    : `${rootWorkItems.length} item${rootWorkItems.length !== 1 ? "s" : ""}`}
                </p>
              </>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
            {!isSearchMode && snoozedInBacklog.length > 0 && (
              <button
                className="flex items-center gap-1 w-auto h-7 px-1.5 rounded-md text-amber-500/80 hover:text-amber-500 hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  unsnoozeAll(snoozedInBacklog);
                }}
                title={`${snoozedInBacklog.length} snoozed item${snoozedInBacklog.length !== 1 ? "s" : ""} \u2014 click to unsnooze all`}
              >
                <BellOff className="w-4 h-4" />
                <span className="text-xs font-medium tabular-nums">{snoozedInBacklog.length}</span>
              </button>
            )}
            {!isSearchMode && (
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
            {!isSearchMode && timeLoggingVisible && (
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
            {!isSearchMode && (
              <button
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsAdding(true);
                }}
                title="Add work item (Enter)"
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Label filter chip bar — only shown in normal mode when labels are enabled and this backlog has labeled items */}
        {!isSearchMode && labelsVisible && backlogLabels.length > 0 && (
          <div className="px-2 py-0.5 flex flex-wrap gap-1 border-b shrink-0" onClick={(e) => e.stopPropagation()}>
            {backlogLabels.map((label) => (
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

        {isSearchMode ? (
          /* Search results list: flat list of matching items with tree/backlog context */
          <div className="flex-1 overflow-y-auto p-0 md:p-0.5" onClick={(e) => e.stopPropagation()}>
            {searchResults && searchResults.length > 0 ? (
              <div className="flex flex-col">
                {(() => {
                  // Compute query string once before mapping to avoid redundant string ops per item.
                  const q = searchQuery.trim().toLowerCase();
                  return searchResults.map(({ item, treeId, backlogId, treeName, backlogPath, workItemAncestors }) => {
                    const statusColor =
                      DEFAULT_TREE_STATUSES.find((s) => s.key === item.status)?.color ?? "#94a3b8";
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
                      <button
                        key={item.id}
                        className="flex items-start gap-2 px-3 py-1.5 text-left hover:bg-accent/60 transition-colors border-b border-border/30 last:border-b-0 group"
                        onClick={() => {
                          // Expand ancestor backlogs and work items so the item is visible
                          useAppStore.setState((state) => {
                            // Expand ancestor backlogs in the left panel
                            const expandedBacklogs = new Set(state.expandedBacklogs);
                            let bl = state.backlogs[backlogId];
                            while (bl?.parentId) {
                              expandedBacklogs.add(bl.parentId);
                              bl = state.backlogs[bl.parentId];
                            }
                            // Expand ancestor work items in the right panel
                            const expandedWorkItems = new Set(state.expandedWorkItems);
                            let wi = state.workItems[item.id];
                            while (wi?.parentId) {
                              expandedWorkItems.add(wi.parentId);
                              wi = state.workItems[wi.parentId];
                            }
                            return { expandedBacklogs, expandedWorkItems };
                          });
                          selectBacklog(backlogId, treeId);
                          setSearchQuery("");
                          // Small delay lets the backlog panel re-render with the new selection
                          // before we try to highlight the work item row.
                          setTimeout(() => selectWorkItem(item.id, false), 50);
                        }}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0 mt-1 border border-background/50"
                          style={{ backgroundColor: statusColor }}
                          title={item.status}
                        />
                         <div className="min-w-0 flex-1">
                          <span className="text-sm leading-snug break-words">{titleNode}</span>
                          {workItemAncestors.length > 0 && (
                            <p className="text-[10px] text-muted-foreground/70 mt-0 truncate">
                              {isScrambled ? "···" : workItemAncestors.join(" › ")}
                            </p>
                          )}
                          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                            {isScrambled
                              ? "···"
                              : [treeName, ...backlogPath].join(" › ")}
                          </p>
                        </div>
                      </button>
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
                      />
                      <WorkItemNode
                        workItemId={item.id}
                        depth={0}
                        treeId={selectedTreeId!}
                        backlogId={itemBacklogId}
                        allBacklogIds={allBacklogIds}
                        isChildBacklog={itemBacklogId !== selectedBacklogId}
                        isScrambled={isScrambled}
                        onSelect={handleSelect}
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
                />
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
      </div>
    </LabelFilterContext.Provider>
  );
}
