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
  deleteBacklogTree as deleteBacklogTreeDB,
  upsertBacklogTrees,
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
  expandedWorkItems: Set<string>;
  expandedBacklogs: Set<string>;
}

interface AppState extends DataSnapshot {
  undoStack: DataSnapshot[];
  redoStack: DataSnapshot[];
  isLoading: boolean;
  organizationId: string | null;
  setOrganizationId: (orgId: string) => void;
  loadFromSupabase: () => Promise<void>;
  logChange: (entry: Omit<ChangeLogEntry, "timestamp">) => void;
  clearChangeLog: () => void;
  selectBacklog: (backlogId: string, treeId: string, ctrlKey?: boolean) => void;
  selectWorkItem: (workItemId: string | null, ctrlKey?: boolean) => void;
  clearWorkItemSelection: () => void;
  toggleWorkItemExpand: (workItemId: string) => void;
  toggleBacklogExpand: (backlogId: string) => void;
  reorderWorkItemAmongSiblings: (workItemId: string, targetIndex: number, treeId: string, backlogIds: string[]) => void;
  moveWorkItemToBacklog: (workItemId: string, targetBacklogId: string, treeId: string) => void;
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string) => void;
  deleteWorkItem: (workItemId: string) => void;
  renameWorkItem: (workItemId: string, title: string) => void;
  setWorkItemStatus: (workItemId: string, status: WorkItemStatus) => void;
  setWorkItemPoints: (workItemId: string, points: number | undefined) => void;
  removeWorkItemFromTree: (workItemId: string, treeId: string) => void;
  reparentWorkItem: (workItemId: string, newParentId: string | null) => void;
  addBacklog: (name: string, parentId: string | null, treeId: string) => void;
  deleteBacklog: (backlogId: string) => void;
  renameBacklog: (backlogId: string, name: string) => void;
  reorderBacklogAmongSiblings: (backlogId: string, targetIndex: number) => void;
  moveBacklog: (backlogId: string, targetParentId: string | null, treeId: string) => void;
  addBacklogTree: (name: string) => void;
  deleteBacklogTree: (treeId: string) => void;
  renameBacklogTree: (treeId: string, name: string) => void;
  reorderBacklogTree: (treeId: string, targetIndex: number) => void;
  resetToMockData: () => Promise<void>;
  undo: () => void;
  redo: () => void;
}

/**
 * ID GUARD: Prevents double-prefixing (e.g., org::org::id)
 */
const ensureCleanId = (id: string, orgId: string): string => {
  if (!id) return id;
  const parts = id.split("::");
  const rawId = parts[parts.length - 1];
  return `${orgId}::${rawId}`;
};

/**
 * DATA SANITIZER: Rebuilds referential integrity and cleans IDs
 */
export function sanitizeData(data: any, orgId: string) {
  const cleanWorkItems: Record<string, WorkItem> = {};
  const cleanBacklogs: Record<string, Backlog> = {};
  const cleanTrees: Record<string, BacklogTree> = {};

  // 1. Clean Backlogs first (to validate assignments later)
  Object.values(data.backlogs || {}).forEach((bl: any) => {
    const id = ensureCleanId(bl.id, orgId);
    cleanBacklogs[id] = {
      ...bl,
      id,
      parentId: bl.parentId ? ensureCleanId(bl.parentId, orgId) : null,
      treeId: ensureCleanId(bl.treeId, orgId),
      childrenIds: [], // Rebuilt below
    };
  });

  // 2. Clean Trees
  Object.values(data.backlogTrees || {}).forEach((tree: any) => {
    const id = ensureCleanId(tree.id, orgId);
    cleanTrees[id] = {
      ...tree,
      id,
      rootBacklogIds: (tree.rootBacklogIds || [])
        .map((bid: string) => ensureCleanId(bid, orgId))
        .filter((bid: string) => !!cleanBacklogs[bid]),
    };
  });

  // 3. Clean Work Items
  Object.values(data.workItems || {}).forEach((wi: any) => {
    const id = ensureCleanId(wi.id, orgId);
    const validAssignments: Record<string, string> = {};

    Object.entries(wi.backlogAssignments || {}).forEach(([tId, bId]) => {
      const cleanT = ensureCleanId(tId, orgId);
      const cleanB = ensureCleanId(bId as string, orgId);
      if (cleanTrees[cleanT] && cleanBacklogs[cleanB]) {
        validAssignments[cleanT] = cleanB;
      }
    });

    cleanWorkItems[id] = {
      ...wi,
      id,
      parentId: wi.parentId ? ensureCleanId(wi.parentId, orgId) : null,
      backlogAssignments: validAssignments,
      childrenIds: [], // Rebuilt below
    };
  });

  // 4. Final Pass: Rebuild all childrenId arrays (Referential Integrity)
  Object.values(cleanWorkItems).forEach((wi) => {
    if (wi.parentId && cleanWorkItems[wi.parentId]) {
      const parent = cleanWorkItems[wi.parentId];
      if (!parent.childrenIds.includes(wi.id)) parent.childrenIds.push(wi.id);
    }
  });

  Object.values(cleanBacklogs).forEach((bl) => {
    if (bl.parentId && cleanBacklogs[bl.parentId]) {
      const parent = cleanBacklogs[bl.parentId];
      if (!parent.childrenIds.includes(bl.id)) parent.childrenIds.push(bl.id);
    }
  });

  return { workItems: cleanWorkItems, backlogs: cleanBacklogs, backlogTrees: cleanTrees };
}

