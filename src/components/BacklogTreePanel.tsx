import { useAppStore } from '@/store/appStore';
import { ChevronRight, ChevronDown, FolderKanban, Plus, Trash2, GripVertical } from 'lucide-react';
import { useDroppable, useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';

interface BacklogNodeProps {
  backlogId: string;
  depth: number;
  index: number;
  parentId: string | null;
  treeId: string;
}

function InlineInput({ onSubmit, onCancel, depth }: {onSubmit: (name: string) => void;onCancel: () => void;depth: number;}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {inputRef.current?.focus();}, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);else
    onCancel();
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${depth * 16 + 28}px` }}>
      <FolderKanban className="w-4 h-4 shrink-0 text-primary/70" />
      <input
        ref={inputRef}
        className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-1 py-0.5 placeholder:text-muted-foreground/50"
        placeholder="Backlog name…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={handleSubmit} />
    </div>);
}

function BacklogReorderDropZone({ id, index, parentId, treeId, depth

}: {id: string;index: number;parentId: string | null;treeId: string;depth: number;}) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: 'backlog-reorder', index, parentId, treeId }
  });

  return (
    <div
      ref={setNodeRef}
      className="relative py-0.5"
      style={{ marginLeft: `${depth * 16 + 8}px` }}>
      
      <div className={`h-0.5 rounded-full transition-all ${isOver ? 'bg-selection' : ''}`} />
    </div>);

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

    const getEffectivePoints = (wi: typeof workItems[string]): number => {
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
        const parentInSet = wi.parentId && workItems[wi.parentId] &&
        backlogIds.has(workItems[wi.parentId].backlogAssignments[treeId]);
        if (!parentInSet) {
          total += getEffectivePoints(wi);
        }
      }
    });
    return total;
  }, [workItems, backlogs, backlogId, treeId]);
}

function BacklogNode({ backlogId, depth, index, parentId, treeId }: BacklogNodeProps) {
  const backlog = useAppStore((s) => s.backlogs[backlogId]);
  const isSelected = useAppStore((s) => s.selectedBacklogIds.includes(backlogId));
  const expanded = useAppStore((s) => s.expandedBacklogs.has(backlogId));
  const toggleExpand = useAppStore((s) => s.toggleBacklogExpand);
  const selectBacklog = useAppStore((s) => s.selectBacklog);
  const addBacklog = useAppStore((s) => s.addBacklog);
  const deleteBacklog = useAppStore((s) => s.deleteBacklog);
  const renameBacklog = useAppStore((s) => s.renameBacklog);
  const [isAdding, setIsAdding] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const editRef = useRef<HTMLInputElement>(null);
  const dragStartedRef = useRef(false);

  // Draggable for rearranging
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: `backlog-drag-${backlogId}`,
    data: { type: 'backlog-node', backlogId, treeId: backlog?.treeId, parentId }
  });

  // Droppable for work items AND for reparenting backlogs onto this node
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `backlog-drop-${backlogId}`,
    data: { type: 'backlog', backlogId, treeId: backlog?.treeId }
  });

  const combinedRef = useCallback((node: HTMLDivElement | null) => {
    setDragRef(node);
    setDropRef(node);
  }, [setDragRef, setDropRef]);

  const totalPoints = useBacklogPoints(backlogId, backlog?.treeId ?? '');

  useEffect(() => {
    if (isEditing) {
      editRef.current?.focus();
      editRef.current?.select();
    }
  }, [isEditing]);

  useEffect(() => {
    if (!isSelected) return;

    const handleAddBacklog = () => setIsAdding(true);
    const handleDeleteBacklog = () => {
      if (useAppStore.getState().selectedWorkItemIds.length > 0) return;
      deleteBacklog(backlogId);
    };

    window.addEventListener('shortcut:add-child-backlog', handleAddBacklog);
    window.addEventListener('shortcut:delete-selected', handleDeleteBacklog);
    return () => {
      window.removeEventListener('shortcut:add-child-backlog', handleAddBacklog);
      window.removeEventListener('shortcut:delete-selected', handleDeleteBacklog);
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
        ...(transform ? { transform: CSS.Translate.toString(transform), zIndex: 50, opacity: isDragging ? 0.5 : 1 } : {})
      }}>
      
      <div
        ref={combinedRef}
        {...attributes}
        {...listeners}
        className={`
          flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-grab active:cursor-grabbing
          transition-all duration-150 ease-out select-none group touch-none
          ${isSelected ?
        'bg-selection/10 ring-1 ring-selection/40 text-foreground font-medium' :
        'hover:bg-muted'}
          ${isOver && !isDragging ? 'drag-over' : ''}
          ${isDragging ? 'shadow-lg bg-card' : ''}
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onPointerDown={(e) => {
          dragStartedRef.current = false;
          listeners?.onPointerDown?.(e);
        }}
        onPointerMove={() => {
          dragStartedRef.current = true;
        }}
        onClick={(e) => {
          if (dragStartedRef.current) return;
          selectBacklog(backlogId, backlog.treeId, e.ctrlKey || e.metaKey);
        }}>
        
        <div className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground/40">
          <GripVertical className="w-3 h-3" />
        </div>
        <button
          className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggleExpand(backlogId);
          }}>
          {hasChildren ?
          expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" /> :
          <span className="w-3.5" />
          }
        </button>
        <FolderKanban className="w-4 h-4 shrink-0 text-primary/70" />
        {isEditing ?
        <input
          ref={editRef}
          className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-0.5 py-0 min-w-0"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitEdit();
            if (e.key === 'Escape') setIsEditing(false);
            e.stopPropagation();
          }}
          onBlur={commitEdit}
          onClick={(e) => e.stopPropagation()} /> :

        <span
          className="text-sm truncate flex-1"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEditing();
          }}>
            {backlog.name}
          </span>
        }
        {totalPoints > 0 &&
        <span className="text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0 group-hover:hidden">
            {totalPoints} pt{totalPoints !== 1 ? 's' : ''}
          </span>
        }
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          {totalPoints > 0 &&
          <span className="text-xs tabular-nums text-muted-foreground mr-1">
              {totalPoints}
            </span>
          }
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={(e) => {e.stopPropagation();setIsAdding(true);}}
            title="Add child backlog (Shift+Enter)">
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            onClick={(e) => {e.stopPropagation();deleteBacklog(backlogId);}}
            title="Delete backlog (Del)">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {(expanded || isAdding) &&
      <div>
          {hasChildren && expanded && backlog.childrenIds.map((childId, i) =>
        <div key={childId}>
              <BacklogReorderDropZone
            id={`backlog-reorder-${backlogId}-${i}`}
            index={i}
            parentId={backlogId}
            treeId={backlog.treeId}
            depth={depth + 1} />
          
              <BacklogNode backlogId={childId} depth={depth + 1} index={i} parentId={backlogId} treeId={backlog.treeId} />
            </div>
        )}
          {hasChildren && expanded &&
        <BacklogReorderDropZone
          id={`backlog-reorder-${backlogId}-${backlog.childrenIds.length}`}
          index={backlog.childrenIds.length}
          parentId={backlogId}
          treeId={backlog.treeId}
          depth={depth + 1} />

        }
          {isAdding &&
        <InlineInput
          depth={depth + 1}
          onSubmit={(name) => {addBacklog(name, backlogId, backlog.treeId);setIsAdding(false);}}
          onCancel={() => setIsAdding(false)} />
        }
        </div>
      }
    </div>);
}

