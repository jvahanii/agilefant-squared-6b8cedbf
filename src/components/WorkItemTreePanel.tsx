import { useAppStore } from '@/store/appStore';
import { ChevronRight, ChevronDown, GripVertical, FileText, Plus, Trash2 } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
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

function EditablePoints({ workItemId, points, editTrigger }: { workItemId: string; points?: number; editTrigger?: number }) {
  const updatePoints = useAppStore(s => s.updateWorkItemPoints);
  const [isEditing, setIsEditing] = useState(false);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (editTrigger && editTrigger > 0) {
      setValue(points != null && points > 0 ? String(points) : '');
      setIsEditing(true);
    }
  }, [editTrigger]);

  const commit = () => {
    const num = parseInt(value, 10);
    updatePoints(workItemId, isNaN(num) || num <= 0 ? undefined : num);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="w-10 text-xs tabular-nums text-center bg-[hsl(var(--selection)/0.10)] border border-[hsl(var(--selection)/0.40)] rounded-full px-1 py-0.5 outline-none shrink-0"
        value={value}
        onChange={e => setValue(e.target.value.replace(/[^0-9]/g, ''))}
        onKeyDown={e => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setIsEditing(false);
          e.stopPropagation();
        }}
        onBlur={commit}
        onClick={e => e.stopPropagation()}
      />
    );
  }

  if (points != null && points > 0) {
    return (
      <button
        className="text-xs tabular-nums font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded-full shrink-0 hover:bg-primary/20 transition-colors"
        onClick={(e) => { e.stopPropagation(); setValue(String(points)); setIsEditing(true); }}
        title="Click to edit points"
      >
        {points}
      </button>
    );
  }

  return (
    <button
      className="text-xs text-muted-foreground/40 hover:text-muted-foreground px-1 shrink-0 opacity-0 group-hover:opacity-100 transition-all"
      onClick={(e) => { e.stopPropagation(); setValue(''); setIsEditing(true); }}
      title="Set points"
    >
      pts
    </button>
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
  const selectedWorkItemId = useAppStore(s => s.selectedWorkItemId);
  const toggleExpand = useAppStore(s => s.toggleWorkItemExpand);
  const selectWorkItem = useAppStore(s => s.selectWorkItem);
  const addWorkItem = useAppStore(s => s.addWorkItem);
  const deleteWorkItem = useAppStore(s => s.deleteWorkItem);
  const removeWorkItemFromTree = useAppStore(s => s.removeWorkItemFromTree);
  const renameWorkItem = useAppStore(s => s.renameWorkItem);
  const [isAdding, setIsAdding] = useState(false);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const isSelected = selectedWorkItemId === workItemId;

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
    if (!isSelected) return;

    const handleAddChild = () => setIsAdding(true);
    const handleDelete = () => handleDeleteClick();
    const handleRename = () => startRename();

    window.addEventListener('shortcut:add-child-workitem', handleAddChild);
    window.addEventListener('shortcut:delete-selected', handleDelete);
    window.addEventListener('shortcut:rename-workitem', handleRename);
    return () => {
      window.removeEventListener('shortcut:add-child-workitem', handleAddChild);
      window.removeEventListener('shortcut:delete-selected', handleDelete);
      window.removeEventListener('shortcut:rename-workitem', handleRename);
    };
  }, [isSelected, workItemId]);

  useEffect(() => {
    if (isRenaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [isRenaming]);

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

  const startRename = () => {
    setRenameValue(item.title);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== item.title) {
      renameWorkItem(workItemId, trimmed);
    }
    setIsRenaming(false);
  };

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

  return (
    <>
      <div
        ref={combinedRef}
        style={style}
        className="animate-fade-in-up"
        {...attributes}
      >
        <div
          className={`
            flex items-center gap-1.5 px-3 py-2 rounded-md cursor-pointer
            transition-all duration-150 ease-out group
            border
            ${isSelected
              ? 'bg-[hsl(var(--selection)/0.08)] border-[hsl(var(--selection)/0.30)] ring-1 ring-[hsl(var(--selection)/0.25)]'
              : 'border-transparent hover:bg-muted hover:border-border'}
            ${isDragging ? 'shadow-lg bg-card' : ''}
            ${isOver && !isDragging ? 'drag-over' : ''}
          `}
          style={{ paddingLeft: `${depth * 20 + 12}px` }}
          onClick={(e) => {
            e.stopPropagation();
            selectWorkItem(isSelected ? null : workItemId);
          }}
          onDoubleClick={(e) => { e.stopPropagation(); startRename(); }}
        >
          <div
            {...listeners}
            className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing transition-colors"
          >
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
          {isRenaming ? (
            <input
              ref={renameRef}
              className="flex-1 text-sm bg-transparent border-b border-[hsl(var(--selection))] outline-none px-1 py-0.5"
              value={renameValue}
              onChange={e => setRenameValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setIsRenaming(false);
                e.stopPropagation();
              }}
              onBlur={commitRename}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="text-sm truncate flex-1">
              {item.title}
              {backlogLabels && (
                <span className="text-muted-foreground text-xs ml-1">({backlogLabels})</span>
              )}
            </span>
          )}
          <EditablePoints workItemId={workItemId} points={item.points} />
          {!isRenaming && (
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
          )}
          {hasChildren && !isRenaming && (
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
          title={`"${item.title}" is in ${assignmentCount} lists`}
          options={[
            {
              label: 'Remove from this list',
              description: `Remove from "${backlogs[item.backlogAssignments[treeId]]?.name}" only. Keeps it in other lists.`,
              value: 'remove-from-backlog',
              isDefault: true,
            },
            {
              label: 'Delete everywhere',
              description: 'Permanently delete this item from all lists.',
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
  const selectedBacklogId = useAppStore(s => s.selectedBacklogId);
  const selectedTreeId = useAppStore(s => s.selectedTreeId);
  const workItems = useAppStore(s => s.workItems);
  const backlogs = useAppStore(s => s.backlogs);
  const addWorkItem = useAppStore(s => s.addWorkItem);
  const selectWorkItem = useAppStore(s => s.selectWorkItem);
  const [isAdding, setIsAdding] = useState(false);

  const selectedBacklog = selectedBacklogId ? backlogs[selectedBacklogId] : null;

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
          <p className="text-sm">Select a list to view work items</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col"
      onClick={() => selectWorkItem(null)}
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
      <div className="flex-1 overflow-y-auto p-2">
        {rootWorkItems.length === 0 && !isAdding ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No work items in this list
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
    </div>
  );
}
