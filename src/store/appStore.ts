import { useAppStore } from "@/store/appStore";
import { WORK_ITEM_STATUSES, WorkItemStatus } from "@/types/models";
import { ChevronRight, ChevronDown, GripVertical, FileText, Plus, Trash2 } from "lucide-react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { ActionPrompt } from "./ActionPrompt";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function EditableBacklogName({ backlogId }: { backlogId: string }) {
  const backlog = useAppStore((s) => s.backlogs[backlogId]);
  const renameBacklog = useAppStore((s) => s.renameBacklog);
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const startEditing = () => {
    setEditValue(backlog?.name ?? "");
    setIsEditing(true);
  };
  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== backlog?.name) renameBacklog(backlogId, trimmed);
    setIsEditing(false);
  };

  if (!backlog) return null;

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="text-base font-semibold bg-transparent border-b border-primary/40 outline-none px-0.5 py-0 min-w-0 w-full"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitEdit();
          if (e.key === "Escape") setIsEditing(false);
          e.stopPropagation();
        }}
        onBlur={commitEdit}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <h2
      className="text-base font-semibold cursor-text hover:text-primary transition-colors break-words whitespace-normal"
      onClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
    >
      {backlog.name}
    </h2>
  );
}

function InlineWorkItemInput({
  onSubmit,
  onCancel,
  depth,
}: {
  onSubmit: (title: string) => void;
  onCancel: () => void;
  depth: number;
}) {
  const [value, setValue] = useState("");
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textAreaRef.current?.focus();
  }, []);

  const handleSubmit = (fromBlur = false) => {
    const trimmed = value.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setValue("");
      if (fromBlur) onCancel();
    } else {
      onCancel();
    }
  };

  return (
    <div className="flex items-start gap-1.5 px-3 py-2" style={{ paddingLeft: `${depth * 20 + 32}px` }}>
      <FileText className="w-3.5 h-3.5 text-primary/50 shrink-0 mt-1" />
      <textarea
        ref={textAreaRef}
        rows={1}
        className="flex-1 text-sm bg-transparent border-b border-primary/40 outline-none px-1 py-0.5 placeholder:text-muted-foreground/50 resize-none overflow-hidden"
        placeholder="Work item title…"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = "auto";
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSubmit();
          }
          if (e.key === "Escape") onCancel();
        }}
        onBlur={() => handleSubmit(true)}
      />
    </div>
  );
}

interface WorkItemNodeProps {
  workItemId: string;
  depth: number;
  treeId: string;
  backlogId: string;
  allBacklogIds: string[];
  isChildBacklog?: boolean;
  onSelect: (id: string, multi: boolean, shift: boolean) => void;
}

function WorkItemNode({
  workItemId,
  depth,
  treeId,
  backlogId,
  allBacklogIds,
  isChildBacklog,
  onSelect,
}: WorkItemNodeProps) {
  const item = useAppStore((s) => s.workItems[workItemId]);
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const expanded = useAppStore((s) => s.expandedWorkItems.has(workItemId));
  const isSelected = useAppStore((s) => s.selectedWorkItemIds.includes(workItemId));
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
  const toggleExpand = useAppStore((s) => s.toggleWorkItemExpand);
  const setWorkItemStatus = useAppStore((s) => s.setWorkItemStatus);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const deleteWorkItem = useAppStore((s) => s.deleteWorkItem);
  const removeWorkItemFromTree = useAppStore((s) => s.removeWorkItemFromTree);
  const renameWorkItem = useAppStore((s) => s.renameWorkItem);
  const setWorkItemPoints = useAppStore((s) => s.setWorkItemPoints);
  const selectBacklog = useAppStore((s) => s.selectBacklog);

  const [isAdding, setIsAdding] = useState(false);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [isEditingPoints, setIsEditingPoints] = useState(false);
  const [editPoints, setEditPoints] = useState("");
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const pointsRef = useRef<HTMLInputElement>(null);
  const dragStartedRef = useRef(false);

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({
    id: `work