import { useAppStore } from '@/store/appStore';
import { ChevronRight, ChevronDown, GripVertical, FileText, Plus, Trash2 } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useMemo, useState, useRef, useEffect, useCallback } from 'react';

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
  const toggleExpand = useAppStore(s => s.toggleWorkItemExpand);
  const addWorkItem = useAppStore(s => s.addWorkItem);
  const deleteWorkItem = useAppStore(s => s.deleteWorkItem);
  const [isAdding, setIsAdding] = useState(false);

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

  if (!item) return null;

  const hasChildren = item.childrenIds.length > 0;

  // Build backlog label string
  const backlogLabels = Object.entries(item.backlogAssignments)
    .map(([, blId]) => backlogs[blId]?.name)
    .filter(Boolean)
    .join(', ');

  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: 50,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  return (
    <div
      ref={combinedRef}
      style={style}
      className="animate-fade-in-up"
      {...attributes}
    >
      <div
        className={`
          flex items-center gap-1.5 px-3 py-2 rounded-md
          transition-all duration-150 ease-out group
          hover:bg-muted border border-transparent hover:border-border
          ${isDragging ? 'shadow-lg bg-card' : ''}
          ${isOver && !isDragging ? 'drag-over' : ''}
        `}
        style={{ paddingLeft: `${depth * 20 + 12}px` }}
      >
        <div
          {...listeners}
          className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing transition-colors"
        >
          <GripVertical className="w-3.5 h-3.5" />
        </div>
        <button
          className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => hasChildren && toggleExpand(workItemId)}
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <FileText className="w-3.5 h-3.5 text-primary/50" />
          )}
        </button>
        <span className="text-sm truncate flex-1">
          {item.title}
          {backlogLabels && (
            <span className="text-muted-foreground text-xs ml-1">({backlogLabels})</span>
          )}
        </span>
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={() => setIsAdding(true)}
            title="Add child item"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            onClick={() => deleteWorkItem(workItemId)}
            title="Delete item"
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
  );
}

export function WorkItemTreePanel() {
  const selectedBacklogId = useAppStore(s => s.selectedBacklogId);
  const selectedTreeId = useAppStore(s => s.selectedTreeId);
  const workItems = useAppStore(s => s.workItems);
  const backlogs = useAppStore(s => s.backlogs);
  const addWorkItem = useAppStore(s => s.addWorkItem);
  const [isAdding, setIsAdding] = useState(false);

  const selectedBacklog = selectedBacklogId ? backlogs[selectedBacklogId] : null;

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
    <div className="h-full flex flex-col">
      <div className="p-4 pb-2 border-b flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{selectedBacklog?.name}</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {rootWorkItems.length} item{rootWorkItems.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={() => setIsAdding(true)}
          title="Add work item"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>
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
    </div>
  );
}
