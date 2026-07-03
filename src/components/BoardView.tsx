import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useDraggable, useDroppable, useDndContext } from "@dnd-kit/core";
import { useAppStore } from "@/store/appStore";
import { useTeamStore } from "@/store/teamStore";
import { useLabelsStore } from "@/store/labelsStore";
import { useTreeStatusesStore, DEFAULT_TREE_STATUSES, type TreeStatus } from "@/store/treeStatusesStore";
import { useBoardColumnsStore, type BoardColumn as BoardColumnDef } from "@/store/boardColumnsStore";
import { WorkItem, WorkItemStatus } from "@/types/models";
import { cn } from "@/lib/utils";
import { Link2, GripVertical, Trash2, Plus, RotateCcw, BellOff, Bell, FolderInput, ArrowDownAZ, Clock, EyeOff, Eye, List as ListIcon } from "lucide-react";
import { useScramble } from "@/contexts/ScrambleContext";
import { scrambleName } from "@/lib/scramble";
import { useIsMobile } from "@/hooks/use-mobile";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore, isSavingsIncomeEnabled } from "@/store/orgSettingsStore";
import { useTimeEntryStore } from "@/store/timeEntryStore";
import { computeWorkItemTotalMinutes } from "@/lib/timeUtils";
import { toast } from "@/hooks/use-toast";
import { RespawnSettingsDialog } from "./RespawnSettingsDialog";
import { HyperlinksDialog } from "./HyperlinksDialog";
import { TimeLogDialog, formatDuration } from "./TimeLogDialog";
import { FinancialsDialog } from "./FinancialsDialog";
import { SnoozeDialog } from "./SnoozeDialog";
import { MoveToParentDialog } from "./MoveToParentDialog";
import { MoveToBacklogDialog } from "./MoveToBacklogDialog";
import { ActionPrompt } from "./ActionPrompt";
import {
  useSnoozeStore,
  snoozeOptionLaterToday,
  snoozeOptionTomorrowMorning,
  snoozeOptionNextWeek,
  snoozeOptionThisWeekend,
} from "@/store/snoozeStore";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuCheckboxItem,
} from "@/components/ui/context-menu";

interface BoardViewProps {
  backlogId: string;
  treeId: string;
  /** Function to add a new work item. Called with title, parentId, backlogId, treeId. */
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string, rank?: number) => void;
  /** Function to switch between list and board views */
  setViewMode: (mode: "list" | "board") => void;
}

const EMPTY_ARR: string[] = [];
const EMPTY_COLS: BoardColumnDef[] = [];

/** Delay (in ms) to allow React to complete reconciliation before scrolling to an element.
 *  This ensures the element exists in the DOM when we call scrollIntoView(). */
const REACT_RECONCILIATION_DELAY = 100;

/** Recursively collect this backlog and all descendant backlog IDs. */
function collectBacklogIds(
  rootId: string,
  backlogs: Record<string, { childrenIds: string[] }>,
): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    const bl = backlogs[id];
    if (!bl) return;
    for (const c of bl.childrenIds) walk(c);
  };
  walk(rootId);
  return out;
}

/** Drop zone placed between two board cards within a column to enable re-ranking.
 *  Uses the same "workitem-reorder" drop type as the list-view ReorderDropZone
 *  so the existing AppLayout onDragEnd handler processes it automatically.
 *
 *  Keeps a minimal layout footprint (2–4 px) but expands the invisible hit area
 *  to ±12 px vertically, making it easy to target without requiring pixel-perfect
 *  aim.  During a drag every zone shows a subtle guide line; the active zone
 *  brightens and gains a glowing dot. */
function BoardReorderDropZone({
  id,
  index,
  treeId,
  backlogIds,
}: {
  id: string;
  index: number;
  treeId: string;
  backlogIds: string[];
}) {
  const { active } = useDndContext();
  const isDragActive = active !== null;
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "workitem-reorder", index, treeId, backlogIds, parentId: null },
  });

  return (
    <div className="relative" style={{ height: isDragActive ? 4 : 2 }}>
      {/* Generous invisible hit area (±12 px → 24 px total) that does not
          affect the flow layout. */}
      <div
        ref={setNodeRef}
        className="absolute inset-0 z-10"
        style={{ top: -12, bottom: -12 }}
      />
      {/* Subtle guide line visible at every drop slot while dragging */}
      <div
        className={cn(
          "absolute inset-x-1 top-1/2 -translate-y-1/2 rounded-full transition-all duration-200 ease-out",
          isOver
            ? "h-1 bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.6)]"
            : isDragActive
              ? "h-px bg-muted-foreground/25"
              : "h-0 bg-transparent",
        )}
      />
      {/* Glowing dot on the active drop zone */}
      {isOver && (
        <div className="absolute left-1.5 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-primary shadow-[0_0_8px_2px_hsl(var(--primary)/0.5)] animate-in zoom-in duration-150" />
      )}
    </div>
  );
}

