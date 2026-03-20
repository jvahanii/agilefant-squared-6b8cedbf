import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useState, useCallback, useEffect } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { BacklogTreePanel } from '@/components/BacklogTreePanel';
import { WorkItemTreePanel } from '@/components/WorkItemTreePanel';
import { useAppStore } from '@/store/appStore';
import { Undo2 } from 'lucide-react';
import agilefantLogo from '@/assets/agilefant-logo.png';

export default function AppLayout() {
  const moveWorkItemToBacklog = useAppStore(s => s.moveWorkItemToBacklog);
  const reparentWorkItem = useAppStore(s => s.reparentWorkItem);
  const undo = useAppStore(s => s.undo);
  const undoStackLength = useAppStore(s => s.undoStack.length);
  const [activeDrag, setActiveDrag] = useState<{ id: string; type: string; title: string } | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Ctrl+Z / Cmd+Z keyboard shortcut
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
      moveWorkItemToBacklog(activeData.workItemId, overData.backlogId, overData.treeId);
    } else if (activeData?.type === 'workitem' && overData?.type === 'workitem-parent') {
      // Reparent: drop a work item onto another work item to make it a child
      if (activeData.workItemId !== overData.workItemId) {
        reparentWorkItem(activeData.workItemId, overData.workItemId, overData.treeId, overData.backlogId);
      }
    }
  }, [moveWorkItemToBacklog, reparentWorkItem]);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-screen flex flex-col">
        {/* Header */}
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

        {/* Main content */}
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
    </DndContext>
  );
}
