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
  changeLog: ChangeLogEntry[];
}

interface AppState extends DataSnapshot {
  isLoading: boolean;
  organizationId: string | null;
  undoStack: DataSnapshot[];
  redoStack: DataSnapshot[];
  setOrganizationId: (orgId: string) => void;
  loadFromSupabase: () => Promise<void>;
  logChange: (entry: Omit<ChangeLogEntry, "timestamp">) => void;
  clearChangeLog: () => void;
  // ... (keeping your action signatures)
  reorderWorkItemAmongSiblings: (workItemId: string, targetIndex: number, treeId: string, backlogIds: string[]) => void;
  moveWorkItemToBacklog: (workItemId: string, targetBacklogId: string, treeId: string) => void;
  resetToMockData: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  // (Include all other actions from your original file here)
}

const snapshot = (state: DataSnapshot): DataSnapshot => ({
  workItems: state.workItems,
  backlogs: state.backlogs,
  backlogTrees: state.backlogTrees,
  selectedBacklogIds: [...state.selectedBacklogIds],
  selectedTreeId: state.selectedTreeId,
  selectedWorkItemIds: [...state.selectedWorkItemIds],
  changeLog: [...state.changeLog],
});

export const useAppStore = create<AppState>()((set, get) => {
  // INTERNAL HELPER: This is the safest way to log without build errors
  const internalLog = (entry: Omit<ChangeLogEntry, "timestamp">) => {
    set((state) => ({
      changeLog: [...state.changeLog, { ...entry, timestamp: new Date().toISOString() }],
    }));
  };

  return {
    workItems: {},
    backlogs: {},
    backlogTrees: {},
    selectedBacklogIds: [],
    selectedTreeId: null,
    selectedWorkItemIds: [],
    changeLog: [],
    undoStack: [],
    redoStack: [],
    isLoading: true,
    organizationId: null,

    setOrganizationId: (orgId) => set({ organizationId: orgId }),

    logChange: (entry) => internalLog(entry),

    clearChangeLog: () => set({ changeLog: [] }),

    resetToMockData: async () => {
      const orgId = get().organizationId;
      if (!orgId) return;
      set({ isLoading: true });
      try {
        const mockData = generateMockData();
        await resetOrgData(orgId, mockData);
        set({ changeLog: [] });
        internalLog({ action: "Reset to mock data", entityType: "data" });
        await get().loadFromSupabase();
      } catch (err) {
        set({ isLoading: false });
      }
    },

    reorderWorkItemAmongSiblings: (workItemId, targetIndex, treeId, backlogIds) => {
      set((state) => {
        const item = state.workItems[workItemId];
        if (!item) return state;

        const itemsToMoveIds = state.selectedWorkItemIds.includes(workItemId)
          ? state.selectedWorkItemIds
          : [workItemId];

        // ... (your reordering logic)

        // LOGGING
        itemsToMoveIds.forEach((id) => {
          const wi = state.workItems[id];
          if (wi) {
            internalLog({
              action: "Reorder item",
              entityType: "work_item",
              entityId: id,
              entityName: wi.title,
              details: `Rank updated to index ${targetIndex}`,
            });
          }
        });

        return { workItems: state.workItems }; // Return updated state
      });
    },

    // ... (rest of your actions)
  };
});
