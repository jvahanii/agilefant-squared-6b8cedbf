import { useAppStore } from '@/store/appStore';
import { ChevronRight, ChevronDown, GripVertical, FileText, Plus, Trash2 } from 'lucide-react';
import { useDraggable, useDroppable, DragOverEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { ActionPrompt } from './ActionPrompt';

function InlineWorkItemInput({ onSubmit, onCancel, depth }: { onSubmit: (title: string) => void; onCancel: () => void; depth: number }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
    else onCancel();
  };

  return (
    <div className="flex items-center gap-1.5 px-3 py-2" style={{ paddingLeft: `${depth * 20 + 32}px` }}>
      <FileText className="w-3.5 h-3.5 text-primary/50 shrink-0" />
      <input
        ref={inputRef}
        className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-1 py-0.5 placeholder:text-muted-foreground/50"
        placeholder="Work item title…"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={handleSubmit}
      />
    </div>
  );
}

interface WorkItemNodeProps {
  workItemId: string;
  depth: number;
  treeId: string;
  backlogId: string;
}

function WorkItemNode({ workItemId, depth, treeId, backlogId }: WorkItemNodeProps) {
  const item = useAppStore(s => s.workItems[workItemId]);
  const backlogs = useAppStore(s => s.backlogs);
  const expanded = useAppStore(s => s.expandedWorkItems.has(workItemId));
  const isSelected = useAppStore(s => s.selectedWorkItemIds.includes(workItemId));
  const toggleExpand = useAppStore(s => s.toggleWorkItemExpand);
  const selectWorkItem = useAppStore(s => s.selectWorkItem);
  const addWorkItem = useAppStore(s => s.addWorkItem);
  const deleteWorkItem = useAppStore(s => s.deleteWorkItem);
  const removeWorkItemFromTree = useAppStore(s => s.removeWorkItemFromTree);
  const renameWorkItem = useAppStore(s => s.renameWorkItem);
  const setWorkItemPoints = useAppStore(s => s.setWorkItemPoints);
  const [isAdding, setIsAdding] = useState(false);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [isEditingPoints, setIsEditingPoints] = useState(false);
  const [editPoints, setEditPoints] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);

  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: `workitem-${workItemId}`,
    data: { type: 'workitem', workItemId, treeId },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `workitem-drop-${workItemId}`,
    data: { type: 'workitem-parent', workItemId, treeId, backlogId },
  });

  const combinedRef = useCallback((node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  }, [setDragRef, setDropRef]);

  useEffect(() => {
    if (isEditingTitle) { titleRef.current?.focus(); titleRef.current?.select(); }
  }, [isEditingTitle]);

  useEffect(() => {
    if (isEditingPoints) { pointsRef.current?.focus(); pointsRef.current?.select(); }
  }, [isEditingPoints]);

  // Listen for keyboard shortcuts when this work item is selected
  useEffect(() => {
    if (!isSelected) return;

    const handleAddChild = () => setIsAdding(true);
    const handleDelete = () => handleDeleteClick();

    window.addEventListener('shortcut:add-child-workitem', handleAddChild);
    window.addEventListener('shortcut:delete-selected', handleDelete);
    return () => {
      window.removeEventListener('shortcut:add-child-workitem', handleAddChild);
      window.removeEventListener('shortcut:delete-selected', handleDelete);
    };
  }, [isSelected, workItemId]);

  if (!item) return null;

  const hasChildren = item.childrenIds.length > 0;
  const assignmentCount = Object.keys(item.backlogAssignments).length;

  const backlogLabels = Object.entries(item.backlogAssignments)
    .map(([, blId]) => backlogs[blId]?.name)
    .filter(Boolean)
    .join(', ');

  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: 50,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  const handleDeleteClick = () => {
    if (assignmentCount > 1) {
      setShowDeletePrompt(true);
    } else {
      deleteWorkItem(workItemId);
    }
  };

  const handleDeleteChoice = (value: string) => {
    setShowDeletePrompt(false);
    if (value === 'remove-from-backlog') {
      removeWorkItemFromTree(workItemId, treeId);
    } else if (value === 'delete-everywhere') {
      deleteWorkItem(workItemId);
    }
  };

  const startEditingTitle = () => {
    setEditTitle(item.title);
    setIsEditingTitle(true);
  };

  const commitTitle = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== item.title) {
      renameWorkItem(workItemId, trimmed);
    }
    setIsEditingTitle(false);
  };

  const startEditingPoints = () => {
    setEditPoints(item.points != null ? String(item.points) : '');
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
        style={style}
        className="animate-fade-in-up"
        {...attributes}
      >
        <div
          {...listeners}
          className={`
            flex items-center gap-1.5 px-3 py-2 rounded-md cursor-grab active:cursor-grabbing
            transition-all duration-150 ease-out group
            border
            ${isSelected
              ? 'bg-selection/10 border-selection/30 ring-1 ring-selection/30'
              : 'border-transparent hover:bg-muted hover:border-border'}
            ${isDragging ? 'shadow-lg bg-card' : ''}
            ${isOver && !isDragging ? 'drag-over' : ''}
          `}
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
          onClick={(e) => {
            e.stopPropagation();
            if (e.ctrlKey || e.metaKey) {
              selectWorkItem(workItemId, true);
            } else {
              selectWorkItem(isSelected ? null : workItemId);
            }
          }}
        >
          <div className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground/40">
            <GripVertical className="w-3.5 h-3.5" />
          </div>
          <button
            className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggleExpand(workItemId);
            }}
          >
            {hasChildren ? (
              expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <FileText className="w-3.5 h-3.5 text-primary/50" />
            )}
          </button>
          {isEditingTitle ? (
            <input
              ref={titleRef}
              className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-0.5 py-0 min-w-0"
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitTitle();
                if (e.key === 'Escape') setIsEditingTitle(false);
                e.stopPropagation();
              }}
              onBlur={commitTitle}
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
            />
          ) : (
            <span
              className="text-sm truncate flex-1"
              onClick={(e) => {
                if (isSelected) {
                  e.stopPropagation();
                  startEditingTitle();
                }
              }}
              onPointerDown={(e) => {
                if (isSelected) e.stopPropagation();
              }}
            >
              {item.title}
              {backlogLabels && (
                <span className="text-muted-foreground text-xs ml-1">({backlogLabels})</span>
              )}
            </span>
          )}
          {isEditingPoints ? (
            <input
              ref={pointsRef}
              className="w-12 text-xs text-center bg-transparent border-b border-primary/40 outline-none tabular-nums shrink-0"
              value={editPoints}
              onChange={e => setEditPoints(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitPoints();
                if (e.key === 'Escape') setIsEditingPoints(false);
                e.stopPropagation();
              }}
              onBlur={commitPoints}
              onClick={e => e.stopPropagation()}
              onPointerDown={e => e.stopPropagation()}
              placeholder="pts"
            />
          ) : (
            <span
              className={`text-xs tabular-nums font-medium px-1.5 py-0.5 rounded-full shrink-0 cursor-pointer
                ${item.points != null && item.points > 0
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground/50 opacity-0 group-hover:opacity-100'}
              `}
              onClick={(e) => {
                e.stopPropagation();
                startEditingPoints();
              }}
              onPointerDown={e => e.stopPropagation()}
              title="Edit points (P)"
            >
              {item.points != null && item.points > 0 ? item.points : '·'}
            </span>
          )}
          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={(e) => { e.stopPropagation(); setIsAdding(true); }}
              title="Add child item (Shift+N)"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              onClick={(e) => { e.stopPropagation(); handleDeleteClick(); }}
              title="Delete item (Del)"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
            {hasChildren && (
              <span className="text-xs text-muted-foreground ml-1 tabular-nums">
                {item.childrenIds.length}
              </span>
            )}
          </div>
          {hasChildren && (
            <span className="text-xs text-muted-foreground tabular-nums group-hover:hidden shrink-0">
              {item.childrenIds.length}
            </span>
          )}
        </div>
        {(expanded || isAdding) && (
          <div className="relative">
            {(expanded && hasChildren) && (
              <>
                <div
                  className="absolute tree-line"
                  style={{ left: `${depth * 20 + 24}px`, top: 0, bottom: 0 }}
                />
                {item.childrenIds.map(childId => (
                  <WorkItemNode key={childId} workItemId={childId} depth={depth + 1} treeId={treeId} backlogId={backlogId} />
                ))}
              </>
            )}
            {isAdding && (
              <InlineWorkItemInput
                depth={depth + 1}
                onSubmit={(title) => { addWorkItem(title, workItemId, backlogId, treeId); setIsAdding(false); }}
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
              label: 'Remove from this backlog',
              description: `Remove from "${backlogs[item.backlogAssignments[treeId]]?.name}" only. Keeps it in other backlogs.`,
              value: 'remove-from-backlog',
              isDefault: true,
            },
            {
              label: 'Delete everywhere',
              description: 'Permanently delete this item from all backlogs.',
              value: 'delete-everywhere',
              variant: 'destructive',
            },
          ]}
          onSelect={handleDeleteChoice}
          onCancel={() => setShowDeletePrompt(false)}
        />
      )}
    </>
  );
}

