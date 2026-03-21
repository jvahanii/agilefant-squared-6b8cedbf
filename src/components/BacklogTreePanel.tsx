import { useAppStore } from '@/store/appStore';
import { ChevronRight, ChevronDown, FolderKanban, Plus, Trash2 } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { useState, useRef, useEffect, useMemo } from 'react';

interface BacklogNodeProps {
  backlogId: string;
  depth: number;
}

function InlineInput({ onSubmit, onCancel, depth }: { onSubmit: (name: string) => void; onCancel: () => void; depth: number }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleSubmit = () => {
    const trimmed = value.trim();
    if (trimmed) onSubmit(trimmed);
    else onCancel();
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1" style={{ paddingLeft: `${depth * 16 + 28}px` }}>
      <FolderKanban className="w-4 h-4 shrink-0 text-primary/70" />
      <input
        ref={inputRef}
        className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-1 py-0.5 placeholder:text-muted-foreground/50"
        placeholder="Backlog name…"
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

/** Compute total points for a backlog (including descendant backlogs) */
function useBacklogPoints(backlogId: string, treeId: string) {
  const workItems = useAppStore(s => s.workItems);
  const backlogs = useAppStore(s => s.backlogs);

  return useMemo(() => {
    // Collect this backlog + all descendant backlog IDs
    const backlogIds = new Set<string>();
    const collectBacklogs = (id: string) => {
      backlogIds.add(id);
      backlogs[id]?.childrenIds.forEach(collectBacklogs);
    };
    collectBacklogs(backlogId);

    let total = 0;
    Object.values(workItems).forEach(wi => {
      if (wi.backlogAssignments[treeId] && backlogIds.has(wi.backlogAssignments[treeId])) {
        total += wi.points ?? 0;
      }
    });
    return total;
  }, [workItems, backlogs, backlogId, treeId]);
}

function BacklogNode({ backlogId, depth }: BacklogNodeProps) {
  const backlog = useAppStore(s => s.backlogs[backlogId]);
  const isSelected = useAppStore(s => s.selectedBacklogIds.includes(backlogId));
  const expanded = useAppStore(s => s.expandedBacklogs.has(backlogId));
  const toggleExpand = useAppStore(s => s.toggleBacklogExpand);
  const selectBacklog = useAppStore(s => s.selectBacklog);
  const addBacklog = useAppStore(s => s.addBacklog);
  const deleteBacklog = useAppStore(s => s.deleteBacklog);
  const [isAdding, setIsAdding] = useState(false);

  const { setNodeRef, isOver } = useDroppable({
    id: `backlog-drop-${backlogId}`,
    data: { type: 'backlog', backlogId, treeId: backlog?.treeId },
  });

  const totalPoints = useBacklogPoints(backlogId, backlog?.treeId ?? '');

  // Listen for keyboard shortcut events when this backlog is selected
  useEffect(() => {
    if (!isSelected) return;

    const handleAddBacklog = () => setIsAdding(true);
    const handleDeleteBacklog = () => deleteBacklog(backlogId);

    window.addEventListener('shortcut:add-child-backlog', handleAddBacklog);
    window.addEventListener('shortcut:delete-selected', handleDeleteBacklog);
    return () => {
      window.removeEventListener('shortcut:add-child-backlog', handleAddBacklog);
      window.removeEventListener('shortcut:delete-selected', handleDeleteBacklog);
    };
  }, [isSelected, backlogId, deleteBacklog]);

  if (!backlog) return null;

  const hasChildren = backlog.childrenIds.length > 0;

  return (
    <div className="animate-fade-in-up" style={{ animationDelay: `${depth * 40}ms` }}>
      <div
        ref={setNodeRef}
        className={`
          flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer
          transition-all duration-150 ease-out select-none group
          ${isSelected
            ? 'bg-selection/10 ring-1 ring-selection/40 text-foreground font-medium'
            : 'hover:bg-muted'}
          ${isOver ? 'drag-over' : ''}
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={(e) => selectBacklog(backlogId, backlog.treeId, e.ctrlKey || e.metaKey)}
      >
        <button
          className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          onClick={(e) => {
            e.stopPropagation();
            if (hasChildren) toggleExpand(backlogId);
          }}
        >
          {hasChildren ? (
            expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <span className="w-3.5" />
          )}
        </button>
        <FolderKanban className="w-4 h-4 shrink-0 text-primary/70" />
        <span className="text-sm truncate flex-1">{backlog.name}</span>
        {totalPoints > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0 group-hover:hidden">
            {totalPoints} pt{totalPoints !== 1 ? 's' : ''}
          </span>
        )}
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          {totalPoints > 0 && (
            <span className="text-xs tabular-nums text-muted-foreground mr-1">
              {totalPoints}
            </span>
          )}
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={(e) => { e.stopPropagation(); setIsAdding(true); }}
            title="Add child backlog (Shift+N)"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
          <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            onClick={(e) => { e.stopPropagation(); deleteBacklog(backlogId); }}
            title="Delete backlog (Del)"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
      {(expanded || isAdding) && (
        <div>
          {hasChildren && expanded && backlog.childrenIds.map(childId => (
            <BacklogNode key={childId} backlogId={childId} depth={depth + 1} />
          ))}
          {isAdding && (
            <InlineInput
              depth={depth + 1}
              onSubmit={(name) => { addBacklog(name, backlogId, backlog.treeId); setIsAdding(false); }}
              onCancel={() => setIsAdding(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function BacklogTreePanel() {
  const backlogTrees = useAppStore(s => s.backlogTrees);
  const addBacklog = useAppStore(s => s.addBacklog);
  const [addingToTree, setAddingToTree] = useState<string | null>(null);

  return (
    <div className="h-full flex flex-col bg-sidebar">
      <div className="p-4 pb-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Backlog Trees
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {Object.values(backlogTrees).map(tree => (
          <div key={tree.id} className="mb-4">
            <div className="px-2 py-1 flex items-center justify-between group">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {tree.name}
              </span>
              <button
                className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-all"
                onClick={() => setAddingToTree(tree.id)}
                title="Add root backlog"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
            {tree.rootBacklogIds.map(backlogId => (
              <BacklogNode key={backlogId} backlogId={backlogId} depth={0} />
            ))}
            {addingToTree === tree.id && (
              <InlineInput
                depth={0}
                onSubmit={(name) => { addBacklog(name, null, tree.id); setAddingToTree(null); }}
                onCancel={() => setAddingToTree(null)}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
