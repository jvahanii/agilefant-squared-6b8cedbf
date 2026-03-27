import { useAppStore } from "@/store/appStore";
import { WORK_ITEM_STATUSES } from "@/types/models";
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
      className="text-base font-semibold cursor-text hover:text-primary transition-colors break-words whitespace-normal leading-tight"
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
        className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-1 py-0.5 placeholder:text-muted-foreground/50 resize-none overflow-hidden min-h-[1.25rem] leading-relaxed"
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
}

function WorkItemNode({ workItemId, depth, treeId, backlogId, allBacklogIds, isChildBacklog }: WorkItemNodeProps) {
  const item = useAppStore((s) => s.workItems[workItemId]);
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const expanded = useAppStore((s) => s.expandedWorkItems.has(workItemId));
  const isSelected = useAppStore((s) => s.selectedWorkItemIds.includes(workItemId));
  const toggleExpand = useAppStore((s) => s.toggleWorkItemExpand);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
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

  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
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
      selectedIds:
        selectedWorkItemIds.includes(workItemId) && selectedWorkItemIds.length > 1 ? selectedWorkItemIds : [workItemId],
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
            flex items-start gap-2 px-3 py-2.5 rounded-lg cursor-grab active:cursor-grabbing
            transition-all duration-200 ease-out group
            border select-none touch-none mb-1
            ${isChildBacklog ? "text-muted-foreground" : ""}
            ${
              isSelected
                ? "bg-selection/10 border-selection/40 ring-1 ring-selection/20 shadow-sm"
                : "border-transparent hover:bg-muted/60 hover:border-border/50"
            }
            ${isDragging ? "shadow-xl bg-card scale-[1.02] border-primary/20" : ""}
            ${isOver && !isDragging ? "bg-primary/5 border-primary/20 ring-1 ring-primary/20" : ""}
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
            if (e.ctrlKey || e.metaKey) selectWorkItem(workItemId, true);
            else selectWorkItem(isSelected ? null : workItemId);
          }}
        >
          {/* Left Column: Drag Handle & Expand Button */}
          <div className="flex items-center gap-1 shrink-0 mt-0.5">
            <div
              className={`w-4 h-4 flex items-center justify-center ${isChildBacklog ? "text-muted-foreground/30" : "text-muted-foreground/40"}`}
            >
              <GripVertical className="w-3.5 h-3.5" />
            </div>
            <button
              className={`w-5 h-5 flex items-center justify-center rounded hover:bg-muted transition-colors ${isChildBacklog ? "text-muted-foreground/50" : "text-muted-foreground"} hover:text-foreground`}
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleExpand(workItemId);
              }}
            >
              {hasChildren ? (
                expanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )
              ) : (
                <FileText className={`w-3.5 h-3.5 opacity-40`} />
              )}
            </button>
          </div>

          {/* Status Dot */}
          <div className="mt-1.5 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="w-2.5 h-2.5 rounded-full border border-background/50 transition-all hover:ring-4 hover:ring-primary/10"
                  style={{
                    backgroundColor:
                      WORK_ITEM_STATUSES.find((s) => s.value === item.status)?.color ?? "var(--status-not-started)",
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[140px] shadow-xl border-border/50">
                {WORK_ITEM_STATUSES.map((s) => (
                  <DropdownMenuItem
                    key={s.value}
                    onClick={(e) => {
                      e.stopPropagation();
                      setWorkItemStatus(workItemId, s.value);
                    }}
                    className="flex items-center gap-2 text-xs"
                  >
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Title Area */}
          <div className="flex-1 min-w-0">
            {isEditingTitle ? (
              <textarea
                ref={titleRef}
                rows={1}
                className="w-full text-sm bg-transparent border-b border-primary/40 outline-none px-0 py-0 resize-none overflow-hidden min-h-[1.25rem] leading-relaxed font-medium"
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
              <div className="flex flex-col gap-1">
                <span
                  className="text-sm font-medium leading-relaxed break-words whitespace-normal cursor-text hover:text-primary/80 transition-colors"
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startEditingTitle();
                  }}
                >
                  {item.title}
                </span>

                {/* Backlog Path Breadcrumbs (Now below the title for a cleaner look) */}
                {backlogPaths.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {backlogPaths.map(({ treeId: tid, path }) => (
                      <div
                        key={tid}
                        className="flex items-center text-[10px] text-muted-foreground/60 bg-muted/40 px-1.5 py-0.5 rounded"
                      >
                        {path.map((seg, i) => (
                          <span key={seg.id} className="flex items-center">
                            {i > 0 && <span className="mx-1 opacity-30">/</span>}
                            <button
                              className="hover:text-primary hover:underline"
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
              </div>
            )}
          </div>

          {/* Right Column: Points & Actions */}
          <div className="flex items-start gap-3 shrink-0 ml-2 mt-0.5">
            <div className="flex flex-col items-end gap-2">
              {isEditingPoints ? (
                <input
                  ref={pointsRef}
                  className="w-8 text-xs text-center bg-transparent border-b border-primary/40 outline-none tabular-nums font-semibold"
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
                    <div
                      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs tabular-nums cursor-text transition-colors ${isRolledUp ? "bg-primary/10 text-primary font-bold" : "text-muted-foreground bg-muted/30"}`}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startEditingPoints();
                      }}
                      title={isRolledUp ? `Own: ${item.points ?? 0}, Rolled-up: ${directChildrenSum}` : "Points"}
                    >
                      {totalPoints > 0 ? totalPoints : "–"}
                    </div>
                  );
                })()
              )}

              <div className="flex items-center gap-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsAdding(true);
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
                <button
                  className="w-6 h-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteClick();
                  }}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {hasChildren && (
              <div className="min-w-[1.25rem] h-5 flex items-center justify-center bg-muted/50 rounded text-[10px] font-bold text-muted-foreground group-hover:hidden">
                {item.childrenIds.length}
              </div>
            )}
          </div>
        </div>

        {/* Child Containers */}
        {(expanded || isAdding) && (
          <div className="relative">
            {expanded && hasChildren && (
              <>
                <div
                  className="absolute tree-line w-[1px] bg-border/40 hover:bg-primary/30 transition-colors"
                  style={{ left: `${depth * 20 + 24}px`, top: 0, bottom: 0 }}
                />
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
            {isAdding && (
              <InlineWorkItemInput
                depth={depth + 1}
                onSubmit={(title) => {
                  addWorkItem(title, workItemId, backlogId, treeId);
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
    <div ref={setNodeRef} className="relative h-2 -my-1 z-10" style={{ marginLeft: `${depth * 20 + 12}px` }}>
      <div
        className={`absolute inset-x-2 top-1/2 -translate-y-1/2 h-0.5 rounded-full transition-all duration-200 ${isOver ? "bg-primary scale-x-100 shadow-[0_0_8px_rgba(var(--primary),0.5)]" : "bg-transparent scale-x-95"}`}
      />
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
      className={`flex-1 overflow-hidden transition-all duration-300 ${isOver ? "bg-primary/[0.02] ring-2 ring-primary/20 ring-inset rounded-xl" : ""}`}
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
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const clearWorkItemSelection = useAppStore((s) => s.clearWorkItemSelection);
  const [isAdding, setIsAdding] = useState(false);

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

  if (!selectedBacklogId || !selectedTreeId) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground animate-in fade-in zoom-in-95 duration-500">
        <div className="text-center">
          <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground/20" />
          <p className="text-sm font-medium">Select a backlog to view work items</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background/50" onClick={() => clearWorkItemSelection()}>
      <div className="p-6 pb-4 border-b bg-card/30 backdrop-blur-md flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <EditableBacklogName backlogId={selectedBacklogId} />
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/50 bg-muted px-1.5 py-0.5 rounded">
              {rootWorkItems.length} item{rootWorkItems.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        <button
          className="w-8 h-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:scale-105 active:scale-95 transition-all shrink-0 ml-4"
          onClick={(e) => {
            e.stopPropagation();
            setIsAdding(true);
          }}
          title="Add work item (N)"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      <WorkItemRootDropZone treeId={selectedTreeId} backlogId={selectedBacklogId}>
        <div className="flex-1 overflow-y-auto p-4 space-y-0.5">
          {rootWorkItems.length === 0 && !isAdding ? (
            <div className="flex flex-col items-center justify-center h-48 text-sm text-muted-foreground/60 border-2 border-dashed border-muted rounded-2xl mx-2">
              <Plus className="w-6 h-6 mb-2 opacity-20" />
              No work items yet
            </div>
          ) : (
            <>
              {rootWorkItems.map((item, index) => {
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
                    />
                  </div>
                );
              })}
              <ReorderDropZone
                id={`reorder-root-${rootWorkItems.length}`}
                index={rootWorkItems.length}
                treeId={selectedTreeId}
                backlogIds={allBacklogIds}
                parentId={null}
                depth={0}
              />
            </>
          )}
          {isAdding && (
            <InlineWorkItemInput
              depth={0}
              onSubmit={(title) => {
                addWorkItem(title, null, selectedBacklogId, selectedTreeId);
              }}
              onCancel={() => setIsAdding(false)}
            />
          )}
        </div>
      </WorkItemRootDropZone>
    </div>
  );
}
