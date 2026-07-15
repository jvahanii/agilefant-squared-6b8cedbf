import { useMemo, useState, useRef, useEffect, useCallback } from "react";
import { useDraggable, useDroppable, useDndContext } from "@dnd-kit/core";
import { useAppStore } from "@/store/appStore";
import { useTeamStore } from "@/store/teamStore";
import { useLabelsStore } from "@/store/labelsStore";
import { useBacklogStatusesStore, DEFAULT_STATUSES as DEFAULT_TREE_STATUSES, getEffectiveStatuses, isPinnedStatus, type BacklogStatus as TreeStatus } from "@/store/backlogStatusesStore";
import { WorkItem, WorkItemStatus } from "@/types/models";
import { cn } from "@/lib/utils";
import { Link2, GripVertical, Trash2, Plus, RotateCcw, BellOff, Bell, FolderInput, ArrowDownAZ, Clock, EyeOff, Eye, List as ListIcon, Columns2 } from "lucide-react";
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
  /** Function to add a new work item. Called with title, parentId, backlogId, treeId, optional list rank, initialStatus, and optional board rank. */
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string, rank?: number, initialStatus?: WorkItemStatus, boardRank?: number) => void;
  /** Function to switch between list and board views */
  setViewMode: (mode: "list" | "board") => void;
}

const EMPTY_ARR: string[] = [];

