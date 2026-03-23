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
  workItemIds: string[];
  totalCount: number;
  targetBacklogId: string;
  targetTreeId: string;
  sourceTreeId: string;
  itemTitles: string[];
  sourceTreeName: string;
  targetTreeName: string;
}

export default function AppLayout() {
  const moveWorkItemToBacklog = useAppStore((s) => s.moveWorkItemToBacklog);
  const reorderBacklogAmongSiblings = useAppStore((s) => s.reorderBacklogAmongSiblings);
  const moveBacklog = useAppStore((s) => s.moveBacklog);
  const removeWorkItemFromTree = useAppStore((s) => s.removeWorkItemFromTree);
  const reparentWorkItem = useAppStore((s) => s.reparentWorkItem);
  const reorderWorkItemAmongSiblings = useAppStore((s) => s.reorderWorkItemAmongSiblings);
  const reorderBacklogTree = useAppStore((s) => s.reorderBacklogTree);
  const undo = useAppStore((s) => s.undo);
  const undoStackLength = useAppStore((s) => s.undoStack.length);
  const [activeDrag, setActiveDrag] = useState<{id: string;type: string;title: string;} | null>(null);
  const [pendingCrossTree, setPendingCrossTree] = useState<PendingCrossTreeDrop | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Ctrl+Z always works
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }

      // Don't fire shortcuts when typing in inputs
      if (isInput) return;

      const state = useAppStore.getState();

      switch (e.key) {
        case 'N':{
            e.preventDefault();
            if (state.selectedWorkItemIds.length > 0) {
              window.dispatchEvent(new CustomEvent('shortcut:add-child-workitem'));
            } else if (state.selectedBacklogIds.length > 0) {
              window.dispatchEvent(new CustomEvent('shortcut:add-child-backlog'));
            }
            break;
          }
        case 'n':{
            e.preventDefault();
            if (state.selectedBacklogIds.length > 0 && state.selectedTreeId) {
              window.dispatchEvent(new CustomEvent('shortcut:add-workitem'));
            }
            break;
          }
        case 'Delete':
        case 'Backspace':{
            if (state.selectedWorkItemIds.length > 0 || state.selectedBacklogIds.length > 0) {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent('shortcut:delete-selected'));
            }
            break;
          }
        case '?':{
            e.preventDefault();
            setShowShortcuts((s) => !s);
            break;
          }
        case 'Escape':{
            if (state.selectedWorkItemIds.length > 0) {
              useAppStore.getState().clearWorkItemSelection();
            }
            break;
          }
        case 'ArrowUp':
        case 'ArrowDown':{
            if (state.selectedWorkItemIds.length === 1 && state.selectedTreeId && state.selectedBacklogIds.length > 0) {
              e.preventDefault();
              const wiId = state.selectedWorkItemIds[0];
              const wi = state.workItems[wiId];
              if (!wi) break;
              const treeId = state.selectedTreeId;
              const selectedBacklogId = state.selectedBacklogIds[0];

              // Collect selected backlog + all descendant backlog IDs
              const backlogIds: string[] = [];
              const collectBacklogs = (id: string) => {
                backlogIds.push(id);
                state.backlogs[id]?.childrenIds.forEach(collectBacklogs);
              };
              collectBacklogs(selectedBacklogId);

              // Get siblings
              const backlogIdSet = new Set(backlogIds);
              const siblings = Object.values(state.workItems).
              filter((w) => {
                if (!backlogIdSet.has(w.backlogAssignments[treeId])) return false;
                if (wi.parentId === null) {
                  return w.parentId === null || !state.workItems[w.parentId] || !backlogIdSet.has(state.workItems[w.parentId].backlogAssignments[treeId]);
                }
                return w.parentId === wi.parentId;
              }).
              sort((a, b) => a.rank - b.rank);

              const idx = siblings.findIndex((s) => s.id === wiId);
              if (idx === -1) break;
              const newIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
              if (newIdx < 0 || newIdx >= siblings.length) break;
              useAppStore.getState().reorderWorkItemAmongSiblings(wiId, newIdx, treeId, backlogIds);
            }
            break;
          }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo]);

  const countWithDescendants = useCallback((ids: string[]) => {
    const store = useAppStore.getState();
    const seen = new Set<string>();
    const collect = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      store.workItems[id]?.childrenIds.forEach(collect);
    };
    ids.forEach(collect);
    return seen.size;
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    if (data?.type === 'workitem') {
      const store = useAppStore.getState();
      const ids: string[] = data.selectedIds ?? [data.workItemId];
      const totalCount = countWithDescendants(ids);
      const titles = ids.map((id) => store.workItems[id]?.title ?? '').filter(Boolean);
      const title = totalCount > 1 ? `${titles[0]} (+${totalCount - 1} more)` : titles[0] ?? '';
      setActiveDrag({ id: data.workItemId, type: 'workitem', title });
    } else if (data?.type === 'backlog-node') {
      const store = useAppStore.getState();
      const bl = store.backlogs[data.backlogId];
      setActiveDrag({ id: data.backlogId, type: 'backlog-node', title: bl?.name ?? '' });
    } else if (data?.type === 'tree-node') {
      const store = useAppStore.getState();
      const tree = store.backlogTrees[data.treeId];
      setActiveDrag({ id: data.treeId, type: 'tree-node', title: tree?.name ?? '' });
    }
  }, [countWithDescendants]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDrag(null);
    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current;
    const overData = over.data.current;
    const draggedIds: string[] = activeData?.selectedIds ?? [activeData?.workItemId];

    if (activeData?.type === 'workitem' && overData?.type === 'backlog') {
      const sourceTreeId = activeData.treeId as string;
      const targetTreeId = overData.treeId as string;

      if (sourceTreeId !== targetTreeId) {
        const store = useAppStore.getState();
        const sourceTree = store.backlogTrees[sourceTreeId];
        const targetTree = store.backlogTrees[targetTreeId];
        const titles = draggedIds.map((id) => store.workItems[id]?.title ?? '').filter(Boolean);
        setPendingCrossTree({
          workItemIds: draggedIds,
          totalCount: countWithDescendants(draggedIds),
          targetBacklogId: overData.backlogId,
          targetTreeId,
          sourceTreeId,
          itemTitles: titles,
          sourceTreeName: sourceTree?.name ?? sourceTreeId,
          targetTreeName: targetTree?.name ?? targetTreeId
        });
      } else {
        draggedIds.forEach((id) => moveWorkItemToBacklog(id, overData.backlogId, overData.treeId));
      }
    } else if (activeData?.type === 'workitem' && overData?.type === 'workitem-parent') {
      const targetId = overData.workItemId;
      draggedIds.filter((id) => id !== targetId).forEach((id) => {
        reparentWorkItem(id, targetId, overData.treeId, overData.backlogId);
      });
    } else if (activeData?.type === 'workitem' && overData?.type === 'workitem-root') {
      draggedIds.forEach((id) => {
        reparentWorkItem(id, null, overData.treeId, overData.backlogId);
      });
    } else if (activeData?.type === 'workitem' && overData?.type === 'workitem-reorder') {
      const targetParentId = overData.parentId as string | null;
      const treeId = overData.treeId as string;
      const backlogIds = overData.backlogIds as string[];
      const store = useAppStore.getState();

      draggedIds.forEach((id) => {
        const wi = store.workItems[id];
        if (!wi) return;
        // If the item's parent differs from the drop zone's parent, reparent first
        if (wi.parentId !== targetParentId) {
          const backlogId = backlogIds[0] ?? '';
          reparentWorkItem(id, targetParentId, treeId, backlogId);
        }
      });
      // After reparenting, reorder among the new siblings
      draggedIds.forEach((id) => {
        reorderWorkItemAmongSiblings(id, overData.index as number, treeId, backlogIds);
      });
    } else if (activeData?.type === 'backlog-node' && overData?.type === 'backlog-reorder') {
      // Reorder/reparent backlog among siblings
      const backlogId = activeData.backlogId as string;
      const targetParentId = overData.parentId as string | null;
      const treeId = overData.treeId as string;
      const targetIndex = overData.index as number;
      // Prevent dropping onto own descendant
      const store = useAppStore.getState();
      const isDescendant = (parentId: string | null, checkId: string): boolean => {
        if (!parentId) return false;
        if (parentId === checkId) return true;
        return isDescendant(store.backlogs[parentId]?.parentId ?? null, checkId);
      };
      if (targetParentId && isDescendant(targetParentId, backlogId)) return;
      reorderBacklogAmongSiblings(backlogId, targetIndex, targetParentId, treeId);
    } else if (activeData?.type === 'backlog-node' && overData?.type === 'backlog') {
      // Drop backlog onto another backlog = reparent as child
      const backlogId = activeData.backlogId as string;
      const targetBacklogId = overData.backlogId as string;
      const treeId = overData.treeId as string;
      if (backlogId === targetBacklogId) return;
      // Prevent dropping onto own descendant
      const store = useAppStore.getState();
      const isDescendant = (id: string): boolean => {
        const bl = store.backlogs[id];
        if (!bl) return false;
        if (bl.parentId === backlogId) return true;
        if (bl.parentId) return isDescendant(bl.parentId);
        return false;
      };
      if (isDescendant(targetBacklogId)) return;
      // Only within same tree
      if (activeData.treeId !== treeId) return;
      moveBacklog(backlogId, targetBacklogId, treeId);
    }
  }, [moveWorkItemToBacklog, reparentWorkItem, reorderWorkItemAmongSiblings, reorderBacklogAmongSiblings, moveBacklog]);

  const handleCrossTreeChoice = useCallback((value: string) => {
    if (!pendingCrossTree) return;
    const { workItemIds, targetBacklogId, targetTreeId, sourceTreeId } = pendingCrossTree;

    workItemIds.forEach((id) => {
      if (value === 'move') {
        moveWorkItemToBacklog(id, targetBacklogId, targetTreeId);
        removeWorkItemFromTree(id, sourceTreeId);
      } else if (value === 'add') {
        moveWorkItemToBacklog(id, targetBacklogId, targetTreeId);
      }
    });
    setPendingCrossTree(null);
  }, [pendingCrossTree, moveWorkItemToBacklog, removeWorkItemFromTree]);

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-screen flex flex-col">
        <header className="h-16 border-b flex items-center px-4 gap-3 bg-card shrink-0 py-0">
          <img alt="Agilefant" className="h-12 bg-destructive-foreground shadow-none" src="/lovable-uploads/0c81b1b5-dc1d-489d-a1c4-51656484d393.png" />
          <h1 className="text-sm font-bold tracking-tight">Agilefant
            <sup className="text-xs text-primary">2</sup>
          </h1>
          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  onClick={() => setShowShortcuts((s) => !s)}
                  title="Keyboard shortcuts (?)">
                  
                  <Keyboard className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Keyboard shortcuts (?)</TooltipContent>
            </Tooltip>
            <button
              className={`
                w-8 h-8 flex items-center justify-center rounded-md transition-colors
                ${undoStackLength > 0 ?
              'text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer' :
              'text-muted-foreground/30 cursor-not-allowed'}
              `}
              onClick={undo}
              disabled={undoStackLength === 0}
              title="Undo (Ctrl+Z)">
              
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
        {activeDrag &&
        <div className="bg-card border shadow-xl rounded-md px-3 py-2 text-sm font-medium max-w-64 truncate">
            {activeDrag.title}
          </div>
        }
      </DragOverlay>

      {pendingCrossTree &&
      <ActionPrompt
        title={
        pendingCrossTree.totalCount > 1 ?
        `Move ${pendingCrossTree.totalCount} items to ${pendingCrossTree.targetTreeName}` :
        `Move "${pendingCrossTree.itemTitles[0]}" to ${pendingCrossTree.targetTreeName}`
        }
        options={[
        {
          label: pendingCrossTree.totalCount > 1 ? `Move ${pendingCrossTree.totalCount} items` : 'Move item',
          description: `Remove from "${pendingCrossTree.sourceTreeName}" and place in "${pendingCrossTree.targetTreeName}".`,
          value: 'move',
          isDefault: true
        },
        {
          label: 'Add to both',
          description: `Keep in "${pendingCrossTree.sourceTreeName}" and also add to "${pendingCrossTree.targetTreeName}".`,
          value: 'add'
        }]
        }
        onSelect={handleCrossTreeChoice}
        onCancel={() => setPendingCrossTree(null)} />

      }

      {showShortcuts &&
      <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />
      }
    </DndContext>);

}

function ShortcutsOverlay({ onClose }: {onClose: () => void;}) {
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
  { keys: ['N'], description: 'New root work item in selected backlog' },
  { keys: ['Shift', 'N'], description: 'New child of selected item or backlog' },
  { keys: ['Del'], description: 'Delete selected item or backlog' },
  { keys: ['↑', '↓'], description: 'Reorder selected work item among siblings' },
  { keys: ['Esc'], description: 'Deselect work item' },
  { keys: ['Ctrl', 'Z'], description: 'Undo last action' },
  { keys: ['?'], description: 'Toggle this help' }];


  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-foreground/20 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative bg-card border rounded-lg shadow-2xl w-full max-w-sm mx-4 animate-fade-in-up overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <h3 className="text-sm font-semibold">Keyboard Shortcuts</h3>
        </div>
        <div className="px-5 pb-5 space-y-2.5">
          {shortcuts.map((s, i) =>
          <div key={i} className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">{s.description}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((key, j) =>
              <kbd
                key={j}
                className="px-1.5 py-0.5 rounded border bg-muted text-xs font-mono min-w-[24px] text-center">
                
                    {key}
                  </kbd>
              )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>);

}