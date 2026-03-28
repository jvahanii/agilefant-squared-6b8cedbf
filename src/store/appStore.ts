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
  addWorkItem: (
    title: string,
    parentId: string | null,
    backlogId: string,
    treeId: string,
    requestedRank?: number,
  ) => void;
  deleteWorkItem: (workItemId: string) => void;
  renameWorkItem: (workItemId: string, title: string) => void;
  setWorkItemStatus: (workItemId: string, status: WorkItemStatus) => void;
  setWorkItemPoints: (workItemId: string, points: number | undefined) => void;
  removeWorkItemFromTree: (workItemId: string, treeId: string) => void;
  reparentWorkItem: (workItemId: string, newParentId: string | null, treeId?: string, backlogId?: string) => void;
  addBacklog: (name: string, parentId: string | null, treeId: string) => void;
  deleteBacklog: (backlogId: string) => void;
  renameBacklog: (backlogId: string, name: string) => void;
  reorderBacklogAmongSiblings: (
    backlogId: string,
    targetIndex: number,
    targetParentId?: string | null,
    treeId?: string,
  ) => void;
  moveBacklog: (backlogId: string, targetParentId: string | null, treeId: string) => void;
  addBacklogTree: (name: string) => void;
  deleteBacklogTree: (treeId: string) => void;
  renameBacklogTree: (treeId: string, name: string) => void;
  reorderBacklogTree: (treeId: string, targetIndex: number) => void;
  resetToMockData: () => Promise<void>;
  undo: () => void;
  redo: () => void;
}

const ensureCleanId = (id: string, orgId: string): string => {
  if (!id) return id;
  const parts = id.split("::");
  const rawId = parts[parts.length - 1];
  return `${orgId}::${rawId}`;
};

