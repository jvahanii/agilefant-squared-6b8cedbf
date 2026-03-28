import { create } from "zustand";
import { WorkItem, WorkItemStatus, Backlog, BacklogTree } from "@/types/models";
import {
  loadFromSupabase,
  upsertWorkItem,
  upsertWorkItems,
  deleteWorkItems,
  upsertBacklog,
  upsertBacklogs,
  deleteBacklogs,
  upsertBacklogTree,
  upsertBacklogTrees,
  deleteBacklogTree as deleteBacklogTreeFromDb,
  resetOrgData,
} from "./supabaseSync";
import { generateMockData } from "./mockData";

// Define the ChangeLog entry structure directly in the store
export interface ChangeLogEntry {
  timestamp: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityName?: string;
  details?: string;
}

interface DataSnapshot {
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
  selectedBacklogIds: string[];
  selectedTreeId: string | null;
  selectedWorkItemIds: string[];
  changeLog: ChangeLogEntry[]; // Added to snapshot
}

interface AppState extends DataSnapshot {
  undoStack: DataSnapshot[];
  redoStack: DataSnapshot[];
  isLoading: boolean;
  organizationId: string | null;
  setOrganizationId: (orgId: string) => void;
  loadFromSupabase: () => Promise<void>;

  // Change Log Actions
  logChange: (entry: Omit<ChangeLogEntry, "timestamp">) => void;
  clearChangeLog: () => void;

  selectBacklog: (backlogId: string, treeId: string, ctrlKey?: boolean) => void;
  selectWorkItem: (workItemId: string | null, ctrlKey?: boolean) => void;
  clearWorkItemSelection: () => void;
  moveWorkItemToBacklog: (workItemId: string, targetBacklogId: string, treeId: string) => void;
  reparentWorkItem: (workItemId: string, newParentId: string | null, treeId: string, backlogId: string) => void;
  reorderWorkItemAmongSiblings: (workItemId: string, targetIndex: number, treeId: string, backlogIds: string[]) => void;

  reorderWorkItem: (workItemId: string, newRank: number, backlogId: string) => void;
  moveBacklog: (backlogId: string, newParentId: string | null, treeId: string) => void;
  reorderBacklogAmongSiblings: (
    backlogId: string,
    targetIndex: number,
    newParentId: string | null,
    treeId: string,
  ) => void;
  toggleWorkItemExpand: (workItemId: string) => void;
  toggleBacklogExpand: (backlogId: string) => void;
  addBacklog: (name: string, parentId: string | null, treeId: string) => void;
  deleteBacklog: (backlogId: string) => void;
  renameBacklog: (backlogId: string, name: string) => void;
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string, index?: number) => void;
  deleteWorkItem: (workItemId: string) => void;
  renameWorkItem: (workItemId: string, title: string) => void;
  setWorkItemPoints: (workItemId: string, points: number | undefined) => void;
  setWorkItemStatus: (workItemId: string, status: WorkItemStatus) => void;
  removeWorkItemFromTree: (workItemId: string, treeId: string) => void;
  renameBacklogTree: (treeId: string, name: string) => void;
  addBacklogTree: (name: string) => void;
  deleteBacklogTree: (treeId: string) => void;
  reorderBacklogTree: (treeId: string, targetIndex: number) => void;
  resetToMockData: () => Promise<void>;
  undo: () => void;
  redo: () => void;
}

const expandedWorkItems = new Set<string>();
const expandedBacklogs = new Set<string>();

function snapshot(state: DataSnapshot): DataSnapshot {
  return {
    workItems: state.workItems,
    backlogs: state.backlogs,
    backlogTrees: state.backlogTrees,
    selectedBacklogIds: [...state.selectedBacklogIds],
    selectedTreeId: state.selectedTreeId,
    selectedWorkItemIds: [...state.selectedWorkItemIds],
    changeLog: [...state.changeLog],
  };
}

