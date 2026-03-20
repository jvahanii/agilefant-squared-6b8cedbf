import { useAppStore } from '@/store/appStore';
import { ChevronRight, ChevronDown, GripVertical, FileText } from 'lucide-react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useMemo } from 'react';

interface WorkItemNodeProps {
  workItemId: string;
  depth: number;
  treeId: string;
}

function WorkItemNode({ workItemId, depth, treeId }: WorkItemNodeProps) {
  const item = useAppStore(s => s.workItems[workItemId]);
  const expanded = useAppStore(s => s.expandedWorkItems.has(workItemId));
  const toggleExpand = useAppStore(s => s.toggleWorkItemExpand);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `workitem-${workItemId}`,
    data: { type: 'workitem', workItemId, treeId },
  });

  if (!item) return null;

  const hasChildren = item.childrenIds.length > 0;

  const style = transform ? {
    transform: CSS.Translate.toString(transform),
    zIndex: 50,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  return (
    <div
      ref={setNodeRef}
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
        <span className="text-sm truncate">{item.title}</span>
        {hasChildren && (
          <span className="text-xs text-muted-foreground ml-auto tabular-nums">
            {item.childrenIds.length}
          </span>
        )}
      </div>
      {expanded && hasChildren && (
        <div className="relative">
          <div
            className="absolute tree-line"
            style={{ left: `${depth * 20 + 24}px`, top: 0, bottom: 0 }}
          />
          {item.childrenIds.map(childId => (
            <WorkItemNode key={childId} workItemId={childId} depth={depth + 1} treeId={treeId} />
          ))}
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
      <div className="p-4 pb-2 border-b">
        <h2 className="text-base font-semibold">{selectedBacklog?.name}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          {rootWorkItems.length} item{rootWorkItems.length !== 1 ? 's' : ''}
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {rootWorkItems.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            No work items in this backlog
          </div>
        ) : (
          rootWorkItems.map(item => (
            <WorkItemNode key={item.id} workItemId={item.id} depth={0} treeId={selectedTreeId} />
          ))
        )}
      </div>
    </div>
  );
}
