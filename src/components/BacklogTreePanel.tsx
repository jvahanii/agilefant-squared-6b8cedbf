import { useAppStore } from "@/store/appStore";
import { ChevronRight, ChevronDown, FolderKanban, Plus, Trash2, GripVertical, Share2, Users, Clock, Tag } from "lucide-react";
import { useDroppable, useDraggable } from "@dnd-kit/core";
import { useIsMobile } from "@/hooks/use-mobile";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { ShareTreeDialog } from "./ShareTreeDialog";
import { supabase } from "@/integrations/supabase/client";
import { useOrgStore } from "@/store/orgStore";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useTimeEntryStore } from "@/store/timeEntryStore";
import { TimeLogDialog, formatDuration } from "./TimeLogDialog";
import { useScramble } from "@/contexts/ScrambleContext";
import { scrambleName } from "@/lib/scramble";
import { useLabelsStore } from "@/store/labelsStore";
import { isLabelsEnabled } from "@/hooks/useLabelsEnabled";
import { LabelPicker } from "./LabelPicker";

const INDENT_PER_LEVEL = 12;
const BASE_INDENT = 8;
const BASE_INDENT_INLINE = 24;

interface TreeShare {
  orgId: string;
  orgName: string;
}

function useTreeShares(treeIds: string[]) {
  const [shares, setShares] = useState<Record<string, TreeShare[]>>({});
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const treeIdsKey = treeIds.join(",");

  useEffect(() => {
    if (treeIds.length === 0 || !activeOrgId) return;

    const load = async () => {
      // Use security definer function to get sharing info for each tree
      const result: Record<string, TreeShare[]> = {};

      const results = await Promise.all(
        treeIds.map((treeId) =>
          supabase.rpc("get_tree_sharing_info", {
            _tree_id: treeId,
            _exclude_org_id: activeOrgId,
          }).then((res) => ({ treeId, data: res.data, error: res.error }))
        )
      );

      for (const { treeId, data, error } of results) {
        if (error || !data || data.length === 0) continue;
        result[treeId] = (data as any[]).map((row: any) => ({
          orgId: row.org_id,
          orgName: row.org_name,
        }));
      }

      setShares(result);
    };

    load();

    // Subscribe to realtime changes on the shares table so the icon
    // updates immediately for all parties (both when a share is added and removed).
    const channel = supabase
      .channel(`tree-shares-${activeOrgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "backlog_tree_shares" },
        () => { load(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeIdsKey, activeOrgId]);

  return shares;
}

interface BacklogNodeProps {
  backlogId: string;
  depth: number;
  index: number;
  parentId: string | null;
  treeId: string;
  isScrambled: boolean;
}

function InlineInput({
  onSubmit,
  onCancel,
  depth,
}: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
  depth: number;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
    else onCancel();
  };

  return (
    <div className="flex items-center gap-1 px-2 py-0.5" style={{ paddingLeft: `${depth * INDENT_PER_LEVEL + BASE_INDENT_INLINE}px` }}>
      <FolderKanban className="w-4 h-4 shrink-0 text-primary/70" />
      <input
        ref={inputRef}
        className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-1 py-0.5 placeholder:text-muted-foreground/50"
        placeholder="Name…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit();
          if (e.key === "Escape") onCancel();
        }}
        onBlur={handleSubmit}
      />
    </div>
  );
}

function BacklogReorderDropZone({
  id,
  index,
  parentId,
  treeId,
  depth,
}: {
  id: string;
  index: number;
  parentId: string | null;
  treeId: string;
  depth: number;
}) {
  const isMobile = useIsMobile();
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "backlog-reorder", index, parentId, treeId },
  });

  return (
    <div
      ref={setNodeRef}
      className={`relative py-1`}
      style={{ marginLeft: `${depth * INDENT_PER_LEVEL + BASE_INDENT}px` }}
    >
      <div className={`rounded-full transition-all ${isOver ? "h-1 bg-selection" : ""}`} />
    </div>
  );
}

/** Compute total points for a backlog (including descendant backlogs) */
function useBacklogPoints(backlogId: string, treeId: string) {
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);

  return useMemo(() => {
    const backlogIds = new Set<string>();
    const collectBacklogs = (id: string) => {
      backlogIds.add(id);
      backlogs[id]?.childrenIds.forEach(collectBacklogs);
    };
    collectBacklogs(backlogId);

    const getEffectivePoints = (wi: (typeof workItems)[string]): number => {
      const own = wi.points ?? 0;
      const childrenSum = wi.childrenIds.reduce((sum, cid) => {
        const child = workItems[cid];
        return sum + (child ? getEffectivePoints(child) : 0);
      }, 0);
      return Math.max(own, childrenSum);
    };

    let total = 0;
    Object.values(workItems).forEach((wi) => {
      if (wi.backlogAssignments[treeId] && backlogIds.has(wi.backlogAssignments[treeId])) {
        const parentInSet =
          wi.parentId && workItems[wi.parentId] && backlogIds.has(workItems[wi.parentId].backlogAssignments[treeId]);
        if (!parentInSet) {
          total += getEffectivePoints(wi);
        }
      }
    });
    return total;
  }, [workItems, backlogs, backlogId, treeId]);
}

const DRAG_THRESHOLD = 5; // pixels — minimum movement to count as a drag vs. a tap

function BacklogNode({ backlogId, depth, index, parentId, treeId, isScrambled }: BacklogNodeProps) {
  const backlog = useAppStore((s) => s.backlogs[backlogId]);
  const isSelected = useAppStore((s) => s.selectedBacklogIds.includes(backlogId));
  const expanded = useAppStore((s) => s.expandedBacklogs.has(backlogId));
  const toggleExpand = useAppStore((s) => s.toggleBacklogExpand);
  const selectBacklog = useAppStore((s) => s.selectBacklog);
  const addBacklog = useAppStore((s) => s.addBacklog);
  const deleteBacklog = useAppStore((s) => s.deleteBacklog);
  const renameBacklog = useAppStore((s) => s.renameBacklog);
  const isMobile = useIsMobile();
  const [isAdding, setIsAdding] = useState(false);
  const [isAddingSibling, setIsAddingSibling] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const editRef = useRef<HTMLInputElement>(null);
  const dragStartedRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Draggable for rearranging
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `backlog-drag-${backlogId}`,
    data: { type: "backlog-node", backlogId, treeId: backlog?.treeId, parentId },
  });

  // Droppable for work items AND for reparenting backlogs onto this node
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `backlog-drop-${backlogId}`,
    data: { type: "backlog", backlogId, treeId: backlog?.treeId },
  });

  // On desktop: apply dnd-kit listeners to the entire row. Extract onPointerDown so
  // it can be merged with our custom tracking handler.
  const { onPointerDown: dndPointerDown, ...restListeners } = !isMobile ? (listeners ?? {}) : {};

  const combinedRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );

  const totalPoints = useBacklogPoints(backlogId, backlog?.treeId ?? "");
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const pointsVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.pointsEnabled ?? false);
  const timeLoggingVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.timeLoggingEnabled ?? false);
  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const backlogTotalMinutes = useMemo(() => {
    if (!timeLoggingVisible) return 0;
    return Object.values(timeEntries)
      .filter((e) => e.backlogId === backlogId && e.workItemId === null)
      .reduce((sum, e) => sum + e.durationMinutes, 0);
  }, [timeEntries, backlogId, timeLoggingVisible]);
  const [showTimeLogDialog, setShowTimeLogDialog] = useState(false);

  // Labels
  const labelsVisible = isLabelsEnabled(activeOrgId);
  const labelsMap = useLabelsStore((s) => s.labels);
  const assignments = useLabelsStore((s) => s.assignments);
  const backlogLabels = useMemo(() => {
    if (!labelsVisible) return [];
    const out = Object.values(assignments)
      .filter((a) => a.entityType === "backlog" && a.entityId === backlogId)
      .map((a) => labelsMap[a.labelId])
      .filter(Boolean);
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [labelsVisible, assignments, labelsMap, backlogId]);

  useEffect(() => {
    if (isEditing) {
      editRef.current?.focus();
      editRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isSelected) return;

    const handleAddBacklog = () => setIsAdding(true);
    const handleAddSiblingBacklog = () => setIsAddingSibling(true);
    const handleDeleteBacklog = () => {
      if (useAppStore.getState().selectedWorkItemIds.length > 0) return;
      deleteBacklog(backlogId);
    };

    window.addEventListener("shortcut:add-child-backlog", handleAddBacklog);
    window.addEventListener("shortcut:add-sibling-backlog", handleAddSiblingBacklog);
    window.addEventListener("shortcut:delete-selected", handleDeleteBacklog);
    return () => {
      window.removeEventListener("shortcut:add-child-backlog", handleAddBacklog);
      window.removeEventListener("shortcut:add-sibling-backlog", handleAddSiblingBacklog);
      window.removeEventListener("shortcut:delete-selected", handleDeleteBacklog);
    };
  }, [isSelected, backlogId, deleteBacklog]);

  if (!backlog) return null;

  const hasChildren = backlog.childrenIds.length > 0;

  const startEditing = () => {
    setEditValue(backlog.name);
    setIsEditing(true);
  };

  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== backlog.name) {
      renameBacklog(backlogId, trimmed);
    }
    setIsEditing(false);
  };

  return (
    <div
      className="animate-fade-in-up"
      style={{
        animationDelay: `${depth * 40}ms`,
        ...(isDragging ? { opacity: 0.4 } : {}),
      }}
    >
      <div
        ref={combinedRef}
        {...attributes}
        {...restListeners}
        className={`
          flex items-center gap-1.5 px-2 py-0.5 md:py-1 rounded-md
          transition-all duration-150 ease-out select-none group
          ${!isMobile ? "cursor-grab active:cursor-grabbing" : ""}
          ${isSelected ? "bg-selection/10 ring-1 ring-selection/40 text-foreground font-medium" : "hover:bg-muted"}
          ${isOver && !isDragging ? "drag-over" : ""}
          ${isDragging ? "shadow-lg bg-card" : ""}
        `}
        style={{ paddingLeft: `${depth * INDENT_PER_LEVEL + BASE_INDENT}px` }}
        onPointerDown={(e) => {
          dndPointerDown?.(e);
          dragStartedRef.current = false;
          dragStartPosRef.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          if (!dragStartPosRef.current) return;
          const dx = Math.abs(e.clientX - dragStartPosRef.current.x);
          const dy = Math.abs(e.clientY - dragStartPosRef.current.y);
          if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
            dragStartedRef.current = true;
          }
        }}
        onClick={(e) => {
          if (dragStartedRef.current) return;
          selectBacklog(backlogId, backlog.treeId, e.ctrlKey || e.metaKey);
        }}
      >
        {/* On mobile: drag handle is the only drag target (preserves row-scroll).
            On desktop: the entire row is draggable; handle is a visual affordance. */}
        <div
          {...(isMobile ? listeners : {})}
          data-drag-handle="true"
          className={`w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground/40 ${isMobile ? "touch-none cursor-grab active:cursor-grabbing" : ""}`}
        >
          <GripVertical className="w-3 h-3" />
        </div>
        <button
          className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggleExpand(backlogId);
          }}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="w-3.5 h-3.5" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5" />
            )
          ) : (
            <span className="w-3.5" />
          )}
        </button>
        <FolderKanban className="w-4 h-4 shrink-0 text-primary/70" />
        {isEditing ? (
          <input
            ref={editRef}
            className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-0.5 py-0 min-w-0"
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
        ) : (
          <span
            className="text-sm truncate flex-1"
            onDoubleClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
          >
            {isScrambled ? scrambleName(backlog.name) : backlog.name}
          </span>
        )}
        {labelsVisible && backlogLabels.length > 0 && (
          <div className="flex items-center gap-0.5 shrink-0 flex-wrap">
            {backlogLabels.map((label) => (
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
        {pointsVisible && totalPoints > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0 group-hover:hidden">
            {totalPoints} pt{totalPoints !== 1 ? "s" : ""}
          </span>
        )}
        <div className="flex md:hidden items-center gap-0.5 shrink-0">
          {pointsVisible && totalPoints > 0 && <span className="text-xs tabular-nums text-muted-foreground mr-1">{totalPoints}</span>}
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={(e) => { e.stopPropagation(); setIsAdding(true); }}
          ><Plus className="w-3.5 h-3.5" /></button>
          {labelsVisible && (
            <LabelPicker entityType="backlog" entityId={backlogId}>
              <button
                className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => e.stopPropagation()}
              ><Tag className="w-3.5 h-3.5" /></button>
            </LabelPicker>
          )}
          {timeLoggingVisible && (
            <button
              className="flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors px-0.5 min-w-[1.5rem] h-6"
              onClick={(e) => { e.stopPropagation(); setShowTimeLogDialog(true); }}
            >
              {backlogTotalMinutes > 0 ? (
                <span className="text-xs font-medium tabular-nums">{formatDuration(backlogTotalMinutes)}</span>
              ) : (
                <Clock className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            onClick={(e) => { e.stopPropagation(); deleteBacklog(backlogId); }}
          ><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          {pointsVisible && totalPoints > 0 && <span className="text-xs tabular-nums text-muted-foreground mr-1">{totalPoints}</span>}
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setIsAdding(true);
            }}
            title="Add child backlog (Shift+Enter)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          {labelsVisible && (
            <LabelPicker entityType="backlog" entityId={backlogId}>
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="Labels"
                onClick={(e) => e.stopPropagation()}
              >
                <Tag className="w-3.5 h-3.5" />
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
              {backlogTotalMinutes > 0 ? (
                <span className="text-xs font-medium tabular-nums">{formatDuration(backlogTotalMinutes)}</span>
              ) : (
                <Clock className="w-3.5 h-3.5" />
              )}
            </button>
          )}
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              deleteBacklog(backlogId);
            }}
            title="Delete backlog (Del)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {(expanded || isAdding) && (
        <div>
          {hasChildren &&
            expanded &&
            backlog.childrenIds.map((childId, i) => (
              <div key={childId}>
                <BacklogReorderDropZone
                  id={`backlog-reorder-${backlogId}-${i}`}
                  index={i}
                  parentId={backlogId}
                  treeId={backlog.treeId}
                  depth={depth + 1}
                />

                <BacklogNode
                  backlogId={childId}
                  depth={depth + 1}
                  index={i}
                  parentId={backlogId}
                  treeId={backlog.treeId}
                  isScrambled={isScrambled}
                />
              </div>
            ))}
          {hasChildren && expanded && (
            <BacklogReorderDropZone
              id={`backlog-reorder-${backlogId}-${backlog.childrenIds.length}`}
              index={backlog.childrenIds.length}
              parentId={backlogId}
              treeId={backlog.treeId}
              depth={depth + 1}
            />
          )}
          {isAdding && (
            <InlineInput
              depth={depth + 1}
              onSubmit={(name) => {
                addBacklog(name, backlogId, backlog.treeId);
                setIsAdding(false);
                setTimeout(() => {
                  window.dispatchEvent(new CustomEvent('shortcut:add-sibling-backlog'));
                }, 50);
              }}
              onCancel={() => setIsAdding(false)}
            />
          )}
        </div>
      )}
      {isAddingSibling && (
        <InlineInput
          depth={depth}
          onSubmit={(name) => {
            addBacklog(name, parentId, backlog.treeId);
            setIsAddingSibling(false);
            setTimeout(() => {
              window.dispatchEvent(new CustomEvent('shortcut:add-sibling-backlog'));
            }, 50);
          }}
          onCancel={() => setIsAddingSibling(false)}
        />
      )}
      {timeLoggingVisible && (
        <TimeLogDialog
          backlogId={backlogId}
          open={showTimeLogDialog}
          onOpenChange={setShowTimeLogDialog}
        />
      )}
    </div>
  );
}

function EditableTreeName({ treeId, name, isScrambled }: { treeId: string; name: string; isScrambled: boolean }) {
  const renameBacklogTree = useAppStore((s) => s.renameBacklogTree);
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
    setEditValue(name);
    setIsEditing(true);
  };
  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) renameBacklogTree(treeId, trimmed);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="text-xs font-semibold uppercase tracking-wide bg-transparent border-b border-primary/40 outline-none px-0.5 py-0 min-w-0 flex-1"
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
    <span
      className="text-xs text-muted-foreground uppercase tracking-wide cursor-text hover:text-foreground transition-colors font-medium"
      onDoubleClick={startEditing}
    >
      {isScrambled ? scrambleName(name) : name}
    </span>
  );
}

function TreeReorderDropZone({ id, index }: { id: string; index: number }) {
  const isMobile = useIsMobile();
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "tree-reorder", index },
  });

  return (
    <div ref={setNodeRef} className={`relative py-1 mx-2`}>
      <div className={`rounded-full transition-all ${isOver ? "h-1 bg-selection" : ""}`} />
    </div>
  );
}

function DraggableTreeHeader({
  tree,
  onAddBacklog,
  onDeleteTree,
  onShareTree,
  shares,
  isScrambled,
}: {
  tree: { id: string; name: string; rank: number; rootBacklogIds: string[] };
  onAddBacklog: () => void;
  onDeleteTree: () => void;
  onShareTree: () => void;
  shares: TreeShare[];
  isScrambled: boolean;
}) {
  const dragStartedRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `tree-drag-${tree.id}`,
    data: { type: "tree-node", treeId: tree.id },
  });

  return (
    <div
      ref={setDragRef}
      {...attributes}
      className="px-1 py-0.5 flex flex-col group select-none"
      style={isDragging ? { opacity: 0.4 } : undefined}
      onPointerDown={(e) => {
        dragStartedRef.current = false;
        dragStartPosRef.current = { x: e.clientX, y: e.clientY };
      }}
      onPointerMove={(e) => {
        if (!dragStartPosRef.current) return;
        const dx = Math.abs(e.clientX - dragStartPosRef.current.x);
        const dy = Math.abs(e.clientY - dragStartPosRef.current.y);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
          dragStartedRef.current = true;
        }
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <div {...listeners} data-drag-handle="true" className="touch-none cursor-grab active:cursor-grabbing flex items-center">
            <GripVertical className="w-3 h-3 text-muted-foreground/40 shrink-0" />
          </div>
          <EditableTreeName treeId={tree.id} name={tree.name} isScrambled={isScrambled} />
          {shares.length > 0 && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-0.5 ml-1 text-muted-foreground">
                    <Users className="w-3 h-3" />
                    <span className="text-[10px] font-medium">{shares.length}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  <p className="font-medium mb-1">Shared with:</p>
                  {shares.map((s) => (
                    <p key={s.orgId} className="text-muted-foreground">
                      {s.orgName}
                    </p>
                  ))}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="flex md:hidden items-center gap-0.5 shrink-0">
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={(e) => { e.stopPropagation(); onShareTree(); }}
          ><Share2 className="w-3.5 h-3.5" /></button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={(e) => { e.stopPropagation(); onAddBacklog(); }}
          ><Plus className="w-3.5 h-3.5" /></button>
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            onClick={(e) => { e.stopPropagation(); onDeleteTree(); }}
          ><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all hidden md:flex">
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onShareTree();
            }}
            title="Share tree with another organization"
          >
            <Share2 className="w-3.5 h-3.5" />
          </button>
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onAddBacklog();
            }}
            title="Add root backlog"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteTree();
            }}
            title="Delete backlog tree"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function BacklogTreePanel() {
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const addBacklog = useAppStore((s) => s.addBacklog);
  const addBacklogTree = useAppStore((s) => s.addBacklogTree);
  const deleteBacklogTree = useAppStore((s) => s.deleteBacklogTree);
  const [addingToTree, setAddingToTree] = useState<string | null>(null);
  const [isAddingTree, setIsAddingTree] = useState(false);
  const [sharingTree, setSharingTree] = useState<{ id: string; name: string } | null>(null);

  const sortedTrees = useMemo(
    () => Object.values(backlogTrees).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
    [backlogTrees],
  );

  const treeIds = useMemo(() => sortedTrees.map((t) => t.id), [sortedTrees]);
  const treeShares = useTreeShares(treeIds);

  const { scrambleEnabled } = useScramble();

  // A tree is scrambled only when scramble is enabled AND it has no shares with any org.
  const isTreeScrambled = (treeId: string) =>
    scrambleEnabled && !(treeShares[treeId]?.length > 0);

  return (
    <div className="h-full flex flex-col bg-sidebar">
      <div className="p-1.5 pb-1 md:p-2 md:pb-1.5 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-extrabold">BACKLOGS</h2>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={() => setIsAddingTree(true)}
          title="Add backlog tree"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-1 pb-1">
        {isAddingTree && (
          <div className="mb-2 px-2">
            <InlineInput
              depth={0}
              onSubmit={(name) => {
                addBacklogTree(name);
                setIsAddingTree(false);
              }}
              onCancel={() => setIsAddingTree(false)}
            />
          </div>
        )}
        {sortedTrees.map((tree, treeIndex) => {
          const treeIsScrambled = isTreeScrambled(tree.id);
          return (
            <div key={tree.id} className="mb-1">
              <TreeReorderDropZone id={`tree-reorder-${treeIndex}`} index={treeIndex} />
              <DraggableTreeHeader
                tree={tree}
                onAddBacklog={() => setAddingToTree(tree.id)}
                onDeleteTree={() => deleteBacklogTree(tree.id)}
                onShareTree={() => setSharingTree({ id: tree.id, name: tree.name })}
                shares={treeShares[tree.id] ?? []}
                isScrambled={treeIsScrambled}
              />
              {tree.rootBacklogIds.map((backlogId, i) => (
                <div key={backlogId}>
                  <BacklogReorderDropZone
                    id={`backlog-reorder-root-${tree.id}-${i}`}
                    index={i}
                    parentId={null}
                    treeId={tree.id}
                    depth={0}
                  />
                  <BacklogNode backlogId={backlogId} depth={0} index={i} parentId={null} treeId={tree.id} isScrambled={treeIsScrambled} />
                </div>
              ))}
              <BacklogReorderDropZone
                id={`backlog-reorder-root-${tree.id}-${tree.rootBacklogIds.length}`}
                index={tree.rootBacklogIds.length}
                parentId={null}
                treeId={tree.id}
                depth={0}
              />
              {addingToTree === tree.id && (
                <InlineInput
                  depth={0}
                  onSubmit={(name) => {
                    addBacklog(name, null, tree.id);
                    setAddingToTree(null);
                  }}
                  onCancel={() => setAddingToTree(null)}
                />
              )}
            </div>
          );
        })}
        <TreeReorderDropZone id={`tree-reorder-${sortedTrees.length}`} index={sortedTrees.length} />
      </div>

      {sharingTree && (
        <ShareTreeDialog
          treeId={sharingTree.id}
          treeName={sharingTree.name}
          open={!!sharingTree}
          onOpenChange={(open) => {
            if (!open) setSharingTree(null);
          }}
        />
      )}
    </div>
  );
}