export function sanitizeData(data: any, orgId: string) {
  const cleanWorkItems: Record<string, WorkItem> = {};
  const cleanBacklogs: Record<string, Backlog> = {};
  const cleanTrees: Record<string, BacklogTree> = {};

  Object.values(data.backlogs || {}).forEach((bl: any) => {
    const id = ensureCleanId(bl.id, orgId);
    cleanBacklogs[id] = {
      ...bl,
      id,
      parentId: bl.parentId ? ensureCleanId(bl.parentId, orgId) : null,
      treeId: ensureCleanId(bl.treeId, orgId),
      childrenIds: [],
    };
  });

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
      childrenIds: [],
    };
  });

  const sortedWorkItems = Object.values(cleanWorkItems).sort((a, b) => (a.rank || 0) - (b.rank || 0));
  sortedWorkItems.forEach((wi) => {
    if (wi.parentId && cleanWorkItems[wi.parentId]) {
      const parent = cleanWorkItems[wi.parentId];
      if (!parent.childrenIds.includes(wi.id)) parent.childrenIds.push(wi.id);
    }
  });

  const sortedBacklogs = Object.values(cleanBacklogs).sort((a, b) => (a.rank || 0) - (b.rank || 0));
  sortedBacklogs.forEach((bl) => {
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
      const orgId = state.organizationId;
      if (!orgId) return;
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
      const orgId = state.organizationId;
      if (!orgId) return;
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

    addWorkItem: (title, parentId, backlogId, treeId, requestedRank) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;

      const updatedWorkItems = { ...state.workItems };
      const itemsToUpdateInDB: WorkItem[] = [];
      const finalRank = requestedRank ?? 0;

      Object.values(updatedWorkItems).forEach((wi) => {
        const isSameContext = wi.parentId === parentId && wi.backlogAssignments[treeId] === backlogId;

        if (isSameContext && wi.rank >= finalRank) {
          const updatedItem = { ...wi, rank: wi.rank + 1 };
          updatedWorkItems[wi.id] = updatedItem;
          itemsToUpdateInDB.push(updatedItem);
        }
      });

      const id = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const newItem: WorkItem = {
        id,
        title,
        parentId,
        rank: finalRank,
        backlogAssignments: { [treeId]: backlogId },
        status: "not_started" as WorkItemStatus,
        childrenIds: [],
        points: undefined,
      };

      updatedWorkItems[id] = newItem;
      itemsToUpdateInDB.push(newItem);

      upsertWorkItems(itemsToUpdateInDB, orgId);

      if (parentId && updatedWorkItems[parentId]) {
        updatedWorkItems[parentId] = {
          ...updatedWorkItems[parentId],
          childrenIds: [...updatedWorkItems[parentId].childrenIds, id],
        };
      }

      internalLog({ action: "Add", entityType: "work_item", entityId: id, entityName: title });

      set({
        workItems: updatedWorkItems,
        selectedWorkItemIds: [id],
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },
    deleteWorkItem: (workItemId) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || !state.workItems[workItemId]) return;

      const updatedWorkItems = { ...state.workItems };
      const deletedIds: string[] = [];

      const collect = (id: string) => {
        deletedIds.push(id);
        updatedWorkItems[id]?.childrenIds.forEach(collect);
        delete updatedWorkItems[id];
      };
      collect(workItemId);

      deleteWorkItems(deletedIds, orgId);
      internalLog({ action: "Delete", entityType: "work_item", entityId: workItemId });
      set({ workItems: updatedWorkItems, undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)] });
    },

    renameWorkItem: (workItemId, title) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || !state.workItems[workItemId]) return;

      const updated = { ...state.workItems[workItemId], title };
      upsertWorkItem(updated, orgId);
      set((s) => ({ workItems: { ...s.workItems, [workItemId]: updated } }));
    },

    setWorkItemStatus: (workItemId, status) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || !state.workItems[workItemId]) return;

      const updated = { ...state.workItems[workItemId], status };
      upsertWorkItem(updated, orgId);
      set((s) => ({ workItems: { ...s.workItems, [workItemId]: updated } }));
    },

    setWorkItemPoints: (workItemId, points) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || !state.workItems[workItemId]) return;

      const updated = { ...state.workItems[workItemId], points };
      upsertWorkItem(updated, orgId);
      set((s) => ({ workItems: { ...s.workItems, [workItemId]: updated } }));
    },

    removeWorkItemFromTree: (workItemId, treeId) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || !state.workItems[workItemId]) return;

      const updatedWorkItems = { ...state.workItems };
      const item = { ...updatedWorkItems[workItemId] };
      delete item.backlogAssignments[treeId];

      if (Object.keys(item.backlogAssignments).length === 0) {
        deleteWorkItems([workItemId], orgId);
        delete updatedWorkItems[workItemId];
      } else {
        upsertWorkItem(item, orgId);
        updatedWorkItems[workItemId] = item;
      }

      set({ workItems: updatedWorkItems, undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)] });
    },

    reparentWorkItem: (workItemId, newParentId, treeId, backlogId) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || !state.workItems[workItemId]) return;

      const updatedWorkItems = { ...state.workItems };
      const item = { ...updatedWorkItems[workItemId], parentId: newParentId };

      if (treeId && backlogId) {
        item.backlogAssignments = { ...item.backlogAssignments, [treeId]: backlogId };
      }

      upsertWorkItem(item, orgId);
      updatedWorkItems[workItemId] = item;
      set({ workItems: updatedWorkItems, undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)] });
    },

    addBacklog: (name, parentId, treeId) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;

      const id = ensureCleanId(`bl-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const siblings = Object.values(state.backlogs).filter((bl) => bl.parentId === parentId && bl.treeId === treeId);
      const newBacklog: Backlog = {
        id,
        name,
        parentId,
        treeId,
        rank: siblings.length,
        childrenIds: [],
      };

      upsertBacklog(newBacklog, orgId);

      const updatedBacklogs = { ...state.backlogs, [id]: newBacklog };
      const updatedTrees = { ...state.backlogTrees };
      if (!parentId && updatedTrees[treeId]) {
        updatedTrees[treeId] = {
          ...updatedTrees[treeId],
          rootBacklogIds: [...updatedTrees[treeId].rootBacklogIds, id],
        };
        upsertBacklogTree(updatedTrees[treeId], orgId);
      }

      set({
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
      });
    },

    deleteBacklog: (backlogId) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || !state.backlogs[backlogId]) return;

      const updatedBacklogs = { ...state.backlogs };
      const deletedIds: string[] = [];

      const collect = (id: string) => {
        deletedIds.push(id);
        updatedBacklogs[id]?.childrenIds.forEach(collect);
        delete updatedBacklogs[id];
      };
      collect(backlogId);

      deleteBacklogs(deletedIds, orgId);
      set({ backlogs: updatedBacklogs, undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)] });
    },

    renameBacklog: (backlogId, name) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || !state.backlogs[backlogId]) return;

      const updated = { ...state.backlogs[backlogId], name };
      upsertBacklog(updated, orgId);
      set((s) => ({ backlogs: { ...s.backlogs, [backlogId]: updated } }));
    },

    reorderBacklogAmongSiblings: (backlogId, targetIndex, targetParentId, treeId) => {
      const state = get();
      const orgId = state.organizationId;
      const bl = state.backlogs[backlogId];
      if (!orgId || !bl) return;

      const parentId = targetParentId !== undefined ? targetParentId : bl.parentId;
      const tid = treeId || bl.treeId;

      const allSiblings = Object.values(state.backlogs)
        .filter((b) => b.parentId === parentId && b.treeId === tid && b.id !== backlogId)
        .sort((a, b) => a.rank - b.rank);

      allSiblings.splice(Math.max(0, Math.min(targetIndex, allSiblings.length)), 0, bl);

      const updatedBacklogs = { ...state.backlogs };
      allSiblings.forEach((b, i) => {
        updatedBacklogs[b.id] = { ...updatedBacklogs[b.id], rank: i, parentId };
      });

      upsertBacklogs(allSiblings, orgId);

      const updatedTrees = { ...state.backlogTrees };
      if (!parentId && updatedTrees[tid]) {
        updatedTrees[tid].rootBacklogIds = allSiblings.map((s) => s.id);
        upsertBacklogTree(updatedTrees[tid], orgId);
      }

      set({
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
      });
    },

    moveBacklog: (backlogId, targetParentId, treeId) => {
      get().reorderBacklogAmongSiblings(backlogId, 9999, targetParentId, treeId);
    },

    addBacklogTree: (name) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;

      const id = ensureCleanId(`tree-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const newTree: BacklogTree = { id, name, rootBacklogIds: [], rank: Object.keys(state.backlogTrees).length };

      upsertBacklogTree(newTree, orgId);
      set({
        backlogTrees: { ...state.backlogTrees, [id]: newTree },
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
      });
    },

    deleteBacklogTree: (treeId) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;

      deleteBacklogTreeDB(treeId, orgId);
      const updatedTrees = { ...state.backlogTrees };
      delete updatedTrees[treeId];
      set({ backlogTrees: updatedTrees, undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)] });
    },

    renameBacklogTree: (treeId, name) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || !state.backlogTrees[treeId]) return;

      const updated = { ...state.backlogTrees[treeId], name };
      upsertBacklogTree(updated, orgId);
      set((s) => ({ backlogTrees: { ...s.backlogTrees, [treeId]: updated } }));
    },

    reorderBacklogTree: (treeId, targetIndex) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;

      const allTrees = Object.values(state.backlogTrees).sort((a, b) => a.rank - b.rank);
      const target = allTrees.find((t) => t.id === treeId);
      if (!target) return;

      const remaining = allTrees.filter((t) => t.id !== treeId);
      remaining.splice(Math.max(0, Math.min(targetIndex, remaining.length)), 0, target);

      const updatedTrees = { ...state.backlogTrees };
      remaining.forEach((t, i) => {
        updatedTrees[t.id] = { ...t, rank: i };
      });

      upsertBacklogTrees(remaining, orgId);
      set({
        backlogTrees: updatedTrees,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
      });
    },

    resetToMockData: async () => {
      const orgId = get().organizationId;
      if (!orgId) return;
      set({ isLoading: true });
      await resetOrgData(orgId);
      const mock = generateMockData(orgId);
      await Promise.all([
        upsertBacklogTrees(Object.values(mock.backlogTrees), orgId),
        upsertBacklogs(Object.values(mock.backlogs), orgId),
        upsertWorkItems(Object.values(mock.workItems), orgId),
      ]);
      const cleanData = sanitizeData(mock, orgId);
      set({ ...cleanData, isLoading: false, undoStack: [], redoStack: [] });
    },

    undo: () => {
      const { undoStack, redoStack, ...currentState } = get();
      if (undoStack.length === 0) return;
      const previous = undoStack[undoStack.length - 1];
      const newUndo = undoStack.slice(0, -1);
      set({
        ...previous,
        undoStack: newUndo,
        redoStack: [snapshot(currentState as unknown as DataSnapshot), ...redoStack],
      });
    },

    redo: () => {
      const { undoStack, redoStack, ...currentState } = get();
      if (redoStack.length === 0) return;
      const next = redoStack[0];
      const newRedo = redoStack.slice(1);
      set({
        ...next,
        undoStack: [...undoStack, snapshot(currentState as unknown as DataSnapshot)],
        redoStack: newRedo,
      });
    },
  };
});