/** Inline input rendered at the top of a column to quickly add a new item. */
function ColumnAddInput({
  onAdd,
  onCancel,
}: {
  onAdd: (title: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed) {
      onAdd(trimmed);
      setValue("");
      // Keep the input open so the user can add more items in succession,
      // matching the list-view add-item behavior.
    } else {
      onCancel();
    }
  };

  return (
    <div className="px-1.5 py-1">
      <input
        ref={inputRef}
        className="w-full text-xs bg-card rounded border px-1.5 py-1 outline-none focus:border-primary"
        placeholder="Title…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          if (e.key === "Escape") onCancel();
          e.stopPropagation();
        }}
        onBlur={submit}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function BoardView({ backlogId, treeId, addWorkItem, setViewMode }: BoardViewProps) {
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  const statusesByTree = useTreeStatusesStore((s) => s.statusesByTree);
  const columnsByBacklog = useBoardColumnsStore((s) => s.columnsByBacklog);
  const loadColumnsForBacklog = useBoardColumnsStore((s) => s.loadForBacklog);
  const createColumn = useBoardColumnsStore((s) => s.createColumn);
  const renameColumn = useBoardColumnsStore((s) => s.renameColumn);
  const deleteColumn = useBoardColumnsStore((s) => s.deleteColumn);
  const reorderColumns = useBoardColumnsStore((s) => s.reorderColumns);

  const allStatuses = useMemo<TreeStatus[]>(() => {
    const list = statusesByTree[treeId];
    if (list && list.length > 0) return list;
    return DEFAULT_TREE_STATUSES.map((s, i) => ({
      id: `default-${s.key}`,
      treeId,
      ...s,
      rank: i,
    })) as TreeStatus[];
  }, [statusesByTree, treeId]);

  // Lazy-load (and one-shot migrate legacy state into) board_columns for this backlog.
  useEffect(() => {
    loadColumnsForBacklog(backlogId, treeId);
  }, [backlogId, treeId, loadColumnsForBacklog]);

  const backlogColumns = columnsByBacklog[backlogId] ?? EMPTY_COLS;

  // Build the visible column list, shaped as TreeStatus so all existing
  // consumers (BoardColumn, BoardCard) can keep using `col.id`, `col.key`,
  // `col.label`, `col.color`. `id` here is the `board_columns.id` — stable
  // per column and used for rename/delete/reorder writes.
  const orderedColumns = useMemo<TreeStatus[]>(() => {
    const byKey = new Map(allStatuses.map((s) => [s.key, s]));
    return backlogColumns.map((c) => {
      const s = byKey.get(c.statusKey);
      return {
        id: c.id,
        treeId,
        key: c.statusKey,
        label: c.label,
        color: s?.color ?? "#94a3b8",
        rank: c.rank,
      };
    });
  }, [backlogColumns, allStatuses, treeId]);

  // Statuses that don't yet have a column in this backlog — offered in the
  // header context menu as "Add column".
  const availableStatuses = useMemo(() => {
    const used = new Set(backlogColumns.map((c) => c.statusKey));
    return allStatuses.filter((s) => !used.has(s.key));
  }, [allStatuses, backlogColumns]);

  const cardsByStatus = useMemo(() => {
    const backlogSet = collectBacklogIds(backlogId, backlogs);
    const known = new Set(allStatuses.map((c) => c.key));
    const map: Record<string, WorkItem[]> = {};
    for (const c of allStatuses) map[c.key] = [];
    const leaves: WorkItem[] = [];
    for (const wi of Object.values(workItems)) {
      const assigned = wi.backlogAssignments?.[treeId];
      if (!assigned || !backlogSet.has(assigned)) continue;
      if (wi.childrenIds.length > 0) continue; // leaf-only
      leaves.push(wi);
    }
    // Order by rank within their assigned backlog for deterministic display.
    leaves.sort((a, b) => {
      const ab = a.backlogAssignments[treeId];
      const bb = b.backlogAssignments[treeId];
      const ar = a.ranks?.[ab] ?? 0;
      const br = b.ranks?.[bb] ?? 0;
      return ar - br;
    });
    for (const wi of leaves) {
      const key = known.has(wi.status) ? wi.status : "not_started";
      (map[key] ??= []).push(wi);
    }
    return map;
  }, [workItems, backlogs, backlogId, treeId, allStatuses]);

  // Track which column has an active inline add-input (null = none open)
  const [addingColumnKey, setAddingColumnKey] = useState<string | null>(null);

  // When a card is selected and Enter is pressed, open an inline add-input
  // immediately below the selected card (just like list view).
  const [addAfterSlot, setAddAfterSlot] = useState<{ columnKey: string; afterIndex: number } | null>(null);
  const addAfterSlotRef = useRef(addAfterSlot);
  addAfterSlotRef.current = addAfterSlot;

  // Listen for the header "+" button event (dispatched from WorkItemTreePanel)
  // and Enter key with backlog selected but no work item selected.
  // Both should prompt for a new item on the leftmost column (respecting user reorder).
  useEffect(() => {
    const handler = () => {
      if (orderedColumns.length > 0) {
        setAddAfterSlot(null);
        setAddingColumnKey(orderedColumns[0].key);
      }
    };
    window.addEventListener("board:header-add", handler);
    window.addEventListener("shortcut:add-workitem", handler);
    return () => {
      window.removeEventListener("board:header-add", handler);
      window.removeEventListener("shortcut:add-workitem", handler);
    };
  }, [orderedColumns]);

  // Listen for Enter / Shift+Enter so the board behaves like the list view.
  useEffect(() => {
    const handler = () => {
      const state = useAppStore.getState();
      const ids = state.selectedWorkItemIds;
      if (ids.length === 0) return;
      const item = state.workItems[ids[0]];
      if (!item) return;
      const colCards = cardsByStatus[item.status] ?? [];
      const idx = colCards.findIndex((wi) => wi.id === item.id);
      if (idx === -1) return;
      setAddingColumnKey(null);
      setAddAfterSlot({ columnKey: item.status, afterIndex: idx });
    };
    window.addEventListener("shortcut:add-sibling-workitem", handler);
    return () => window.removeEventListener("shortcut:add-sibling-workitem", handler);
  }, [cardsByStatus]);

  // Listen for Delete / Backspace so the board handles card deletion with selection navigation.
  useEffect(() => {
    const handler = () => {
      const state = useAppStore.getState();
      const ids = state.selectedWorkItemIds;
      if (ids.length === 0) return;
      const itemId = ids[0];
      const item = state.workItems[itemId];
      if (!item) return;

      // Build a flat, ordered list of all visible cards across all columns.
      const allCards: { id: string; statusKey: string }[] = [];
      for (const col of orderedColumns) {
        const colCards = cardsByStatus[col.key] ?? [];
        for (const card of colCards) {
          allCards.push({ id: card.id, statusKey: col.key });
        }
      }

      const currentIdx = allCards.findIndex((c) => c.id === itemId);
      if (currentIdx === -1) return;

      // Determine next selection: item below > item above > none.
      const isOnlyCardOnBoard = allCards.length <= 1;
      let nextId: string | null = null;
      if (currentIdx + 1 < allCards.length) {
        nextId = allCards[currentIdx + 1].id;
      } else if (currentIdx - 1 >= 0) {
        nextId = allCards[currentIdx - 1].id;
      }

      // Perform the delete.
      const assignmentCount = Object.keys(item.backlogAssignments).length;
      if (assignmentCount > 1) {
        state.removeWorkItemsFromTreeBulk([{ workItemId: itemId, treeId }]);
      } else {
        state.deleteWorkItem(itemId);
      }

      // Navigate selection after the store settles.
      if (nextId) {
        setTimeout(() => {
          useAppStore.getState().selectWorkItem(nextId, false);
        }, 50);
      } else if (isOnlyCardOnBoard) {
        setTimeout(() => {
          useAppStore.setState({ selectedWorkItemIds: [] });
        }, 0);
      }
    };

    window.addEventListener("shortcut:delete-selected", handler);
    return () => window.removeEventListener("shortcut:delete-selected", handler);
  }, [cardsByStatus, orderedColumns, treeId]);

  const handleColumnAdd = useCallback(
    (statusKey: string, title: string, afterIndex?: number) => {
      // Save the current ID set to find the new item after creation.
      const before = new Set(Object.keys(useAppStore.getState().workItems));
      // Compute a rank that places the new item after the card at `afterIndex`.
      let rank: number | undefined;
      if (afterIndex !== undefined && afterIndex >= 0) {
        const colCards = cardsByStatus[statusKey] ?? [];
        const afterCard = colCards[afterIndex];
        if (afterCard) {
          const afterRank = afterCard.ranks[afterCard.backlogAssignments[treeId]] ?? 0;
          const nextCard = colCards[afterIndex + 1];
          if (nextCard) {
            const nextRank = nextCard.ranks[nextCard.backlogAssignments[treeId]] ?? 0;
            rank = afterRank + (nextRank - afterRank) / 2;
          } else {
            rank = afterRank + 1;
          }
        }
      }
      addWorkItem(title, null, backlogId, treeId, rank);
      // After the synchronous store update, find the new ID and set its status
      setTimeout(() => {
        const after = Object.keys(useAppStore.getState().workItems);
        const newIds = after.filter((id) => !before.has(id));
        if (newIds.length === 1) {
          useAppStore.getState().setWorkItemStatus(newIds[0], statusKey as WorkItemStatus);
        }
      }, 0);
    },
    [addWorkItem, backlogId, treeId, cardsByStatus],
  );

  // Compute all backlog IDs in this tree for "Move to backlog" submenu
  const allBacklogIds = useMemo(() => {
    const ids = new Set<string>();
    const collect = (id: string) => {
      ids.add(id);
      backlogs[id]?.childrenIds.forEach(collect);
    };
    collect(backlogId);
    return Array.from(ids);
  }, [backlogId, backlogs]);

  return (
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-2">
      <div className="flex gap-2 h-full min-w-max">
        {orderedColumns.map((col) => (
            <BoardColumn
            key={col.id}
            column={col}
            items={cardsByStatus[col.key] ?? []}
            selectedIds={selectedWorkItemIds}
            onSelectItem={(id, ctrl) => selectWorkItem(id, ctrl)}
            treeStatuses={allStatuses}
            treeId={treeId}
            backlogId={backlogId}
            allBacklogIds={allBacklogIds}
            isAdding={addingColumnKey === col.key}
            onStartAdd={() => setAddingColumnKey(col.key)}
            onCommitAdd={(title) => {
              const slot = addAfterSlotRef.current;
              handleColumnAdd(col.key, title, slot?.columnKey === col.key ? slot.afterIndex : undefined);
              setAddingColumnKey(null);
              setAddAfterSlot(null);
            }}
            onCancelAdd={() => {
              setAddingColumnKey(null);
              setAddAfterSlot(null);
            }}
            onDeleteColumn={() => deleteColumn(col.id)}
            availableStatuses={availableStatuses}
            onAddColumn={(statusKey, label) => createColumn(backlogId, statusKey, label)}
            addAfterSlot={
              addAfterSlot?.columnKey === col.key ? addAfterSlot.afterIndex : null
            }
            setViewMode={setViewMode}
            allColumnKeys={orderedColumns.map((c) => c.key)}
            onSaveLabel={(_key, label) => renameColumn(col.id, label)}
            onMoveColumn={(fromId, toId) => {
              const current = orderedColumns.map((c) => c.id);
              const fromIdx = current.indexOf(fromId);
              const toIdx = current.indexOf(toId);
              if (fromIdx === -1 || toIdx === -1) return;
              const next = [...current];
              next.splice(fromIdx, 1);
              next.splice(toIdx, 0, fromId);
              reorderColumns(backlogId, next);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Thin vertical strip shown for hidden columns; click to restore. */
function HiddenColumnStrip({
  column,
  itemCount,
  onShow,
}: {
  column: TreeStatus;
  itemCount: number;
  onShow: () => void;
}) {
  const label = `Show "${column.label}" column (${itemCount} ${itemCount === 1 ? "item" : "items"})`;
  return (
    <button
      onClick={onShow}
      title={label}
      aria-label={label}
      className="flex flex-col items-center justify-center w-8 shrink-0 rounded-lg border bg-muted/20 h-full gap-1.5 text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors group"
    >
      <span
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: column.color }}
      />
      <span
        className="text-[10px] font-semibold"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed", transform: "rotate(180deg)" }}
        title={column.label}
      >
        {column.label}
      </span>
      {itemCount > 0 && (
        <span className="text-[10px] tabular-nums">{itemCount}</span>
      )}
      <Eye className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

function BoardColumn({
  column,
  items,
  selectedIds,
  onSelectItem,
  treeStatuses,
  treeId,
  backlogId,
  allBacklogIds,
  isAdding,
  addAfterSlot,
  onStartAdd,
  onCommitAdd,
  onCancelAdd,
  onDeleteColumn,
  availableStatuses,
  onAddColumn,
  setViewMode,
  allColumnKeys,
  onMoveColumn,
  onSaveLabel,
}: {
  column: TreeStatus;
  items: WorkItem[];
  selectedIds: string[];
  onSelectItem: (id: string, ctrl: boolean) => void;
  treeStatuses: TreeStatus[];
  treeId: string;
  backlogId: string;
  allBacklogIds: string[];
  isAdding: boolean;
  addAfterSlot: number | null;
  onStartAdd: () => void;
  onCommitAdd: (title: string) => void;
  onCancelAdd: () => void;
  onDeleteColumn: () => void;
  availableStatuses: TreeStatus[];
  onAddColumn: (statusKey: string, label: string) => void;
  setViewMode: (mode: "list" | "board") => void;
  allColumnKeys?: string[];
  onMoveColumn?: (fromId: string, toId: string) => void;
  onSaveLabel: (statusKey: string, label: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `board-column:${column.id}`,
    data: { type: "board-column", statusKey: column.key },
  });

  // HTML5 dragover indicator
  const [dragOverDir, setDragOverDir] = useState<"left" | "right" | null>(null);

  const headerRef = useRef<HTMLDivElement>(null);

  const columnRef = useRef<HTMLDivElement>(null);

  // Inline editing of column label (double-click to edit)
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editLabel, setEditLabel] = useState("");
  const labelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingLabel) {
      labelInputRef.current?.focus();
      labelInputRef.current?.select();
    }
  }, [isEditingLabel]);

  const startEditingLabel = () => {
    setEditLabel(column.label);
    setIsEditingLabel(true);
  };

  const commitLabel = () => {
    const trimmed = editLabel.trim();
    if (trimmed && trimmed !== column.label) {
      onSaveLabel(column.key, trimmed);
    }
    setIsEditingLabel(false);
  };

  const displayLabel = column.label;

  return (
    <div
      ref={columnRef}
      className={cn(
        "flex flex-col w-56 shrink-0 rounded-lg border bg-muted/20 h-full",
        isOver && "ring-2 ring-primary bg-primary/5",
      )}
      onDragOver={(e) => {
        // Allow column-header drags to happen over the column body without
        // the browser showing its native "no-drop" cursor.
        e.preventDefault();
      }}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={headerRef}
            draggable={onMoveColumn != null}
            className="flex items-center gap-1.5 px-2.5 py-2 border-b sticky top-0 bg-background/80 backdrop-blur-sm rounded-t-lg cursor-grab active:cursor-grabbing select-none relative"
            onDragStart={(e) => {
              if (!onMoveColumn) return;
              e.dataTransfer.setData("text/plain", column.key);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (!onMoveColumn) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const rect = headerRef.current?.getBoundingClientRect();
              if (rect) {
                setDragOverDir(e.clientX < rect.left + rect.width / 2 ? "left" : "right");
              }
            }}
            onDragLeave={() => setDragOverDir(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverDir(null);
              const fromKey = e.dataTransfer.getData("text/plain");
              if (fromKey && fromKey !== column.key && onMoveColumn) {
                onMoveColumn(fromKey, column.key);
              }
            }}
            onDragEnd={() => setDragOverDir(null)}
          >
            {/* Left-side drop indicator bar */}
            <div
              className={cn(
                "absolute left-0 top-0 bottom-0 rounded-l-lg transition-all duration-200 ease-out pointer-events-none",
                dragOverDir !== null
                  ? "w-1 bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.6)]"
                  : "w-0 bg-transparent",
              )}
            />
            {/* Right-side drop indicator bar */}
            <div
              className={cn(
                "absolute right-0 top-0 bottom-0 rounded-r-lg transition-all duration-200 ease-out pointer-events-none",
                dragOverDir !== null
                  ? "w-1 bg-primary shadow-[0_0_10px_hsl(var(--primary)/0.6)]"
                  : "w-0 bg-transparent",
              )}
            />
            <GripVertical className="w-3 h-3 text-muted-foreground/40 shrink-0" />
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: column.color }}
            />
            {isEditingLabel ? (
              <input
                ref={labelInputRef}
                className="text-xs font-semibold bg-transparent border-b border-primary/40 outline-none px-0.5 w-20"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitLabel();
                  if (e.key === "Escape") setIsEditingLabel(false);
                  e.stopPropagation();
                }}
                onBlur={commitLabel}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span
                className={cn(
                  "text-xs font-semibold truncate",
                )}
                title={displayLabel}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  startEditingLabel();
                }}
              >
                {displayLabel}
              </span>
            )}
            {items.length > 0 && (
              <span className="text-[10px] tabular-nums font-semibold px-1.5 py-0.5 rounded-full bg-muted/80 text-muted-foreground ml-0.5">
                {items.length}
              </span>
            )}
            <button
              className="ml-auto w-5 h-5 flex items-center justify-center rounded text-muted-foreground/60 hover:text-foreground hover:bg-accent transition-colors shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onStartAdd();
              }}
              title={`Add item to ${column.label}`}
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem className="text-xs" onSelect={onToggleHidden}>
            <EyeOff className="w-3 h-3 mr-2" />
            Hide column
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <div ref={setNodeRef} className="flex-1 overflow-y-auto">
        {isAdding && (
          <ColumnAddInput
            onAdd={onCommitAdd}
            onCancel={onCancelAdd}
          />
        )}
        <div className="p-1.5">
          {/* Reorder drop zone before the first card */}
          <BoardReorderDropZone
            id={`board-reorder-${column.id}-0`}
            index={0}
            treeId={treeId}
            backlogIds={allBacklogIds}
          />
          {items.map((wi, i) => (
            <div key={wi.id}>
              <BoardCard
                item={wi}
                selected={selectedIds.includes(wi.id)}
                onClick={(ctrl) => onSelectItem(wi.id, ctrl)}
                treeStatuses={treeStatuses}
                treeId={treeId}
                backlogId={backlogId}
                allBacklogIds={allBacklogIds}
                setViewMode={setViewMode}
              />
              {/* Inline add-input opened via Enter key right after the selected card */}
              {addAfterSlot === i && (
                <ColumnAddInput
                  onAdd={onCommitAdd}
                  onCancel={onCancelAdd}
                />
              )}
              {/* Reorder drop zone after this card */}
              <BoardReorderDropZone
                id={`board-reorder-${column.id}-${i + 1}`}
                index={i + 1}
                treeId={treeId}
                backlogIds={allBacklogIds}
              />
            </div>
          ))}
          {items.length === 0 && !isAdding && (
            <div className="flex flex-col items-center justify-center gap-1 py-10 text-muted-foreground/50">
              <Plus className="w-5 h-5 stroke-[1.5]" />
              <span className="text-[11px]">Drop cards here</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BoardCard({
  item,
  selected,
  onClick,
  treeStatuses,
  treeId,
  backlogId,
  allBacklogIds,
  setViewMode,
}: {
  item: WorkItem;
  selected: boolean;
  onClick: (ctrl: boolean) => void;
  treeStatuses: TreeStatus[];
  treeId: string;
  backlogId: string;
  allBacklogIds: string[];
  setViewMode: (mode: "list" | "board") => void;
}) {
  const isMobile = useIsMobile();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `board-card:${item.id}`,
    data: { type: "workitem", workItemId: item.id, selectedIds: [item.id] },
  });
  const cardListeners = !isMobile ? listeners : undefined;

  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const workItemTeamsMap = useTeamStore((s) => s.workItemTeams);
  const teams = useTeamStore((s) => s.teams);
  const labelsMap = useLabelsStore((s) => s.labels);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const teamIds = useMemo(() => workItemTeamsMap[item.id] ?? EMPTY_ARR, [workItemTeamsMap, item.id]);
  const labels = useMemo(() => {
    const ids = byEntity[`work_item:${item.id}`] ?? EMPTY_ARR;
    return ids.map((id) => labelsMap[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }, [byEntity, labelsMap, item.id]);
  const { scrambleEnabled } = useScramble();
  const title = scrambleEnabled ? scrambleName(item.title) : item.title;

  // Status color for visual accent
  const statusColor = useMemo(
    () => treeStatuses.find((s) => s.key === item.status)?.color ?? "#94a3b8",
    [treeStatuses, item.status],
  );

  // App store actions
  const setWorkItemStatus = useAppStore((s) => s.setWorkItemStatus);
  const deleteWorkItem = useAppStore((s) => s.deleteWorkItem);
  const duplicateWorkItems = useAppStore((s) => s.duplicateWorkItems);
  const renameWorkItem = useAppStore((s) => s.renameWorkItem);
  const setWorkItemPoints = useAppStore((s) => s.setWorkItemPoints);
  const addWorkItem = useAppStore((s) => s.addWorkItem);
  const sortChildrenAlphabetically = useAppStore((s) => s.sortChildrenAlphabetically);
  const reorderWorkItemAmongSiblings = useAppStore((s) => s.reorderWorkItemAmongSiblings);
  const moveWorkItemToBacklog = useAppStore((s) => s.moveWorkItemToBacklog);
  const removeWorkItemsFromTreeBulk = useAppStore((s) => s.removeWorkItemsFromTreeBulk);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);

  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const pointsVisible = useOrgSettingsStore((s) => {
    if (!activeOrgId) return false;
    return s.settings[activeOrgId]?.pointsEnabled ?? false;
  });
  const timeLoggingVisible = useOrgSettingsStore((s) => {
    if (!activeOrgId) return false;
    return s.settings[activeOrgId]?.timeLoggingEnabled ?? false;
  });
  const labelsVisible = useOrgSettingsStore((s) => {
    if (!activeOrgId) return false;
    return s.settings[activeOrgId]?.labelsEnabled ?? false;
  });

  const assignLabel = useLabelsStore((s) => s.assignLabel);
  const unassignLabel = useLabelsStore((s) => s.unassignLabel);
  const assignTeam = useTeamStore((s) => s.assignTeamToWorkItem);
  const unassignTeam = useTeamStore((s) => s.unassignTeamFromWorkItem);

  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const itemTotalMinutes = useMemo(() => {
    if (!timeLoggingVisible) return 0;
    return computeWorkItemTotalMinutes(item.id, workItems, timeEntries);
  }, [timeEntries, item.id, workItems, timeLoggingVisible]);

  // Snooze
  const snoozeWorkItem = useSnoozeStore((s) => s.snoozeWorkItem);
  const unsnoozeWorkItem = useSnoozeStore((s) => s.unsnoozeWorkItem);
  const isSnoozed = useSnoozeStore((s) => s.isSnoozed(item.id));

  // Dialog state
  const [showRespawnDialog, setShowRespawnDialog] = useState(false);
  const [showHyperlinksDialog, setShowHyperlinksDialog] = useState(false);
  const [showTimeLogDialog, setShowTimeLogDialog] = useState(false);
  const [showSnoozeDialog, setShowSnoozeDialog] = useState(false);
  const [showMoveToParentDialog, setShowMoveToParentDialog] = useState(false);
  const [showMoveToBacklogDialog, setShowMoveToBacklogDialog] = useState(false);
  const [showFinancialsDialog, setShowFinancialsDialog] = useState(false);
  const [showDeletePrompt, setShowDeletePrompt] = useState(false);
  const [showSortPrompt, setShowSortPrompt] = useState(false);

  // Inline editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [isEditingPoints, setIsEditingPoints] = useState(false);
  const [editPoints, setEditPoints] = useState("");

  const assignmentCount = Object.keys(item.backlogAssignments).length;

  const orgLabels = useMemo(() => {
    return Object.values(labelsMap)
      .filter((l) => l.organizationId === activeOrgId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [labelsMap, activeOrgId]);

  const handleQuickSnooze = useCallback(async (until: Date) => {
    if (!activeOrgId) return;
    try {
      await snoozeWorkItem({ workItemId: item.id, organizationId: activeOrgId, snoozedUntil: until });
    } catch (err) {
      console.error("Failed to snooze item", err);
    }
  }, [item.id, activeOrgId, snoozeWorkItem]);

  const handleDeleteClick = useCallback(() => {
    if (assignmentCount > 1) setShowDeletePrompt(true);
    else deleteWorkItem(item.id);
  }, [assignmentCount, deleteWorkItem, item.id]);

  const handleDeleteChoice = useCallback((value: string) => {
    setShowDeletePrompt(false);
    if (value === "remove-from-backlog") removeWorkItemsFromTreeBulk([{ workItemId: item.id, treeId }]);
    else if (value === "delete-everywhere") deleteWorkItem(item.id);
  }, [item.id, treeId, deleteWorkItem, removeWorkItemsFromTreeBulk]);

  const handleDuplicate = useCallback(() => {
    const newRootIds = duplicateWorkItems([item.id]);
    if (newRootIds.length === 1) {
      const newId = newRootIds[0];
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("shortcut:edit-title", { detail: { workItemId: newId } }));
      }, 50);
    }
  }, [duplicateWorkItems, item.id]);

  const commitTitle = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== item.title) renameWorkItem(item.id, trimmed);
    setIsEditingTitle(false);
  };

  const commitPoints = () => {
    const num = parseInt(editPoints, 10);
    setWorkItemPoints(item.id, isNaN(num) || num <= 0 ? undefined : num);
    setIsEditingPoints(false);
  };

  const handleMoveToTop = useCallback(() => {
    const state = useAppStore.getState();
    const backlogIds: string[] = [];
    const collectBacklogs = (id: string) => {
      backlogIds.push(id);
      state.backlogs[id]?.childrenIds.forEach(collectBacklogs);
    };
    collectBacklogs(backlogId);
    reorderWorkItemAmongSiblings(item.id, 0, treeId, backlogIds);
    toast({ title: "Moved item to top", description: item.title });
  }, [item.id, item.title, backlogId, treeId, reorderWorkItemAmongSiblings]);

  const handleSortChildren = useCallback(() => {
    const state = useAppStore.getState();
    const backlogIds: string[] = [];
    const collectBacklogs = (id: string) => {
      backlogIds.push(id);
      state.backlogs[id]?.childrenIds.forEach(collectBacklogs);
    };
    collectBacklogs(backlogId);
    sortChildrenAlphabetically(item.id, treeId, backlogIds);
    toast({ title: "Children sorted A→Z", description: "Press Ctrl+Z to undo" });
    setShowSortPrompt(false);
  }, [item.id, backlogId, treeId, sortChildrenAlphabetically]);

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            {...cardListeners}
            {...attributes}
            onClick={(e) => {
              e.stopPropagation();
              onClick(e.ctrlKey || e.metaKey);
            }}
            className={cn(
              "relative group rounded-md border bg-card shadow-sm p-2 text-xs select-none overflow-hidden",
              !isMobile && "cursor-grab active:cursor-grabbing hover:border-accent-foreground/30 touch-none",
              selected && "ring-2 ring-primary border-primary",
              isDragging && "opacity-40",
              isSnoozed && "opacity-60",
            )}
          >
            {/* Status color left accent bar */}
            <div
              className="absolute left-0 top-0 bottom-0 w-1 rounded-l-md"
              style={{ backgroundColor: statusColor }}
            />
            {/* Snoozed diagonal watermark */}
            {isSnoozed && (
              <div className="absolute right-1 top-1 text-[9px] font-semibold text-muted-foreground/50 uppercase tracking-wider rotate-12">
                snoozed
              </div>
            )}
            <div className="flex items-start gap-1 justify-between">
              {isEditingTitle ? (
                <input
                  autoFocus
                  className="flex-1 text-xs bg-transparent border-b border-primary/40 outline-none px-0.5 py-0"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitTitle();
                    if (e.key === "Escape") setIsEditingTitle(false);
                    e.stopPropagation();
                  }}
                  onBlur={commitTitle}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <div className="font-medium leading-snug break-words flex-1">{title}</div>
              )}
              {isMobile && (
                <div
                  {...listeners}
                  onContextMenu={(e) => {
                    e.stopPropagation();
                  }}
                  className="w-5 h-5 flex items-center justify-center shrink-0 text-muted-foreground/40 touch-none cursor-grab active:cursor-grabbing"
                  data-drag-handle="true"
                >
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1 mt-1">
              {typeof item.points === "number" && (
                <span className="text-[10px] font-semibold px-1 py-0.5 rounded bg-primary/10 text-primary tabular-nums">
                  {item.points}p
                </span>
              )}
              {labels.map((l) => (
                <span
                  key={l.id}
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-medium max-w-[80px] truncate"
                  style={{ backgroundColor: `${l.color}22`, color: l.color }}
                  title={l.name}
                >
                  {l.name}
                </span>
              ))}
              {teamIds.slice(0, 3).map((tid) => {
                const t = teams.find((x) => x.id === tid);
                if (!t) return null;
                const name = scrambleEnabled ? scrambleName(t.name) : t.name;
                return (
                  <span
                    key={tid}
                    className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-secondary/60 text-secondary-foreground max-w-[80px] truncate"
                    title={name}
                  >
                    {name}
                  </span>
                );
              })}
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          <ContextMenuLabel className="text-xs truncate">{item.title}</ContextMenuLabel>
          <ContextMenuSeparator />
          <ContextMenuSub>
            <ContextMenuSubTrigger className="text-xs">
              <span
                className="w-2 h-2 rounded-full mr-2 shrink-0 inline-block"
                style={{ backgroundColor: treeStatuses.find((s) => s.key === item.status)?.color ?? "#94a3b8" }}
              />
              Status
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuRadioGroup
                value={item.status}
                onValueChange={(val) => setWorkItemStatus(item.id, val as WorkItemStatus)}
              >
                {treeStatuses.map((s) => (
                  <ContextMenuRadioItem key={s.key} value={s.key} className="text-xs">
                    <span className="w-2 h-2 rounded-full mr-1 shrink-0 inline-block" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </ContextMenuRadioItem>
                ))}
              </ContextMenuRadioGroup>
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem 
            className="text-xs" 
            onSelect={() => {
              setViewMode("list");
              // Select the item and scroll into view after view mode change and React reconciliation
              setTimeout(() => {
                selectWorkItem(item.id, false);
                document
                  .querySelector(`[data-work-item-id="${CSS.escape(item.id)}"]`)
                  ?.scrollIntoView({ block: "nearest" });
              }, REACT_RECONCILIATION_DELAY);
            }}
          >
            <ListIcon className="w-3 h-3 mr-2" />
            View in list
          </ContextMenuItem>
          <ContextMenuItem
            className="text-xs"
            onSelect={handleMoveToTop}
          >
            Move to top
          </ContextMenuItem>
          <ContextMenuItem
            className="text-xs"
            onSelect={() => {
              setEditTitle(item.title);
              setIsEditingTitle(true);
            }}
          >
            Rename
          </ContextMenuItem>
          <ContextMenuItem className="text-xs" onSelect={handleDuplicate}>
            Duplicate
            <span className="ml-auto text-[10px] text-muted-foreground">⌘D</span>
          </ContextMenuItem>
          {pointsVisible && (
            <ContextMenuItem
              className="text-xs"
              onSelect={() => {
                setEditPoints(item.points != null ? String(item.points) : "");
                setIsEditingPoints(true);
              }}
            >
              Edit story points
            </ContextMenuItem>
          )}
          <ContextMenuItem
            className="text-xs"
            onSelect={() => {
              addWorkItem(item.title + " (child)", item.id, item.backlogAssignments[treeId] ?? backlogId, treeId);
            }}
          >
            <Plus className="w-3 h-3 mr-1.5 shrink-0" />
            Add child item
          </ContextMenuItem>
          {item.childrenIds.length > 1 && (
            <ContextMenuItem
              className="text-xs"
              onSelect={() => setShowSortPrompt(true)}
            >
              <ArrowDownAZ className="w-3 h-3 mr-1.5 shrink-0" />
              Sort children A→Z
            </ContextMenuItem>
          )}
          <ContextMenuItem
            className="text-xs"
            onSelect={() => setShowMoveToBacklogDialog(true)}
          >
            <FolderInput className="w-3 h-3 mr-1.5 shrink-0" />
            Move…
            <span className="ml-auto text-[10px] text-muted-foreground">M</span>
          </ContextMenuItem>
          {allBacklogIds.length > 1 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-xs">
                Move to backlog
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {allBacklogIds
                  .filter((blId) => blId !== (item.backlogAssignments[treeId] ?? backlogId))
                  .map((blId) => (
                    <ContextMenuItem
                      key={blId}
                      className="text-xs"
                      onSelect={() => moveWorkItemToBacklog(item.id, blId, treeId)}
                    >
                      {scrambleEnabled ? scrambleName(backlogs[blId]?.name ?? blId) : (backlogs[blId]?.name ?? blId)}
                    </ContextMenuItem>
                  ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          <ContextMenuItem
            className="text-xs"
            onSelect={() => setShowMoveToParentDialog(true)}
          >
            Reparent…
          </ContextMenuItem>
          <ContextMenuSeparator />
          {labelsVisible && orgLabels.length > 0 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-xs">Labels</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {orgLabels.map((label) => {
                  const isAssigned = (byEntity[`work_item:${item.id}`] ?? []).includes(label.id);
                  return (
                    <ContextMenuCheckboxItem
                      key={label.id}
                      className="text-xs"
                      checked={isAssigned}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          assignLabel(label.id, "work_item", item.id, label.organizationId);
                        } else {
                          unassignLabel(label.id, "work_item", item.id);
                        }
                      }}
                    >
                      <span className="w-2 h-2 rounded-full mr-1 shrink-0 inline-block" style={{ backgroundColor: label.color }} />
                      {label.name}
                    </ContextMenuCheckboxItem>
                  );
                })}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          {teams.length > 0 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-xs">Assign teams</ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {teams.map((team) => {
                  const isAssigned = teamIds.includes(team.id);
                  return (
                    <ContextMenuCheckboxItem
                      key={team.id}
                      className="text-xs"
                      checked={isAssigned}
                      onCheckedChange={(checked) => {
                        const orgId = team.organization_id || activeOrgId;
                        if (!orgId) return;
                        if (checked) {
                          assignTeam(item.id, team.id, orgId);
                        } else {
                          unassignTeam(item.id, team.id);
                        }
                      }}
                    >
                      {team.name}
                    </ContextMenuCheckboxItem>
                  );
                })}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          {timeLoggingVisible && (
            <ContextMenuItem className="text-xs" onSelect={() => setShowTimeLogDialog(true)}>
              <Clock className="w-3 h-3 mr-2" />
              Log time
            </ContextMenuItem>
          )}
          <ContextMenuSub>
            <ContextMenuSubTrigger className="text-xs">
              <BellOff className="w-3 h-3 mr-2" />
              Snooze
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionLaterToday())}>
                <span className="flex-1">Later Today</span>
                <span className="ml-4 text-muted-foreground text-[10px]">3h from now</span>
              </ContextMenuItem>
              <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionTomorrowMorning())}>
                <span className="flex-1">Tomorrow Morning</span>
                <span className="ml-4 text-muted-foreground text-[10px]">7:00 AM</span>
              </ContextMenuItem>
              <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionThisWeekend())}>
                <span className="flex-1">This Weekend</span>
                <span className="ml-4 text-muted-foreground text-[10px]">Sat 7:00 AM</span>
              </ContextMenuItem>
              <ContextMenuItem className="text-xs" onSelect={() => handleQuickSnooze(snoozeOptionNextWeek())}>
                <span className="flex-1">Next Week</span>
                <span className="ml-4 text-muted-foreground text-[10px]">Mon 7:00 AM</span>
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem className="text-xs" onSelect={() => setShowSnoozeDialog(true)}>
                Pick Date / Time…
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
          {isSnoozed && (
            <ContextMenuItem className="text-xs" onSelect={() => unsnoozeWorkItem(item.id)}>
              <Bell className="w-3 h-3 mr-2" />
              Unsnooze
            </ContextMenuItem>
          )}
          <ContextMenuItem className="text-xs" onSelect={() => setShowRespawnDialog(true)}>
            <RotateCcw className="w-3 h-3 mr-2" />
            Respawn settings
          </ContextMenuItem>
          <ContextMenuItem className="text-xs" onSelect={() => setShowHyperlinksDialog(true)}>
            <Link2 className="w-3 h-3 mr-2" />
            Hyperlinks
          </ContextMenuItem>
          {isSavingsIncomeEnabled(activeOrgId) && (
            <ContextMenuItem className="text-xs" onSelect={() => setShowFinancialsDialog(true)}>
              Savings & Income
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-xs text-destructive focus:text-destructive"
            onSelect={handleDeleteClick}
          >
            <Trash2 className="w-3 h-3 mr-2" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {/* Dialogs */}
      <RespawnSettingsDialog
        workItemId={item.id}
        open={showRespawnDialog}
        onOpenChange={setShowRespawnDialog}
      />
      <HyperlinksDialog
        workItemId={item.id}
        open={showHyperlinksDialog}
        onOpenChange={setShowHyperlinksDialog}
      />
      {timeLoggingVisible && (
        <TimeLogDialog
          workItemId={item.id}
          open={showTimeLogDialog}
          onOpenChange={setShowTimeLogDialog}
        />
      )}
      <SnoozeDialog
        workItemIds={[item.id]}
        open={showSnoozeDialog}
        onOpenChange={setShowSnoozeDialog}
      />
      <MoveToParentDialog
        workItemIds={[item.id]}
        open={showMoveToParentDialog}
        onOpenChange={setShowMoveToParentDialog}
      />
      <MoveToBacklogDialog
        workItemIds={[item.id]}
        treeId={treeId}
        currentBacklogId={item.backlogAssignments[treeId] ?? backlogId}
        open={showMoveToBacklogDialog}
        onOpenChange={setShowMoveToBacklogDialog}
      />
      {isSavingsIncomeEnabled(activeOrgId) && (
        <FinancialsDialog
          workItemId={item.id}
          open={showFinancialsDialog}
          onOpenChange={setShowFinancialsDialog}
        />
      )}
      {isEditingPoints && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20" onClick={() => setIsEditingPoints(false)}>
          <div className="bg-card rounded-lg shadow-lg p-4 w-64" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-medium mb-2">Edit story points for "{item.title}"</p>
            <input
              autoFocus
              className="w-full text-sm bg-muted rounded-md border px-2 py-1 outline-none focus:border-primary"
              value={editPoints}
              onChange={(e) => setEditPoints(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPoints();
                if (e.key === "Escape") setIsEditingPoints(false);
              }}
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                className="px-3 py-1 text-xs rounded-md border hover:bg-muted transition-colors"
                onClick={() => setIsEditingPoints(false)}
              >
                Cancel
              </button>
              <button
                className="px-3 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                onClick={commitPoints}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeletePrompt && (
        <ActionPrompt
          title={`"${item.title}" is in ${assignmentCount} backlogs`}
          options={[
            {
              label: "Remove from this backlog",
              description: `Remove from "${backlogs[item.backlogAssignments[treeId]]?.name ?? backlogId}" only. Keeps it in other backlogs.`,
              value: "remove-from-backlog",
              isDefault: true,
            },
            {
              label: "Delete everywhere",
              description: "Permanently delete this item from all backlogs.",
              value: "delete-everywhere",
              variant: "destructive",
            },
          ]}
          onSelect={handleDeleteChoice}
          onCancel={() => setShowDeletePrompt(false)}
        />
      )}

      {showSortPrompt && (
        <ActionPrompt
          title="Sort children A→Z?"
          options={[
            {
              label: "Sort A→Z",
              description: "Sorts children alphabetically. You can undo with Ctrl+Z.",
              value: "confirm",
              isDefault: true,
            },
          ]}
          onSelect={handleSortChildren}
          onCancel={() => setShowSortPrompt(false)}
        />
      )}
    </>
  );
}