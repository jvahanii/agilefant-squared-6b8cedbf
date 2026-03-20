import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useState, useCallback, useEffect } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { BacklogTreePanel } from '@/components/BacklogTreePanel';
import { WorkItemTreePanel } from '@/components/WorkItemTreePanel';
import { useAppStore } from '@/store/appStore';
import { ActionPrompt } from '@/components/ActionPrompt';
import { Undo2 } from 'lucide-react';
import agilefantLogo from '@/assets/agilefant-logo.png';

interface PendingCrossTreeDrop {
  workItemId: string;
  targetBacklogId: string;
  targetTreeId: string;
  sourceTreeId: string;
  itemTitle: string;
  sourceTreeName: string;
  targetTreeName: string;
}

export default function AppLayout() {
  const moveWorkItemToBacklog = useAppStore(s => s.moveWorkItemToBacklog);
  const removeWorkItemFromTree = useAppStore(s => s.removeWorkItemFromTree);
  const reparentWorkItem = useAppStore(s => s.reparentWorkItem);
  const undo = useAppStore(s => s.undo);
  const undoStackLength = useAppStore(s => s.undoStack.length);
  const [activeDrag, setActiveDrag] = useState<{ id: string; type: string; title: string } | null>(null);
  const [pendingCrossTree, setPendingCrossTree] = useState<PendingCrossTreeDrop | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === 'workitem') {
      const store = useAppStore.getState();
      const item = store.workItems[data.workItemId];
      setActiveDrag({ id: data.workItemId, type: 'workitem', title: item?.title ?? '' });
    }
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;

    if (activeData?.type === 'workitem' && overData?.type === 'backlog') {
      const sourceTreeId = activeData.treeId as string;
      const targetTreeId = overData.treeId as string;

      if (sourceTreeId !== targetTreeId) {
        // Cross-tree drop — prompt move vs add
        const store = useAppStore.getState();
        const item = store.workItems[activeData.workItemId];
        const sourceTree = store.backlogTrees[sourceTreeId];
        const targetTree = store.backlogTrees[targetTreeId];
        setPendingCrossTree({
          workItemId: activeData.workItemId,
          targetBacklogId: overData.backlogId,
          targetTreeId,
          sourceTreeId,
          itemTitle: item?.title ?? '',
          sourceTreeName: sourceTree?.name ?? sourceTreeId,
          targetTreeName: targetTree?.name ?? targetTreeId,
        });
      } else {
        moveWorkItemToBacklog(activeData.workItemId, overData.backlogId, overData.treeId);
      }
    } else if (activeData?.type === 'workitem' && overData?.type === 'workitem-parent') {
      if (activeData.workItemId !== overData.workItemId) {
        reparentWorkItem(activeData.workItemId, overData.workItemId, overData.treeId, overData.backlogId);
      }
    }
  }, [moveWorkItemToBacklog, reparentWorkItem]);

  const handleCrossTreeChoice = useCallback((value: string) => {
    if (!pendingCrossTree) return;
    const { workItemId, targetBacklogId, targetTreeId, sourceTreeId } = pendingCrossTree;

    if (value === 'move') {
      // Move: assign to target tree, remove from source tree
      moveWorkItemToBacklog(workItemId, targetBacklogId, targetTreeId);
      removeWorkItemFromTree(workItemId, sourceTreeId);
    } else if (value === 'add') {
      // Add: assign to target tree, keep source
      moveWorkItemToBacklog(workItemId, targetBacklogId, targetTreeId);
    }
    setPendingCrossTree(null);
  }, [pendingCrossTree, moveWorkItemToBacklog, removeWorkItemFromTree]);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-screen flex flex-col">
        <header className="h-12 border-b flex items-center px-4 gap-3 bg-card shrink-0">
          <img src={agilefantLogo} alt="Agilefant" className="h-7 w-7" />
          <h1 className="text-sm font-bold tracking-tight">
            Agilefant<sup className="text-xs text-primary">2</sup>
          </h1>
          <div className="ml-auto flex items-center gap-1">
            <button
              className={`
                w-8 h-8 flex items-center justify-center rounded-md transition-colors
                ${undoStackLength > 0
                  ? 'text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer'
                  : 'text-muted-foreground/30 cursor-not-allowed'}
              `}
              onClick={undo}
              disabled={undoStackLength === 0}
              title="Undo (Ctrl+Z)"
            >
              <Undo2 className="w-4 h-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
              <BacklogTreePanel />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={70} minSize={40}>
              <WorkItemTreePanel />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      </div>

      <DragOverlay>
        {activeDrag && (
          <div className="bg-card border shadow-xl rounded-md px-3 py-2 text-sm font-medium max-w-64 truncate">
            {activeDrag.title}
          </div>
        )}
      </DragOverlay>

      {pendingCrossTree && (
        <ActionPrompt
          title={`Move "${pendingCrossTree.itemTitle}" to ${pendingCrossTree.targetTreeName}`}
          options={[
            {
              label: 'Move item',
              description: `Remove from "${pendingCrossTree.sourceTreeName}" and place in "${pendingCrossTree.targetTreeName}".`,
              value: 'move',
              isDefault: true,
            },
            {
              label: 'Add to both',
              description: `Keep in "${pendingCrossTree.sourceTreeName}" and also add to "${pendingCrossTree.targetTreeName}".`,
              value: 'add',
            },
          ]}
          onSelect={handleCrossTreeChoice}
          onCancel={() => setPendingCrossTree(null)}
        />
      )}
    </DndContext>
  );
}
