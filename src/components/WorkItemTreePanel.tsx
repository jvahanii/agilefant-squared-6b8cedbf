import { useAppStore } from "@/store/appStore";
import { WORK_ITEM_STATUSES, WorkItemStatus } from "@/types/models";
import { ChevronRight, ChevronDown, GripVertical, FileText, Plus, Trash2 } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { ActionPrompt } from "./ActionPrompt";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function EditableBacklogName({ backlogId }: { backlogId: string }) {
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
      onClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
    >
      {backlog.name}
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
    <div className="flex items-start gap-1.5 px-3 py-2" style={{ paddingLeft: `${depth * 20 + 32}px` }}>
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
  onSelect: (id: string, multi: boolean, shift: boolean) => void;
}

function WorkItemNode({
  workItemId,
  depth,
  treeId,
  backlogId,
  allBacklogIds,
  isChildBacklog,
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

  const [isAdding, setIsAdding] = useState(false);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [isEditingPoints, setIsEditingPoints] = useState(false);
  const [editPoints, setEditPoints] = useState("");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);
  const dragStartedRef = useRef(false);

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
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
    },
    [setDragRef, setDropRef],
  );

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
    const handleAddChild = () => setIsAdding(true);
    const handleDelete = () => handleDeleteClick();
    window.addEventListener("shortcut:add-child-workitem", handleAddChild);
    window.addEventListener("shortcut:delete-selected", handleDelete);
    return () => {
      window.removeEventListener("shortcut:add-child-workitem", handleAddChild);
      window.removeEventListener("shortcut:delete-selected", handleDelete);
    };
  }, [isSelected, workItemId]);

  if (!item) return null;

  const hasChildren = item.childrenIds.length > 0;
  const assignmentCount = Object.keys(item.backlogAssignments).length;

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

  const handleDeleteClick = () => {
    if (assignmentCount > 1) setShowDeletePrompt(true);
    else deleteWorkItem(workItemId);
  };

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
        style={
          transform
            ? { transform: CSS.Translate.toString(transform), zIndex: 50, opacity: isDragging ? 0.5 : 1 }
            : undefined
        }
        className="animate-fade-in-up"
      >
        <div
          {...attributes}
          {...listeners}
          className={`
            flex items-start gap-1.5 px-3 py-2 rounded-md cursor-grab active:cursor-grabbing
            transition-all duration-150 ease-out group
            border select-none touch-none
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
            dragStartedRef.current = false;
            listeners?.onPointerDown?.(e);
          }}
          onPointerMove={() => {
            dragStartedRef.current = true;
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (dragStartedRef.current) return;
            const isMulti = e.ctrlKey || e.metaKey;
            const isShift = e.shiftKey;
            onSelect(workItemId, isMulti, isShift);
          }}
        >
          <div
            className={`w-4 h-4 mt-0.5 flex items-center justify-center shrink-0 ${isChildBacklog ? "text-muted-foreground/30" : "text-muted-foreground/40"}`}
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
            <span
              className="flex-1 text-sm cursor-text break-words whitespace-normal py-0.5"
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEditingTitle();
              }}
            >
              {item.title}
            </span>
          )}

          {backlogPaths.length > 0 && (
            <div className="flex items-center gap-1.5 shrink-0 ml-auto mt-0.5">
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
                        {seg.name}
                      </button>
                    </span>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-start gap-1 mt-0.5">
            {isEditingPoints ? (
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
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      startEditingPoints();
                    }}
                    title={
                      isRolledUp
                        ? `Own: ${item.points ?? 0}, Rolled-up: ${directChildrenSum}`
                        : "Story points (double-click to edit)"
                    }
                  >
                    {totalPoints > 0 ? totalPoints : "–"}
                  </span>
                );
              })()
            )}

            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  setIsAdding(true);
                }}
                title="Add child item (Shift+Enter)"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
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

                {/* MOVED PROMPT TO THE TOP OF THE CHILD LIST */}
                {isAdding && (
                  <InlineWorkItemInput
                    depth={depth + 1}
                    onSubmit={(title) => {
                      addWorkItem(title, workItemId, backlogId, treeId, 0);
                    }}
                    onCancel={() => setIsAdding(false)}
                  />
                )}

                {[...item.childrenIds]
                  .map((id) => workItems[id])
                  .filter(Boolean)
                  .sort((a, b) => a.rank - b.rank)
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
              </>
            )}
            {/* Fallback for adding a first child when not expanded */}
            {isAdding && !hasChildren && (
              <InlineWorkItemInput
                depth={depth + 1}
                onSubmit={(title) => {
                  addWorkItem(title, workItemId, backlogId, treeId, 0);
                }}
                onCancel={() => setIsAdding(false)}
              />
            )}
          </div>
        )}
      </div>
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
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "workitem-reorder", index, treeId, backlogIds, parentId },
  });

  return (
    <div ref={setNodeRef} className="relative py-1" style={{ marginLeft: `${depth * 20 + 12}px` }}>
      <div className={`h-0.5 rounded-full transition-all ${isOver ? "bg-selection" : ""}`} />
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
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  const clearWorkItemSelection = useAppStore((s) => s.clearWorkItemSelection);
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);

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
      .sort((a, b) => a.rank - b.rank);
  }, [workItems, selectedBacklogId, selectedTreeId, backlogIdSet]);

  const visibleItemIds = useMemo(() => {
    const ids: string[] = [];
    const traverse = (workItemId: string) => {
      ids.push(workItemId);
      if (expandedWorkItems.has(workItemId)) {
        const item = workItems[workItemId];
        if (item) {
          [...item.childrenIds]
            .map((cid) => workItems[cid])
            .filter(Boolean)
            .sort((a, b) => a.rank - b.rank)
            .forEach((child) => traverse(child.id));
        }
      }
    };
    rootWorkItems.forEach((root) => traverse(root.id));
    return ids;
  }, [rootWorkItems, expandedWorkItems, workItems]);

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
    <div
      className="h-full flex flex-col overflow-hidden"
      onClick={() => {
        clearWorkItemSelection();
        lastSelectedId.current = null;
      }}
    >
      <div className="p-4 pb-2 border-b flex items-start justify-between shrink-0">
        <div className="min-w-0 flex-1">
          <EditableBacklogName backlogId={selectedBacklogId} />
          <p className="text-xs text-muted-foreground mt-0.5">
            {rootWorkItems.length} item{rootWorkItems.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0 ml-2"
          onClick={(e) => {
            e.stopPropagation();
            setIsAdding(true);
          }}
          title="Add work item (N)"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <WorkItemRootDropZone treeId={selectedTreeId} backlogId={selectedBacklogId}>
        <div className="flex-1 overflow-y-auto p-2">
          {/* MOVED ROOT PROMPT TO THE TOP */}
          {isAdding && (
            <InlineWorkItemInput
              depth={0}
              onSubmit={(title) => {
                addWorkItem(title, null, selectedBacklogId, selectedTreeId, 0);
              }}
              onCancel={() => setIsAdding(false)}
            />
          )}

          {rootWorkItems.length === 0 && !isAdding ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              No work items in this backlog
            </div>
          ) : (
            <div className="flex flex-col">
              {rootWorkItems.map((item, index) => {
  const isItemSelected = selectedWorkItemIds.includes(item.id);
  return (
    <div key={item.id}>
      {/* 1. RENDER INPUT ABOVE THE NODE */}
      {isAdding && isItemSelected && (
        <InlineWorkItemInput
          depth={0}
          onSubmit={(title) => {
            // Pass the CURRENT item's rank. 
            // The store will move this item to rank+1.
            addWorkItem(title, null, selectedBacklogId, selectedTreeId, item.rank);
            setIsAdding(false);
          }}
          onCancel={() => setIsAdding(false)}
        />
      )}
              <ReorderDropZone
                id={`reorder-root-${rootWorkItems.length}`}
                index={rootWorkItems.length}
                treeId={selectedTreeId}
                backlogIds={allBacklogIds}
                parentId={null}
                depth={0}
              />
            </div>
          )}
        </div>
      </WorkItemRootDropZone>
    </div>
  );
}
