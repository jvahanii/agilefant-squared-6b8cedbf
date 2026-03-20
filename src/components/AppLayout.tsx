import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import { useState, useCallback, useEffect } from 'react';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '@/components/ui/resizable';
import { BacklogTreePanel } from '@/components/BacklogTreePanel';
import { WorkItemTreePanel } from '@/components/WorkItemTreePanel';
import { useAppStore } from '@/store/appStore';
import { ActionPrompt } from '@/components/ActionPrompt';
import { Undo2, Keyboard } from 'lucide-react';
import agilefantLogo from '@/assets/agilefant-logo.png';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

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
  const [showShortcuts, setShowShortcuts] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      if (isInput) return;

      const state = useAppStore.getState();

      switch (e.key) {
        case 'N': {
          e.preventDefault();
          if (state.selectedWorkItemId) {
            window.dispatchEvent(new CustomEvent('shortcut:add-child-workitem'));
          } else if (state.selectedBacklogId) {
            window.dispatchEvent(new CustomEvent('shortcut:add-child-backlog'));
          }
          break;
        }
        case 'n': {
          e.preventDefault();
          if (state.selectedBacklogId && state.selectedTreeId) {
            window.dispatchEvent(new CustomEvent('shortcut:add-workitem'));
          }
          break;
        }
        case 'F2': {
          e.preventDefault();
          if (state.selectedWorkItemId) {
            window.dispatchEvent(new CustomEvent('shortcut:rename-workitem'));
          } else if (state.selectedBacklogId) {
            window.dispatchEvent(new CustomEvent('shortcut:rename-backlog'));
          }
          break;
        }
        case 'Delete':
        case 'Backspace': {
          if (state.selectedWorkItemId) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('shortcut:delete-selected'));
          } else if (state.selectedBacklogId) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent('shortcut:delete-selected'));
          }
          break;
        }
        case '?': {
          e.preventDefault();
          setShowShortcuts(s => !s);
          break;
        }
        case 'Escape': {
          if (state.selectedWorkItemId) {
            useAppStore.getState().selectWorkItem(null);
          }
          break;
        }
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
      moveWorkItemToBacklog(workItemId, targetBacklogId, targetTreeId);
      removeWorkItemFromTree(workItemId, sourceTreeId);
    } else if (value === 'add') {
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
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  onClick={() => setShowShortcuts(s => !s)}
                  title="Keyboard shortcuts (?)"
                >
                  <Keyboard className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
            </Tooltip>
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

      {showShortcuts && (
        <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />
      )}
    </DndContext>
  );
}

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const shortcuts = [
    { keys: ['N'], description: 'New root work item in selected list' },
    { keys: ['Shift', 'N'], description: 'New child of selected item or list' },
    { keys: ['Del'], description: 'Delete selected item or list' },
    { keys: ['F2'], description: 'Rename selected item or list' },
    { keys: ['Esc'], description: 'Deselect work item' },
    { keys: ['Ctrl', 'Z'], description: 'Undo last action' },
    { keys: ['?'], description: 'Toggle this help' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-card border rounded-lg shadow-2xl w-full max-w-sm mx-4 animate-fade-in-up overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold">Keyboard Shortcuts</h3>
        </div>
        <div className="px-5 pb-5 space-y-2.5">
          {shortcuts.map((s, i) => (
            <div key={i} className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{s.description}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((key, j) => (
                  <kbd
                    key={j}
                    className="px-1.5 py-0.5 rounded border bg-muted text-xs font-mono min-w-[24px] text-center"
                  >
                    {key}
                  </kbd>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