function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || `status_${Math.random().toString(36).slice(2, 7)}`;
}
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
  statusKey,
  prevCardId,
  nextCardId,
}: {
  id: string;
  index: number;
  treeId: string;
  backlogIds: string[];
  statusKey: string;
  prevCardId: string | null;
  nextCardId: string | null;
}) {
  const { active } = useDndContext();
  const isDragActive = active !== null;
  const { setNodeRef, isOver } = useDroppable({
    id,
    data: { type: "workitem-reorder", index, treeId, backlogIds, parentId: null, statusKey, prevCardId, nextCardId },
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

const COLOR_PRESETS = [
  "#94a3b8", "#3b82f6", "#f59e0b", "#ef4444", "#22c55e",
  "#a855f7", "#ec4899", "#93c5fd", "#eab308", "#64748b",
];

export function BoardView({ backlogId, treeId, addWorkItem, setViewMode }: BoardViewProps) {
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  // Subscribe so realtime edits re-render.
  const statusesByBacklog = useBacklogStatusesStore((s) => s.statusesByBacklog);
  const createStatus = useBacklogStatusesStore((s) => s.createStatus);
  const updateStatus = useBacklogStatusesStore((s) => s.updateStatus);
  const deleteStatus = useBacklogStatusesStore((s) => s.deleteStatus);
  const reorderStatuses = useBacklogStatusesStore((s) => s.reorderStatuses);

  // Board columns ARE statuses — no per-backlog column overrides anymore.
  const allStatuses = useMemo<TreeStatus[]>(
    () => getEffectiveStatuses(backlogId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [backlogId, statusesByBacklog, backlogs],
  );
  const orderedColumns = allStatuses;

  // Nothing to add via the "Add column" submenu now that every status IS a column;
  // that submenu is removed from the header context menu below.
  const availableStatuses: TreeStatus[] = EMPTY_ARR as unknown as TreeStatus[];

  const renameColumn = useCallback(
    (id: string, label: string) => updateStatus(backlogId, id, { label }),
    [updateStatus, backlogId],
  );
  const setColumnColor = useCallback(
    (id: string, color: string) => updateStatus(backlogId, id, { color }),
    [updateStatus, backlogId],
  );
  const deleteColumn = useCallback(
    (id: string) => deleteStatus(backlogId, id),
    [deleteStatus, backlogId],
  );
  const reorderColumns = useCallback(
    (_bid: string, orderedIds: string[]) => reorderStatuses(backlogId, orderedIds),
    [reorderStatuses, backlogId],
  );
  const createColumn = useCallback(
    (_bid: string, statusKey: string, label: string) => createStatus(backlogId, statusKey, label, "#94a3b8"),
    [createStatus, backlogId],
  );


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
    for (const wi of leaves) {
      const key = known.has(wi.status) ? wi.status : "not_started";
      (map[key] ??= []).push(wi);
    }
    // Board order: sort each column by its own boardRanks (fallback to list rank).
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) => {
        const ab = a.backlogAssignments[treeId];
        const bb = b.backlogAssignments[treeId];
        const ar = a.boardRanks?.[ab] ?? a.ranks?.[ab] ?? 0;
        const br = b.boardRanks?.[bb] ?? b.ranks?.[bb] ?? 0;
        return ar - br;
      });
    }
    return map;
  }, [workItems, backlogs, backlogId, treeId, allStatuses]);

  // Track which column has an active inline add-input (null = none open)
  const [addingColumnKey, setAddingColumnKey] = useState<string | null>(null);

  // When a card is selected and Enter is pressed, open an inline add-input
  // immediately below the selected card (just like list view).
  const [addAfterSlot, setAddAfterSlot] = useState<{ columnKey: string; afterIndex: number } | null>(null);

  // Show inline input for adding a new column at the end of the board
  const [isAddingColumn, setIsAddingColumn] = useState(false);
  const [newColumnLabel, setNewColumnLabel] = useState("");
  const newColumnInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAddingColumn) {
      requestAnimationFrame(() => {
        newColumnInputRef.current?.focus();
      });
    }
  }, [isAddingColumn]);

  const handleAddColumnSubmit = () => {
    const trimmed = newColumnLabel.trim();
    if (trimmed) {
      const existingKeys = new Set(orderedColumns.map((c) => c.key));
      let key = slugifyKey(trimmed);
      let i = 2;
      while (existingKeys.has(key)) key = `${slugifyKey(trimmed)}_${i++}`;
      createColumn(backlogId, key, trimmed);
      setNewColumnLabel("");
      setIsAddingColumn(false);
    } else {
      setIsAddingColumn(false);
    }
  };
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
      const colCards = cardsByStatus[statusKey] ?? [];
      const insertAt = afterIndex !== undefined && afterIndex >= 0 ? afterIndex + 1 : 0;

      // Shift existing items at or above `insertAt` one slot up so the
      // new item can claim that integer position without collisions.
      const state = useAppStore.getState();
      const nextItems = { ...state.workItems };
      const rankRows: Array<{ workItemId: string; backlogId: string; rank: number; organizationId: string }> = [];
      for (const card of colCards) {
        const wi = nextItems[card.id];
        const blId = wi.backlogAssignments[treeId];
        const currentRank = wi.boardRanks?.[blId] ?? wi.ranks?.[blId] ?? 0;
        if (currentRank >= insertAt) {
          const shifted = currentRank + 1;
          nextItems[card.id] = { ...wi, boardRanks: { ...(wi.boardRanks ?? {}), [blId]: shifted } };
          rankRows.push({ workItemId: card.id, backlogId: blId, rank: shifted, organizationId: wi.organizationId ?? '' });
        }
      }
      if (rankRows.length > 0) {
        useAppStore.setState({ workItems: nextItems });
        import("@/store/supabaseSync").then(({ upsertWorkItemBoardRankRows }) => {
          upsertWorkItemBoardRankRows(rankRows).catch(() => {});
        });
      }

      // Create the new item at the freed integer position.
      addWorkItem(title, null, backlogId, treeId, undefined, statusKey as WorkItemStatus, insertAt);
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

  // ---------------------------------------------------------------------------
  // Arrow-key navigation for the board view
  //   Left/Right → move between columns (select closest-index item)
  //   Up/Down    → move up/down within the current column
  // ---------------------------------------------------------------------------
  // Stable refs so the keyboard handler always sees the latest data without
  // needing to re-register the listener on every render.
  const orderedColumnsRef = useRef(orderedColumns);
  orderedColumnsRef.current = orderedColumns;

  const cardsByStatusRef = useRef(cardsByStatus);
  cardsByStatusRef.current = cardsByStatus;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when the focus is in an input/textarea/contenteditable
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isInput) return;

      // Don't fire when a modal dialog is open
      if (document.querySelector('[role="dialog"]')) return;

      // Don't intercept when Ctrl/Cmd/Alt modifiers are pressed (global shortcuts)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "ArrowUp" && e.key !== "ArrowDown") return;

      const state = useAppStore.getState();
      const ids = state.selectedWorkItemIds;
      if (ids.length === 0) return;

      const selectedId = ids[0];
      const item = state.workItems[selectedId];
      if (!item) return;

      const cols = orderedColumnsRef.current;
      const cards = cardsByStatusRef.current;

      const currentColumnKey = item.status;
      const currentColIndex = cols.findIndex((c) => c.key === currentColumnKey);

      // The column may not exist as a visible column (e.g., the item's status
      // was removed from the board).  Fall back to treating it as if it were
      // in the first column so navigation can recover.
      const effectiveColCards = cards[currentColumnKey] ?? [];

      const currentCardIndex = effectiveColCards.findIndex((wi) => wi.id === selectedId);
      // If the selected item is not found in any card list, try to find it
      // across all columns as a fallback.
      let fallbackColKey: string = currentColumnKey;
      let fallbackCardIndex = currentCardIndex;
      if (currentCardIndex === -1) {
        for (const col of cols) {
          const colCards = cards[col.key] ?? [];
          const idx = colCards.findIndex((wi) => wi.id === selectedId);
          if (idx >= 0) {
            fallbackColKey = col.key;
            fallbackCardIndex = idx;
            break;
          }
        }
      }

      e.preventDefault();

      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        // Move between columns, skipping empty ones.
        const direction = e.key === "ArrowLeft" ? -1 : 1;
        const startColIndex = currentColIndex >= 0 ? currentColIndex : cols.findIndex((c) => c.key === fallbackColKey);
        let targetColIndex = startColIndex + direction;

        // Walk in the pressed direction until we find a column with cards,
        // or hit the board boundary.
        while (targetColIndex >= 0 && targetColIndex < cols.length) {
          const targetCol = cols[targetColIndex];
          const targetCards = targetCol ? (cards[targetCol.key] ?? []) : [];
          if (targetCards.length > 0) {
            // Found a non-empty column — select the closest-index item.
            const sourceIdx = currentCardIndex >= 0 ? currentCardIndex : fallbackCardIndex;
            const clampedIdx = Math.max(0, Math.min(sourceIdx, targetCards.length - 1));
            const targetItem = targetCards[clampedIdx];
            if (targetItem) {
              state.selectWorkItem(targetItem.id, false);
              setTimeout(() => {
                const el = document.querySelector(`[data-board-card-id="${targetItem.id}"]`);
                if (el) el.scrollIntoView({ block: "nearest", inline: "nearest" });
              }, 50);
            }
            return;
          }
          targetColIndex += direction;
        }
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        // Move up/down within the current column
        let cardIndex = currentCardIndex;
        let colKey: string = currentColumnKey;

        // Fallback: if the item is not in its current status column, use the
        // first column where we found it.
        if (cardIndex === -1) {
          for (const col of cols) {
            const colCards = cards[col.key] ?? [];
            const idx = colCards.findIndex((wi) => wi.id === selectedId);
            if (idx >= 0) {
              colKey = col.key;
              cardIndex = idx;
              break;
            }
          }
        }

        if (cardIndex === -1) return;

        const colCards = cards[colKey] ?? [];
        const direction = e.key === "ArrowDown" ? 1 : -1;
        let newIndex = cardIndex + direction;

        // Clamp to valid range
        if (newIndex < 0) newIndex = 0;
        if (newIndex >= colCards.length) newIndex = colCards.length - 1;

        const targetItem = colCards[newIndex];
        if (targetItem && targetItem.id !== selectedId) {
          state.selectWorkItem(targetItem.id, false);
          // Scroll the newly selected card into view after React reconciles
          setTimeout(() => {
            const el = document.querySelector(`[data-board-card-id="${targetItem.id}"]`);
            if (el) el.scrollIntoView({ block: "nearest" });
          }, 50);
        }
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []); // Intentionally empty — we use refs for all dynamic data

  return (
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-2">
      <div className="flex gap-1.5 h-full min-w-max">
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
              const isAddAfter = slot?.columnKey === col.key;
              handleColumnAdd(col.key, title, isAddAfter ? slot.afterIndex : undefined);
              if (isAddAfter) {
                // Advance the slot to point after the newly created item so the
                // inline input stays open for another item (matching list-view behavior).
                setAddingColumnKey(null);
                setAddAfterSlot({ columnKey: col.key, afterIndex: slot.afterIndex + 1 });
              }
              // Column-header add: keep the input open at the top by not clearing addingColumnKey.
            }}
            onCancelAdd={() => {
              setAddingColumnKey(null);
              setAddAfterSlot(null);
            }}
            onDeleteColumn={() => deleteColumn(col.id)}
            availableStatuses={availableStatuses}
            onAddColumn={(statusKey, label) => createColumn(backlogId, statusKey, label)}
            locked={isPinnedStatus(col.key)}
            addAfterSlot={
              addAfterSlot?.columnKey === col.key ? addAfterSlot.afterIndex : null
            }
            setViewMode={setViewMode}
            allColumnKeys={orderedColumns.map((c) => c.key)}
            onSaveLabel={(_key, label) => renameColumn(col.id, label)}
            onSetColor={(color) => setColumnColor(col.id, color)}
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
        {/* Add Column button / inline input */}
        {isAddingColumn ? (
          <div className="w-44 shrink-0 rounded-lg border border-dashed border-muted-foreground/40 bg-muted/10 p-3 self-start">
            <input
              ref={newColumnInputRef}
              className="w-full text-xs bg-card rounded border px-1.5 py-1 outline-none focus:border-primary"
              placeholder="Column name…"
              value={newColumnLabel}
              onChange={(e) => setNewColumnLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddColumnSubmit();
                if (e.key === "Escape") { setIsAddingColumn(false); setNewColumnLabel(""); }
                e.stopPropagation();
              }}
              onBlur={handleAddColumnSubmit}
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ) : (
          <button
            className="w-44 shrink-0 rounded-lg border border-dashed border-muted-foreground/30 bg-transparent hover:bg-muted/10 hover:border-muted-foreground/50 transition-colors p-3 self-start flex items-center gap-2 text-xs text-muted-foreground/60 hover:text-muted-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setNewColumnLabel("");
              setIsAddingColumn(true);
            }}
          >
            <Columns2 className="w-3.5 h-3.5" />
            Add Column
          </button>
        )}
      </div>
    </div>
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
  locked = false,
  onSetColor,
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
  locked?: boolean;
  onSetColor?: (color: string) => void;
}) {
  // Droppable covers the ENTIRE column (header + body) so cards dropped
  // on the header are treated as "put at the top of this column".
  const columnDroppable = useDroppable({
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
      // Use rAF to ensure React has flushed the input to the DOM before focusing/selecting.
      requestAnimationFrame(() => {
        labelInputRef.current?.focus();
        labelInputRef.current?.select();
      });
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
      data-board-column={column.key}
      className={cn(
        "flex flex-col w-52 shrink-0 rounded-lg border bg-muted/20 h-full",
        columnDroppable.isOver && "ring-2 ring-primary bg-primary/5",
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
            className="flex items-center gap-1 px-2 py-2 border-b sticky top-0 bg-background/80 backdrop-blur-sm rounded-t-lg cursor-grab active:cursor-grabbing select-none relative"
            onDragStart={(e) => {
              if (!onMoveColumn) return;
              e.dataTransfer.setData("text/plain", column.id);
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
              const fromId = e.dataTransfer.getData("text/plain");
              if (fromId && fromId !== column.id && onMoveColumn) {
                onMoveColumn(fromId, column.id);
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
                  "text-xs font-semibold truncate cursor-text",
                )}
                title={displayLabel}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  startEditingLabel();
                }}
              >
                {displayLabel}
              </span>            )}
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
          <ContextMenuItem
            className="text-xs"
            onSelect={() => startEditingLabel()}
          >
            Rename column
          </ContextMenuItem>
          {!locked && (
            <ContextMenuSub>
              <ContextMenuSubTrigger className="text-xs">
                <span
                  className="w-2 h-2 rounded-full mr-2 shrink-0 inline-block"
                  style={{ backgroundColor: column.color }}
                />
                Colour
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                <div className="grid grid-cols-5 gap-1 p-1.5">
                  {COLOR_PRESETS.map((color) => (
                    <button
                      key={color}
                      className="w-6 h-6 rounded cursor-pointer border border-transparent hover:scale-110 transition-transform"
                      style={{ backgroundColor: color, borderColor: column.color === color ? "hsl(var(--foreground))" : "transparent" }}
                      onClick={() => onSetColor?.(color)}
                      title={color}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-1 px-1.5 pb-1.5">
                  <input
                    type="color"
                    value={column.color}
                    onChange={(e) => {
                      const newColor = e.target.value;
                      onSetColor?.(newColor);
                    }}
                    className="w-5 h-5 rounded border border-input bg-background cursor-pointer shrink-0"
                  />
                  <span className="text-[10px] text-muted-foreground">Custom</span>
                </div>
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-xs text-destructive focus:text-destructive"
            disabled={locked}
            onSelect={() => !locked && onDeleteColumn()}
          >
            <Trash2 className="w-3 h-3 mr-2" />
            Remove column
            {locked && <span className="ml-auto text-[10px] text-muted-foreground">Required</span>}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <div
        ref={columnDroppable.setNodeRef}
        className="flex-1 overflow-y-auto"
        onDoubleClick={(e) => {
          // Only trigger on the empty area of the column, not on cards or inputs
          const target = e.target as HTMLElement;
          if (target.closest("[data-board-card-id], input, textarea, button")) return;
          onStartAdd();
        }}
      >
        {isAdding && (
          <ColumnAddInput
            onAdd={onCommitAdd}
            onCancel={onCancelAdd}
          />
        )}
        <div className="p-1">
          {/* Reorder drop zone before the first card */}
          <BoardReorderDropZone
            id={`board-reorder-${column.id}-0`}
            index={0}
            treeId={treeId}
            backlogIds={allBacklogIds}
            statusKey={column.key}
            prevCardId={null}
            nextCardId={items.length > 0 ? items[0].id : null}
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
                statusKey={column.key}
                prevCardId={items[i].id}
                nextCardId={items[i + 1]?.id ?? null}
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
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `board-card:${item.id}`,
    data: { type: "workitem", workItemId: item.id, selectedIds: selectedWorkItemIds.includes(item.id) ? selectedWorkItemIds : [item.id], treeId },
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
            data-board-card-id={item.id}
            onClick={(e) => {
              // Only stop propagation if the click was not on an interactive child
              const target = e.target as HTMLElement;
              if (!target.closest("input, textarea, button, [data-drag-handle]")) {
                e.stopPropagation();
              }
              onClick(e.ctrlKey || e.metaKey);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setEditTitle(item.title);
              setIsEditingTitle(true);
            }}
            className={cn(
              "relative group rounded-md border bg-card shadow-sm p-2 text-sm select-none overflow-hidden w-full block",
              !isMobile && "cursor-pointer hover:border-accent-foreground/30 touch-none",
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