export function WorkItemTreePanel() {
  const selectedBacklogIds = useAppStore(s => s.selectedBacklogIds);
  const selectedBacklogId = selectedBacklogIds[0] ?? null;
  const selectedTreeId = useAppStore(s => s.selectedTreeId);
  const workItems = useAppStore(s => s.workItems);
  const backlogs = useAppStore(s => s.backlogs);
  const addWorkItem = useAppStore(s => s.addWorkItem);
  const clearWorkItemSelection = useAppStore(s => s.clearWorkItemSelection);
  const [isAdding, setIsAdding] = useState(false);

  const selectedBacklog = selectedBacklogId ? backlogs[selectedBacklogId] : null;

  // Listen for keyboard shortcut to add root work item
  useEffect(() => {
    const handler = () => setIsAdding(true);
    window.addEventListener('shortcut:add-workitem', handler);
    return () => window.removeEventListener('shortcut:add-workitem', handler);
  }, []);

  const rootWorkItems = useMemo(() => {
    if (!selectedBacklogId || !selectedTreeId) return [];
    return Object.values(workItems)
      .filter(wi =>
        wi.backlogAssignments[selectedTreeId] === selectedBacklogId &&
        (wi.parentId === null || workItems[wi.parentId]?.backlogAssignments[selectedTreeId] !== selectedBacklogId)
      )
      .sort((a, b) => a.rank - b.rank);
  }, [workItems, selectedBacklogId, selectedTreeId]);

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
      className="h-full flex flex-col"
      onClick={() => clearWorkItemSelection()}
    >
      <div className="p-4 pb-2 border-b flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{selectedBacklog?.name}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {rootWorkItems.length} item{rootWorkItems.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={(e) => { e.stopPropagation(); setIsAdding(true); }}
          title="Add work item (N)"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <WorkItemRootDropZone treeId={selectedTreeId} backlogId={selectedBacklogId}>
        <div className="flex-1 overflow-y-auto p-2">
          {rootWorkItems.length === 0 && !isAdding ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              No work items in this backlog
            </div>
          ) : (
            rootWorkItems.map(item => (
              <WorkItemNode key={item.id} workItemId={item.id} depth={0} treeId={selectedTreeId} backlogId={selectedBacklogId} />
            ))
          )}
          {isAdding && (
            <InlineWorkItemInput
              depth={0}
              onSubmit={(title) => { addWorkItem(title, null, selectedBacklogId, selectedTreeId); setIsAdding(false); }}
              onCancel={() => setIsAdding(false)}
            />
          )}
        </div>
      </WorkItemRootDropZone>
    </div>
  );
}
