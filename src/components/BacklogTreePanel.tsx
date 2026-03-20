import { useAppStore } from '@/store/appStore';
import { ChevronRight, ChevronDown, FolderKanban, Plus, Trash2, LayoutList } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { useState, useRef, useEffect, useMemo } from 'react';

interface BacklogNodeProps {
  backlogId: string;
  depth: number;
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
        placeholder="List name…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={handleSubmit} />
      
    </div>);

}

/** Compute total points for a list (including descendant lists) */
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

    let total = 0;
    Object.values(workItems).forEach((wi) => {
      if (wi.backlogAssignments[treeId] && backlogIds.has(wi.backlogAssignments[treeId])) {
        total += wi.points ?? 0;
      }
    });
    return total;
  }, [workItems, backlogs, backlogId, treeId]);
}

function BacklogNode({ backlogId, depth }: BacklogNodeProps) {
  const backlog = useAppStore((s) => s.backlogs[backlogId]);
  const selectedBacklogId = useAppStore((s) => s.selectedBacklogId);
  const expanded = useAppStore((s) => s.expandedBacklogs.has(backlogId));
  const toggleExpand = useAppStore((s) => s.toggleBacklogExpand);
  const selectBacklog = useAppStore((s) => s.selectBacklog);
  const addBacklog = useAppStore((s) => s.addBacklog);
  const deleteBacklog = useAppStore((s) => s.deleteBacklog);
  const renameBacklog = useAppStore((s) => s.renameBacklog);
  const [isAdding, setIsAdding] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const { setNodeRef, isOver } = useDroppable({
    id: `backlog-drop-${backlogId}`,
    data: { type: 'backlog', backlogId, treeId: backlog?.treeId }
  });

  const totalPoints = useBacklogPoints(backlogId, backlog?.treeId ?? '');

  useEffect(() => {
    if (selectedBacklogId !== backlogId) return;

    const handleAddBacklog = () => setIsAdding(true);
    const handleDeleteBacklog = () => deleteBacklog(backlogId);
    const handleRename = () => startRename();

    window.addEventListener('shortcut:add-child-backlog', handleAddBacklog);
    window.addEventListener('shortcut:delete-selected', handleDeleteBacklog);
    window.addEventListener('shortcut:rename-backlog', handleRename);
    return () => {
      window.removeEventListener('shortcut:add-child-backlog', handleAddBacklog);
      window.removeEventListener('shortcut:delete-selected', handleDeleteBacklog);
      window.removeEventListener('shortcut:rename-backlog', handleRename);
    };
  }, [selectedBacklogId, backlogId, deleteBacklog]);

  useEffect(() => {
    if (isRenaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [isRenaming]);

  if (!backlog) return null;

  const hasChildren = backlog.childrenIds.length > 0;
  const isSelected = selectedBacklogId === backlogId;

  const startRename = () => {
    setRenameValue(backlog.name);
    setIsRenaming(true);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== backlog.name) {
      renameBacklog(backlogId, trimmed);
    }
    setIsRenaming(false);
  };

  return (
    <div className="animate-fade-in-up" style={{ animationDelay: `${depth * 40}ms` }}>
      <div
        ref={setNodeRef}
        className={`
          flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer
          transition-all duration-150 ease-out select-none group
          ${isSelected ?
        'bg-[hsl(var(--selection)/0.10)] ring-1 ring-[hsl(var(--selection)/0.40)] text-foreground font-medium' :
        'hover:bg-muted'}
          ${isOver ? 'drag-over' : ''}
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => selectBacklog(backlogId, backlog.treeId)}
        onDoubleClick={(e) => {e.stopPropagation();startRename();}}>
        
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
        {isRenaming ?
        <input
          ref={renameRef}
          className="flex-1 text-sm bg-transparent border-b border-[hsl(var(--selection))] outline-none px-1 py-0.5"
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitRename();
            if (e.key === 'Escape') setIsRenaming(false);
          }}
          onBlur={commitRename}
          onClick={(e) => e.stopPropagation()} /> :


        <span className="text-sm truncate flex-1">{backlog.name}</span>
        }
        {totalPoints > 0 && !isRenaming &&
        <span className="text-xs tabular-nums text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0 group-hover:hidden">
            {totalPoints} pt{totalPoints !== 1 ? 's' : ''}
          </span>
        }
        {!isRenaming &&
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            {totalPoints > 0 &&
          <span className="text-xs tabular-nums text-muted-foreground mr-1">
                {totalPoints}
              </span>
          }
            <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={(e) => {e.stopPropagation();setIsAdding(true);}}
            title="Add child list (Shift+N)">
            
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
            className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            onClick={(e) => {e.stopPropagation();deleteBacklog(backlogId);}}
            title="Delete list (Del)">
            
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        }
      </div>
      {(expanded || isAdding) &&
      <div>
          {hasChildren && expanded && backlog.childrenIds.map((childId) =>
        <BacklogNode key={childId} backlogId={childId} depth={depth + 1} />
        )}
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

function TreeHeader({ treeId }: { treeId: string }) {
  const tree = useAppStore((s) => s.backlogTrees[treeId]);
  const renameBacklogTree = useAppStore((s) => s.renameBacklogTree);
  const deleteBacklogTree = useAppStore((s) => s.deleteBacklogTree);
  const addBacklog = useAppStore((s) => s.addBacklog);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isRenaming) {
      renameRef.current?.focus();
      renameRef.current?.select();
    }
  }, [isRenaming]);

  const startRename = () => {
    setRenameValue(tree?.name ?? '');
    setIsRenaming(true);
  };

  const commitRename = () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== tree?.name) {
      renameBacklogTree(treeId, trimmed);
    }
    setIsRenaming(false);
  };

  return (
    <div className="mb-4">
      <div className="px-2 py-1 flex items-center justify-between group" onDoubleClick={startRename}>
        {isRenaming ? (
          <input
            ref={renameRef}
            className="text-xs font-semibold uppercase tracking-wide bg-transparent border-b border-[hsl(var(--selection))] outline-none px-1 py-0.5 flex-1"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setIsRenaming(false);
            }}
            onBlur={commitRename}
          />
        ) : (
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {tree?.name}
          </span>
        )}
        {!isRenaming && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-all">
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              onClick={() => setIsAdding(true)}
              title="Add root list"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              onClick={() => deleteBacklogTree(treeId)}
              title="Delete list tree"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
      {tree?.rootBacklogIds.map((backlogId) => (
        <BacklogNode key={backlogId} backlogId={backlogId} depth={0} />
      ))}
      {isAdding && (
        <InlineInput
          depth={0}
          onSubmit={(n) => { addBacklog(n, null, treeId); setIsAdding(false); }}
          onCancel={() => setIsAdding(false)}
        />
      )}
    </div>
  );
}

export function BacklogTreePanel() {
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const addBacklogTree = useAppStore((s) => s.addBacklogTree);
  const [isAddingTree, setIsAddingTree] = useState(false);
  const [newTreeName, setNewTreeName] = useState('');
  const newTreeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAddingTree) {
      newTreeRef.current?.focus();
    }
  }, [isAddingTree]);

  const commitNewTree = () => {
    const trimmed = newTreeName.trim();
    if (trimmed) addBacklogTree(trimmed);
    setNewTreeName('');
    setIsAddingTree(false);
  };

  return (
    <div className="h-full flex flex-col bg-sidebar">
      <div className="p-4 pb-2 flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">List Trees</span>
        <button
          className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          onClick={() => setIsAddingTree(true)}
          title="Add list tree"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {Object.values(backlogTrees).map((tree) => (
          <TreeHeader key={tree.id} treeId={tree.id} />
        ))}
        {isAddingTree && (
          <div className="px-2 py-1 flex items-center gap-1.5">
            <LayoutList className="w-4 h-4 shrink-0 text-muted-foreground" />
            <input
              ref={newTreeRef}
              className="flex-1 text-xs font-semibold uppercase tracking-wide bg-transparent border-b border-primary/40 outline-none px-1 py-0.5 placeholder:text-muted-foreground/50"
              placeholder="Tree name…"
              value={newTreeName}
              onChange={(e) => setNewTreeName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitNewTree();
                if (e.key === 'Escape') { setNewTreeName(''); setIsAddingTree(false); }
              }}
              onBlur={commitNewTree}
            />
          </div>
        )}
      </div>
    </div>
  );
}