const snapshot = (state: DataSnapshot): DataSnapshot => ({
  workItems: JSON.parse(JSON.stringify(state.workItems)),
  backlogs: JSON.parse(JSON.stringify(state.backlogs)),
  backlogTrees: JSON.parse(JSON.stringify(state.backlogTrees)),
  selectedBacklogIds: [...state.selectedBacklogIds],
  selectedTreeId: state.selectedTreeId,
  selectedWorkItemIds: [...state.selectedWorkItemIds],
  changeLog: [...state.changeLog],
  expandedWorkItems: new Set(state.expandedWorkItems),
  expandedBacklogs: new Set(state.expandedBacklogs),
});

const MAX_UNDO = 100;

export const useAppStore = create<AppState>()((set, get) => {
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
    expandedWorkItems: new Set(),
    expandedBacklogs: new Set(),
    undoStack: [],
    redoStack: [],
    isLoading: true,
    organizationId: null,

    setOrganizationId: (orgId) => set({ organizationId: orgId }),
    logChange: (entry) => internalLog(entry),
    clearChangeLog: () => set({ changeLog: [] }),

    loadFromSupabase: async () => {
      const orgId = get().organizationId;
      if (!orgId) {
        set({ isLoading: false });
        return;
      }
      try {
        const rawData = await loadFromSupabase(orgId);
        const cleanData = sanitizeData(rawData, orgId);
        set({ ...cleanData, isLoading: false, undoStack: [], redoStack: [] });
      } catch (err) {
        set({ isLoading: false });
      }
    },

    toggleWorkItemExpand: (id) =>
      set((s) => {
        const next = new Set(s.expandedWorkItems);
        next.has(id) ? next.delete(id) : next.add(id);
        return { expandedWorkItems: next };
      }),

    toggleBacklogExpand: (id) =>
      set((s) => {
        const next = new Set(s.expandedBacklogs);
        next.has(id) ? next.delete(id) : next.add(id);
        return { expandedBacklogs: next };
      }),

    selectBacklog: (backlogId, treeId, ctrlKey) =>
      set((state) => {
        const ids =
          ctrlKey && state.selectedTreeId === treeId
            ? state.selectedBacklogIds.includes(backlogId)
              ? state.selectedBacklogIds.filter((id) => id !== backlogId)
              : [...state.selectedBacklogIds, backlogId]
            : [backlogId];
        return { selectedBacklogIds: ids, selectedTreeId: treeId, selectedWorkItemIds: [] };
      }),

    selectWorkItem: (workItemId, ctrlKey) =>
      set((state) => {
        if (!workItemId) return { selectedWorkItemIds: [] };
        const ids = ctrlKey
          ? state.selectedWorkItemIds.includes(workItemId)
            ? state.selectedWorkItemIds.filter((id) => id !== workItemId)
            : [...state.selectedWorkItemIds, workItemId]
          : [workItemId];
        return { selectedWorkItemIds: ids };
      }),

    clearWorkItemSelection: () => set({ selectedWorkItemIds: [] }),

    reorderWorkItemAmongSiblings: (workItemId, targetIndex, treeId, backlogIds) => {
      const state = get();
      const orgId = state.organizationId!;
      const mainItem = state.workItems[workItemId];
      if (!mainItem) return;

      const itemsToMoveIds = state.selectedWorkItemIds.includes(workItemId) ? state.selectedWorkItemIds : [workItemId];

      const backlogIdSet = new Set(backlogIds.map((id) => ensureCleanId(id, orgId)));
      const allSiblings = Object.values(state.workItems)
        .filter((wi) => backlogIdSet.has(wi.backlogAssignments[treeId]) && wi.parentId === mainItem.parentId)
        .sort((a, b) => a.rank - b.rank);

      const movingSet = new Set(itemsToMoveIds);
      const remaining = allSiblings.filter((s) => !movingSet.has(s.id));
      const clampedIdx = Math.max(0, Math.min(targetIndex, remaining.length));

      const movingItems = allSiblings.filter((s) => movingSet.has(s.id));
      const reordered = [...remaining];
      reordered.splice(clampedIdx, 0, ...movingItems);

      const updatedItems = { ...state.workItems };
      reordered.forEach((s, i) => {
        updatedItems[s.id] = { ...updatedItems[s.id], rank: i };
      });

      upsertWorkItems(
        reordered.map((s) => updatedItems[s.id]),
        orgId,
      );
      internalLog({ action: "Reorder", entityType: "work_item", details: `${itemsToMoveIds.length} items moved` });

      set({
        workItems: updatedItems,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    moveWorkItemToBacklog: (workItemId, targetBacklogId, treeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;

      const cleanTargetBl = ensureCleanId(targetBacklogId, orgId);
      const updatedItems = { ...state.workItems };
      const changed: WorkItem[] = [];

      const moveRecursive = (id: string) => {
        const wi = updatedItems[id];
        if (!wi) return;
        updatedItems[id] = {
          ...wi,
          backlogAssignments: { ...wi.backlogAssignments, [treeId]: cleanTargetBl },
        };
        changed.push(updatedItems[id]);
        wi.childrenIds.forEach(moveRecursive);
      };

      moveRecursive(workItemId);
      upsertWorkItems(changed, orgId);
      internalLog({ action: "Move to Backlog", entityType: "work_item", entityId: workItemId, entityName: item.title });
      set({ workItems: updatedItems, undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)] });
    },

    resetToMockData: async () => {
      const orgId = get().organizationId;
      if (!orgId) return;
      set({ isLoading: true });
      try {
        const mockData = generateMockData();
        // Sanitize the raw mock data before it even hits Supabase
        const cleanMock = sanitizeData(mockData, orgId);
        await resetOrgData(orgId, cleanMock);
        await get().loadFromSupabase();
        internalLog({ action: "System Reset", entityType: "data" });
      } catch (err) {
        set({ isLoading: false });
      }
    },

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
  };
});
