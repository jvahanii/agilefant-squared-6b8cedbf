import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useState, useCallback, useEffect } from "react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { BacklogTreePanel } from "@/components/BacklogTreePanel";
import { WorkItemTreePanel } from "@/components/WorkItemTreePanel";
import { useAppStore } from "@/store/appStore";
import { ActionPrompt } from "@/components/ActionPrompt";
import { Undo2, Redo2, Keyboard, Copy, FileText } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { OrgSwitcher } from "@/components/OrgSwitcher";
import { useAuth } from "@/hooks/useAuth";

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
  const { user } = useAuth();
  const moveWorkItemToBacklog = useAppStore((s) => s.moveWorkItemToBacklog);
  const reorderBacklogAmongSiblings = useAppStore((s) => s.reorderBacklogAmongSiblings);
  const moveBacklog = useAppStore((s) => s.moveBacklog);
  const removeWorkItemFromTree = useAppStore((s) => s.removeWorkItemFromTree);
  const reparentWorkItem = useAppStore((s) => s.reparentWorkItem);
  const reorderWorkItemAmongSiblings = useAppStore((s) => s.reorderWorkItemAmongSiblings);
  const reorderBacklogTree = useAppStore((s) => s.reorderBacklogTree);
  const undo = useAppStore((s) => s.undo);
  const redo = useAppStore((s) => s.redo);
  const undoStackLength = useAppStore((s) => s.undoStack.length);
  const redoStackLength = useAppStore((s) => s.redoStack.length);
  
  const [activeDrag, setActiveDrag] = useState<{ id: string; type: string; title: string } | null>(null);
  const [pendingCrossTree, setPendingCrossTree] = useState<PendingCrossTreeDrop | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) {
        e.preventDefault();
        redo();
        return;
      }

      if (isInput) return;

      const state = useAppStore.getState();

      switch (e.key.toLowerCase()) {
        case "t": {
          if (state.selectedWorkItemIds.length > 0 && state.selectedTreeId && state.selectedBacklogIds.length > 0) {
            e.preventDefault();
            // Pass 0 to move to top
            state.selectedWorkItemIds.forEach((id) => {
              state.reorderWorkItemAmongSiblings(id, 0, state.selectedTreeId!, state.selectedBacklogIds);
            });
            toast({ title: `Moved ${state.selectedWorkItemIds.length} items to top` });
          }
          break;
        }
        case "b": {
          if (state.selectedWorkItemIds.length > 0 && state.selectedTreeId && state.selectedBacklogIds.length > 0) {
            e.preventDefault();
            // Pass a very high index to move to bottom
            state.selectedWorkItemIds.forEach((id) => {
              state.reorderWorkItemAmongSiblings(id, 999999, state.selectedTreeId!, state.selectedBacklogIds);
            });
            toast({ title: `Moved ${state.selectedWorkItemIds.length} items to bottom` });
          }
          break;
        }
        case "enter": {
          e.preventDefault();
          if (e.shiftKey) {
            if (state.selectedWorkItemIds.length > 0) {
              window.dispatchEvent(new CustomEvent("shortcut:add-child-workitem"));
            }
          } else {
            window.dispatchEvent(new CustomEvent("shortcut:add-workitem"));
          }
          break;
        }
        case "delete":
        case "backspace": {
          if (state.selectedWorkItemIds.length > 0) {
            e.preventDefault();
            window.dispatchEvent(new CustomEvent("shortcut:delete-selected"));
          }
          break;
        }
        case "?": {
          e.preventDefault();
          setShowShortcuts((s) => !s);
          break;
        }
        case "escape": {
          if (state.selectedWorkItemIds.length > 0) {
            useAppStore.getState().clearWorkItemSelection();
          }
          break