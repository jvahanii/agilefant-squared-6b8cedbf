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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { BacklogTreePanel } from "@/components/BacklogTreePanel";
import { WorkItemTreePanel } from "@/components/WorkItemTreePanel";
import { useAppStore } from "@/store/appStore";
import { ActionPrompt } from "@/components/ActionPrompt";
import { Undo2, Redo2, Keyboard, RotateCcw, Copy, FileText, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { exportChangeLogAsCsv } from "@/store/changeLog";
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }

      if (isInput) return;

      const state = useAppStore.getState();

      switch (e.key) {
        case "Enter": {
          if (e.shiftKey) {
            e.preventDefault();
            if (state.selectedWorkItemIds.length > 0) {
              window.dispatchEvent(new CustomEvent("shortcut:add-child-workitem"));
            } else if (state.selectedBacklogIds.length > 0) {
              window.dispatchEvent(new CustomEvent("shortcut:add-child-backlog"));
            }
          } else {
            e.preventDefault();
            if (state.selectedBacklogIds.length > 0 && state.selectedTreeId) {
              window.dispatchEvent(new CustomEvent("shortcut:add-workitem"));
            }
          }
          break;
        }
        case "Delete":
        case "Backspace": {
          if (state.selectedWorkItemIds.length > 0 || state.selectedBacklogIds.length > 0) {
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
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [undo, redo]);

  const countWithDescendants = useCallback((ids: string[]) => {
    const store = useAppStore.getState();
    const seen = new Set<string>();
    const collect = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      const item = store.workItems[id];
      if (item?.childrenIds) item.childrenIds.forEach(collect);
    };
    ids.forEach(collect);
    return seen.size;
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current;
    const store = useAppStore.getState();
    if (data?.type === "workitem") {
      const ids: string[] = data.selectedIds ?? [data.workItemId];
      const totalCount = countWithDescendants(ids);
      const titles = ids.map((id) => store.workItems[id]?.title ?? "").filter(Boolean);
      const title = totalCount > 1 ? `${titles[0]} (+${totalCount - 1} more)` : (titles[0] ?? "");
      setActiveDrag({ id: data.workItemId, type: "workitem", title });
    } else if (data?.type === "backlog-node") {
      const bl = store.backlogs[data.backlogId];
      setActiveDrag({ id: data.backlogId, type: "backlog-node", title: bl?.name ?? "" });
    }
  }, [countWithDescendants]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveDrag(null);