const MAX_UNDO = 100;

function pushUndo(state: AppState & { expandedWorkItems: Set<string>; expandedBacklogs: Set<string> }) {
  return { undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)], redoStack: [] };
}

type StoreState = AppState & {
  expandedWorkItems: Set<string>;
  expandedBacklogs: Set<string>;
};

function getOrgId(state: { organizationId: string | null }): string {
  if (!state.organizationId) throw new Error("No organization selected");
  return state.organizationId;
}

export const useAppStore = create<StoreState>()((set, get) => {
  return {
    workItems: {},
    backlogs: {},
    backlogTrees: {},
    selectedBacklogIds: [],
    selectedTreeId: null,
    selectedWorkItemIds: [],
    changeLog: [], // Initial empty log
    expandedWorkItems,
    expandedBacklogs,
    undoStack: [],
    redoStack: [],
    isLoading: true,
    organizationId: null,

    setOrganizationId: (orgId: string) => {
      set({ organizationId: orgId });
    },

    logChange: (entry) => {
      set((state) => ({
        changeLog: [...state.changeLog, { ...entry, timestamp: new Date().toISOString() }],
      }));
    },

    clearChangeLog: () => set({ changeLog: [] }),

    loadFromSupabase: async () => {
      const orgId = get().organizationId;
      if (!orgId) {
        set({ isLoading: false, workItems: {}, backlogs: {}, backlogTrees: {} });
        return;
      }
      try {
        const data = await loadFromSupabase(orgId);
        const nextExpanded = new Set<string>();
        Object.values(data.backlogs).forEach((b) => {
          if (!b.parentId) nextExpanded.add(b.id);
        });
        set({
          ...data,
          expandedBacklogs: nextExpanded,
          expandedWorkItems: new Set<string>(),
          isLoading: false,
          undoStack: [],
          redoStack: [],
          changeLog: [], // Clear log on new load
        });
      } catch (err) {
        console.error("Failed to load from Supabase:", err);
        set({ isLoading: false });
      }
    },

    // ... (Select actions remain unchanged)
    selectBacklog: (backlogId, treeId, ctrlKey = false) =>
      set((state) => {
        if (ctrlKey) {
          if (state.selectedTreeId && state.selectedTreeId !== treeId) {
            return { selectedBacklogIds: [backlogId], selectedTreeId: treeId, selectedWorkItemIds: [] };
          }
          const ids = state.selectedBacklogIds.includes(backlogId)
            ? state.selectedBacklogIds.filter((id) => id !== backlogId)
            : [...state.selectedBacklogIds, backlogId];
          return { selectedBacklogIds: ids, selectedTreeId: treeId, selectedWorkItemIds: [] };
        }
        return { selectedBacklogIds: [backlogId], selectedTreeId: treeId, selectedWorkItemIds: [] };
      }),

    selectWorkItem: (workItemId, ctrlKey = false) =>
      set((state) => {
        if (!workItemId) return { selectedWorkItemIds: [] };
        if (ctrlKey) {
          const ids = state.selectedWorkItemIds.includes(workItemId)
            ? state.selectedWorkItemIds.filter((id) => id !== workItemId)
            : [...state.selectedWorkItemIds, workItemId];
          return { selectedWorkItemIds: ids };
        }
        return { selectedWorkItemIds: [workItemId] };
      }),

    clearWorkItemSelection: () => set({ selectedWorkItemIds: [] }),

    undo: () =>
      set((state) => {
        const stack = [...state.undoStack];
        const prev = stack.pop();
        if (!prev) return state;
        return { ...prev, undoStack: stack, redoStack: [...state.redoStack, snapshot(state)] };
      }),

    redo: () =>
      set((state) => {
        const stack = [...state.redoStack];
        const next = stack.pop();
        if (!next) return state;
        return { ...next, undoStack: [...state.undoStack, snapshot(state)], redoStack: stack };
      }),

    resetToMockData: async () => {
      const orgId = get().organizationId;
      if (!orgId) return;
      set({ isLoading: true });
      try {
        const mockData = generateMockData();
        await resetOrgData(orgId, mockData);
        get().clearChangeLog();
        get().logChange({ action: "Reset to mock data", entityType: "data" });
        await get().loadFromSupabase();
      } catch (err) {
        console.error("resetToMockData failed:", err);
        set({ isLoading: false });
      }
    },

    reorderWorkItemAmongSiblings: (workItemId, targetIndex, treeId, backlogIds) => {
      set((state) => {
        const orgId = getOrgId(state);
        const mainItem = state.workItems[workItemId];
        if (!mainItem) return state;

        const itemsToMoveIds =
          state.selectedWorkItemIds.length > 1 && state.selectedWorkItemIds.includes(workItemId)
            ? state.selectedWorkItemIds
            : [workItemId];

        const backlogIdSet = new Set(backlogIds);
        const allSiblings = Object.values(state.workItems)
          .filter((wi) => {
            if (!backlogIdSet.has(wi.backlogAssignments[treeId])) return false;
            if (mainItem.parentId === null) {
              return (
                wi.parentId === null ||
                !state.workItems[wi.parentId] ||
                !backlogIdSet.has(state.workItems[wi.parentId].backlogAssignments[treeId])
              );
            }
            return wi.parentId === mainItem.parentId;
          })
          .sort((a, b) => a.rank - b.rank);

        const movingItemsSet = new Set(itemsToMoveIds);
        const remainingSiblings = allSiblings.filter((s) => !movingItemsSet.has(s.id));
        const clampedIndex = Math.max(0, Math.min(targetIndex, remainingSiblings.length));

        const movingItemsObjects = allSiblings.filter((s) => movingItemsSet.has(s.id));
        const reordered = [...remainingSiblings];
        reordered.splice(clampedIndex, 0, ...movingItemsObjects);

        const updatedItems = { ...state.workItems };
        const changedItems: WorkItem[] = [];

        reordered.forEach((s, i) => {
          const updated = { ...updatedItems[s.id], rank: i };
          updatedItems[s.id] = updated;
          changedItems.push(updated);
        });

        // Use the store action to log
        itemsToMoveIds.forEach((id) => {
          const item = state.workItems[id];
          if (item) {
            get().logChange({
              action: "Reorder item",
              entityType: "work_item",
              entityId: id,
              entityName: item.title,
              details: `Moved to new list position ${clampedIndex + 1}`,
            });
          }
        });

        upsertWorkItems(changedItems, orgId);
        return { ...pushUndo(state), workItems: updatedItems };
      });
    },

    // ... (rest of the actions follow same pattern calling get().logChange)
    moveWorkItemToBacklog: (workItemId, targetBacklogId, treeId) => {
      set((state) => {
        const orgId = getOrgId(state);
        const item = state.workItems[workItemId];
        if (!item) return state;
        const undo = pushUndo(state);
        const updatedItems = { ...state.workItems };
        const changedItems: WorkItem[] = [];
        const moveRecursive = (id: string) => {
          const wi = updatedItems[id];
          if (!wi) return;
          const updated = { ...wi, backlogAssignments: { ...wi.backlogAssignments, [treeId]: targetBacklogId } };
          updatedItems[id] = updated;
          changedItems.push(updated);
          wi.childrenIds.forEach(moveRecursive);
        };
        moveRecursive(workItemId);
        get().logChange({
          action: "Move to backlog",
          entityType: "work_item",
          entityId: workItemId,
          entityName: item.title,
          details: `Moved to backlog ${targetBacklogId}`,
        });
        upsertWorkItems(changedItems, orgId);
        return { ...undo, workItems: updatedItems };
      });
    },
    // (Repeat similar patterns for rename, delete, etc.)
  };
});