function EditableTreeName({ treeId, name }: {treeId: string;name: string;}) {
  const renameBacklogTree = useAppStore((s) => s.renameBacklogTree);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {inputRef.current?.focus();inputRef.current?.select();}
  }, [isEditing]);

  const startEditing = () => {setEditValue(name);setIsEditing(true);};
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
          if (e.key === 'Enter') commitEdit();
          if (e.key === 'Escape') setIsEditing(false);
          e.stopPropagation();
        }}
        onBlur={commitEdit}
        onClick={(e) => e.stopPropagation()} />);
  }

  return (
    <span
      className="text-xs text-muted-foreground uppercase tracking-wide cursor-text hover:text-foreground transition-colors font-medium"
      onDoubleClick={startEditing}>
      {name}
    </span>);
}

function TreeReorderDropZone({ id, index }: { id: string; index: number }) {
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: 'tree-reorder', index }
  });

  return (
    <div ref={setNodeRef} className="relative py-0.5 mx-2">
      <div className={`h-0.5 rounded-full transition-all ${isOver ? 'bg-selection' : ''}`} />
    </div>
  );
}

function DraggableTreeHeader({ tree, onAddBacklog, onDeleteTree }: {
  tree: { id: string; name: string; rank: number; rootBacklogIds: string[] };
  onAddBacklog: () => void;
  onDeleteTree: () => void;
}) {
  const dragStartedRef = useRef(false);
  const { attributes, listeners, setNodeRef: setDragRef, transform, isDragging } = useDraggable({
    id: `tree-drag-${tree.id}`,
    data: { type: 'tree-node', treeId: tree.id }
  });

  return (
    <div
      ref={setDragRef}
      {...attributes}
      {...listeners}
      className={`px-2 py-1 flex items-center justify-between group cursor-grab active:cursor-grabbing touch-none select-none
        ${isDragging ? 'opacity-50' : ''}`}
      style={transform ? { transform: CSS.Translate.toString(transform), zIndex: 50 } : undefined}
      onPointerDown={(e) => {
        dragStartedRef.current = false;
        listeners?.onPointerDown?.(e);
      }}
      onPointerMove={() => { dragStartedRef.current = true; }}>
      <div className="flex items-center gap-1.5">
        <GripVertical className="w-3 h-3 text-muted-foreground/40 shrink-0" />
        <EditableTreeName treeId={tree.id} name={tree.name} />
      </div>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={(e) => { e.stopPropagation(); onAddBacklog(); }}
          title="Add root backlog">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
          onClick={(e) => { e.stopPropagation(); onDeleteTree(); }}
          title="Delete backlog tree">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
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

  const sortedTrees = useMemo(
    () => Object.values(backlogTrees).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
    [backlogTrees]
  );

  return (
    <div className="h-full flex flex-col bg-sidebar">
      <div className="p-4 pb-2 flex items-center justify-between">
        <h2 className="text-xs uppercase tracking-wider text-muted-foreground font-extrabold">BACKLOGS</h2>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={() => setIsAddingTree(true)}
          title="Add backlog tree">
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {isAddingTree &&
          <div className="mb-4 px-2">
            <InlineInput
              depth={0}
              onSubmit={(name) => { addBacklogTree(name); setIsAddingTree(false); }}
              onCancel={() => setIsAddingTree(false)} />
          </div>
        }
        {sortedTrees.map((tree, treeIndex) =>
        <div key={tree.id} className="mb-4">
            <TreeReorderDropZone id={`tree-reorder-${treeIndex}`} index={treeIndex} />
            <DraggableTreeHeader
              tree={tree}
              onAddBacklog={() => setAddingToTree(tree.id)}
              onDeleteTree={() => deleteBacklogTree(tree.id)} />
            {tree.rootBacklogIds.map((backlogId, i) =>
          <div key={backlogId}>
                <BacklogReorderDropZone
              id={`backlog-reorder-root-${tree.id}-${i}`}
              index={i}
              parentId={null}
              treeId={tree.id}
              depth={0} />
                <BacklogNode backlogId={backlogId} depth={0} index={i} parentId={null} treeId={tree.id} />
              </div>
          )}
            <BacklogReorderDropZone
            id={`backlog-reorder-root-${tree.id}-${tree.rootBacklogIds.length}`}
            index={tree.rootBacklogIds.length}
            parentId={null}
            treeId={tree.id}
            depth={0} />
            {addingToTree === tree.id &&
          <InlineInput
            depth={0}
            onSubmit={(name) => {addBacklog(name, null, tree.id);setAddingToTree(null);}}
            onCancel={() => setAddingToTree(null)} />
          }
          </div>
        )}
        <TreeReorderDropZone id={`tree-reorder-${sortedTrees.length}`} index={sortedTrees.length} />
      </div>
    </div>);
}