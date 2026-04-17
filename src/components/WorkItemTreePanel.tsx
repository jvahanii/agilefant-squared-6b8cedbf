import { useAppStore } from "@/store/appStore";
import { TeamAssignmentCell } from "./TeamAssignmentCell";
import { WORK_ITEM_STATUSES, WorkItemStatus } from "@/types/models";
import { ChevronRight, ChevronDown, GripVertical, FileText, Plus, Trash2, ClipboardPaste, Settings, RotateCcw, Link2, Clock, Tag, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useDraggable, useDroppable } from "@dnd-kit/core";

import { createContext, useContext, useMemo, useState, useRef, useEffect, useCallback } from "react";
import { ActionPrompt } from "./ActionPrompt";
import { RespawnSettingsDialog } from "./RespawnSettingsDialog";
import { HyperlinksDialog } from "./HyperlinksDialog";
import { TimeLogDialog, formatDuration } from "./TimeLogDialog";
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
import { useLabelsStore } from "@/store/labelsStore";
import { LabelPicker } from "./LabelPicker";

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
    <div className="flex items-start gap-1.5 px-3 py-1" style={{ paddingLeft: `${depth * 20 + 32}px` }}>
      <FileText className="w-3.5 h-3.5 text-primary/50 shrink-0 mt-1" />
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
  const itemLabels = useMemo(() => {
    if (!labelsVisible) return [];
    const labelIds = byEntity[`work_item:${workItemId}`] ?? [];
    return labelIds
      .map((id) => labelsMap[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [labelsVisible, byEntity, labelsMap, workItemId]);

  const [isAdding, setIsAdding] = useState(false);
  const [isAddingSibling, setIsAddingSibling] = useState(false);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [showRespawnDialog, setShowRespawnDialog] = useState(false);
  const [showHyperlinksDialog, setShowHyperlinksDialog] = useState(false);
  const [showTimeLogDialog, setShowTimeLogDialog] = useState(false);
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
    return () => {
      window.removeEventListener("shortcut:add-child-workitem", handleAddChild);
      window.removeEventListener("shortcut:add-sibling-workitem", handleAddSibling);
      window.removeEventListener("shortcut:delete-selected", handleDelete);
      window.removeEventListener("shortcut:edit-hyperlinks", handleEditHyperlinks);
      window.removeEventListener("shortcut:log-time", handleLogTime);
    };
  }, [expanded, handleDeleteClick, handleEditHyperlinks, handleLogTime, isSelected, toggleExpand, workItemId]);

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
    .map(([tid, blId]) => ({ treeId: tid, path: getBacklogPath(blId) }))
    .filter(({ path }) => path.length > 0);

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
        <div
          {...attributes}
          {...restListeners}
          data-work-item-id={workItemId}
          data-backlog-id={backlogId}
          data-tree-id={treeId}
          className={`
            flex items-start gap-1.5 px-3 py-0.5 md:py-1 rounded-md
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
            ) : (
              <FileText className={`w-3.5 h-3.5 ${isChildBacklog ? "text-muted-foreground/40" : "text-primary/50"}`} />
            )}
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="w-3 h-3 mt-1 rounded-full shrink-0 border border-background/50 transition-transform hover:scale-125"
                style={{
                  backgroundColor:
                    WORK_ITEM_STATUSES.find((s) => s.value === item.status)?.color ?? "var(--status-not-started)",
                }}
                onClick={(e) => e.stopPropagation()}
                title={WORK_ITEM_STATUSES.find((s) => s.value === item.status)?.label ?? "Not Started"}
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[140px]">
              {WORK_ITEM_STATUSES.map((s) => (
                <DropdownMenuItem
                  key={s.value}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isSelected && selectedWorkItemIds.length > 1) {
                      selectedWorkItemIds.forEach((id) => setWorkItemStatus(id, s.value));
                    } else {
                      setWorkItemStatus(workItemId, s.value);
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

          {backlogPaths.length > 0 && (
            <div className="hidden md:flex items-center gap-1.5 shrink-0 ml-auto mt-0.5">
              {backlogPaths.map(({ treeId: tid, path }) => (
                <div key={tid} className="flex items-center text-[10px] text-muted-foreground/70">
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
            {pointsVisible && (isEditingPoints ? (
              <input
                ref={pointsRef}
                className="w-10 text-xs text-center bg-transparent border-b border-primary/40 outline-none tabular-nums"
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
              (() => {
                const getEffectivePoints = (wi: any): number => {
                  const own = wi.points ?? 0;
                  const childrenSum = wi.childrenIds.reduce((sum: number, cid: string) => {
                    const child = workItems[cid];
                    return sum + (child ? getEffectivePoints(child) : 0);
                  }, 0);
                  return Math.max(own, childrenSum);
                };
                const totalPoints = getEffectivePoints(item);
                const directChildrenSum = item.childrenIds.reduce((sum, cid) => {
                  const child = workItems[cid];
                  return sum + (child ? getEffectivePoints(child) : 0);
                }, 0);
                const isRolledUp = directChildrenSum > 0 && directChildrenSum > (item.points ?? 0);
                return (
                  <span
                    className={`text-xs tabular-nums cursor-text shrink-0 min-w-[20px] text-center ${isRolledUp ? "text-primary font-medium" : "text-muted-foreground"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditingPoints();
                    }}
                    title={
                      isRolledUp
                        ? `Own: ${item.points ?? 0}, Rolled-up: ${directChildrenSum}`
                        : "Story points (click to edit)"
                    }
                  >
                    {totalPoints > 0 ? totalPoints : "–"}
                  </span>
                );
              })()
            ))}

            <div className="flex items-center gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shrink-0">
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
                <Settings className="w-3.5 h-3.5" />
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
                <LabelPicker entityType="work_item" entityId={workItemId}>
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
      className={`relative py-1`}
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
  const expandedWorkItems = useAppStore((s) => s.expandedWorkItems);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const bulkAddWorkItems = useAppStore((s) => s.bulkAddWorkItems);
  const toggleWorkItemExpand = useAppStore((s) => s.toggleWorkItemExpand);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  const clearWorkItemSelection = useAppStore((s) => s.clearWorkItemSelection);
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
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

  // Label filter state
  const labelsMap = useLabelsStore((s) => s.labels);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const orgLabels = useMemo(
    () =>
      Object.values(labelsMap)
        .filter((l) => l.organizationId === activeOrgId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [labelsMap, activeOrgId],
  );
  const [filterLabelIds, setFilterLabelIds] = useState<Set<string>>(new Set());

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

  // When filter is active, hide root items that have no matching descendant-or-self
  const displayedRootItems = useMemo(() => {
    if (!visibleFilterSet) return rootWorkItems;
    return rootWorkItems.filter((wi) => visibleFilterSet.has(wi.id));
  }, [rootWorkItems, visibleFilterSet]);

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

  if (!selectedBacklogId || !selectedTreeId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground">
        <div className="text-center">
          <FileText className="w-12 h-12 mx-auto mb-3 text-muted-foreground/30" />
          <p className="text-sm">Select a backlog to view work items</p>
        </div>
      </div>
    );
  }

  return (
    <LabelFilterContext.Provider value={visibleFilterSet}>
      <div
        className="h-full flex flex-col overflow-hidden"
        onClick={() => {
          clearWorkItemSelection();
          lastSelectedId.current = null;
        }}
      >
        <div className="p-1.5 pb-1 md:p-2 md:pb-1 border-b flex items-start justify-between shrink-0">
          <div className="min-w-0 flex-1">
            <EditableBacklogName backlogId={selectedBacklogId} isScrambled={isScrambled} />
            <p className="text-xs text-muted-foreground mt-0.5">
              {visibleFilterSet
                ? `${displayedRootItems.length} of ${rootWorkItems.length} item${rootWorkItems.length !== 1 ? "s" : ""} (filtered)`
                : `${rootWorkItems.length} item${rootWorkItems.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0 ml-2">
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
            {timeLoggingVisible && (
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
          </div>
        </div>

        {/* Label filter chip bar — only shown when labels are enabled and at least one label exists */}
        {labelsVisible && orgLabels.length > 0 && (
          <div className="px-2 py-1 flex flex-wrap gap-1 border-b shrink-0" onClick={(e) => e.stopPropagation()}>
            {orgLabels.map((label) => (
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

        <WorkItemRootDropZone treeId={selectedTreeId} backlogId={selectedBacklogId}>
          <div className="flex-1 overflow-y-auto p-1 md:p-2">
            {rootWorkItems.length === 0 && isAdding ? (
              <InlineWorkItemInput
                depth={0}
                onSubmit={(title) => {
                  addWorkItem(title, null, selectedBacklogId, selectedTreeId, 0);
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
                      addWorkItem(title, null, selectedBacklogId, selectedTreeId);
                    }}
                    onCancel={() => setIsAdding(false)}
                  />
                )}
                {displayedRootItems.map((item, index) => {
                  const itemBacklogId = item.backlogAssignments[selectedTreeId] ?? selectedBacklogId;
                  return (
                    <div key={item.id}>
                      <ReorderDropZone
                        id={`reorder-root-${index}`}
                        index={index}
                        treeId={selectedTreeId}
                        backlogIds={allBacklogIds}
                        parentId={null}
                        depth={0}
                      />
                      <WorkItemNode
                        workItemId={item.id}
                        depth={0}
                        treeId={selectedTreeId}
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
                  treeId={selectedTreeId}
                  backlogIds={allBacklogIds}
                  parentId={null}
                  depth={0}
                />
              </div>
            )}
          </div>
        </WorkItemRootDropZone>
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
