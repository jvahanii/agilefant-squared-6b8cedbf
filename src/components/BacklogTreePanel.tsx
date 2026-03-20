import { useAppStore } from '@/store/appStore';
import { ChevronRight, ChevronDown, FolderKanban } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';

interface BacklogNodeProps {
  backlogId: string;
  depth: number;
}

function BacklogNode({ backlogId, depth }: BacklogNodeProps) {
  const backlog = useAppStore(s => s.backlogs[backlogId]);
  const selectedBacklogId = useAppStore(s => s.selectedBacklogId);
  const expanded = useAppStore(s => s.expandedBacklogs.has(backlogId));
  const toggleExpand = useAppStore(s => s.toggleBacklogExpand);
  const selectBacklog = useAppStore(s => s.selectBacklog);

  const { setNodeRef, isOver } = useDroppable({
    id: `backlog-drop-${backlogId}`,
    data: { type: 'backlog', backlogId, treeId: backlog.treeId },
  });

  if (!backlog) return null;

  const hasChildren = backlog.childrenIds.length > 0;
  const isSelected = selectedBacklogId === backlogId;

  return (
    <div className="animate-fade-in-up" style={{ animationDelay: `${depth * 40}ms` }}>
      <div
        ref={setNodeRef}
        className={`
          flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer
          transition-all duration-150 ease-out select-none group
          ${isSelected ? 'bg-accent text-accent-foreground font-medium' : 'hover:bg-muted'}
          ${isOver ? 'drag-over' : ''}
        `}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={() => selectBacklog(backlogId, backlog.treeId)}
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
        <span className="text-sm truncate">{backlog.name}</span>
      </div>
      {expanded && hasChildren && (
        <div>
          {backlog.childrenIds.map(childId => (
            <BacklogNode key={childId} backlogId={childId} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function BacklogTreePanel() {
  const backlogTrees = useAppStore(s => s.backlogTrees);

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
            <div className="px-2 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {tree.name}
            </div>
            {tree.rootBacklogIds.map(backlogId => (
              <BacklogNode key={backlogId} backlogId={backlogId} depth={0} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
