import { create } from "zustand";
import { WorkItem, WorkItemStatus, Backlog, BacklogTree, Hyperlink } from "@/types/models";
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
  loadHyperlinksForWorkItems,
  upsertHyperlink,
  deleteHyperlink as deleteHyperlinkDB,
} from "./supabaseSync";
import { mockData as staticMockData } from "./mockData";

function generateMockData() {
  return JSON.parse(JSON.stringify(staticMockData));
}

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
  /** Maps workItemId -> ordered list of hyperlinks */
  hyperlinks: Record<string, Hyperlink[]>;
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
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string, rank?: number) => void;
  bulkAddWorkItems: (titles: string[], parentId: string | null, backlogId: string, treeId: string) => void;
  deleteWorkItem: (workItemId: string) => void;
  renameWorkItem: (workItemId: string, title: string) => void;
  setWorkItemStatus: (workItemId: string, status: WorkItemStatus) => void;
  setWorkItemPoints: (workItemId: string, points: number | undefined) => void;
  removeWorkItemFromTree: (workItemId: string, treeId: string) => void;
  reparentWorkItem: (workItemId: string, newParentId: string | null, treeId?: string, backlogId?: string) => void;
  setWorkItemRespawn: (workItemId: string, respawnEnabled: boolean, respawnIntervalDays?: number, respawnHour?: number) => void;
  respawnItem: (workItemId: string) => void;
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
  addHyperlink: (workItemId: string, url: string, altText: string) => void;
  updateHyperlink: (linkId: string, workItemId: string, url: string, altText: string) => void;
  removeHyperlink: (linkId: string, workItemId: string) => void;
  loadHyperlinksForItem: (workItemId: string) => Promise<void>;
  applyRealtimeWorkItem: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeBacklog: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeBacklogTree: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

const ensureCleanId = (id: string, orgId: string): string => {
  if (!id) return id;
  const parts = id.split("::");
  if (parts.length === 1) {
    // Unprefixed (mock/legacy) ID – IDs never contain '::' in their raw part,
    // so any '::' means the ID is already org-scoped.
    return `${orgId}::${id}`;
  }
  // Already prefixed. Strip any extra levels of nesting (e.g. orgA::orgA::rawId → orgA::rawId)
  // but preserve the existing owner prefix so shared entities keep their original org scope.
  return `${parts[parts.length - 2]}::${parts[parts.length - 1]}`;
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
  hyperlinks: JSON.parse(JSON.stringify(state.hyperlinks)),
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
    hyperlinks: {},
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

        // Load hyperlinks for all work items
        const workItemIds = Object.keys(cleanData.workItems);
        const hyperlinks = await loadHyperlinksForWorkItems(workItemIds);

        const parseStoredIds = (key: string): string[] => {
          try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        };
        const storedBacklogIds = parseStoredIds(`selection_${orgId}_backlogIds`);
        const storedTreeId: string | null = localStorage.getItem(`selection_${orgId}_treeId`);
        const storedWorkItemIds = parseStoredIds(`selection_${orgId}_workItemIds`);

        const validBacklogIds = storedBacklogIds.filter((id) => cleanData.backlogs[id]);
        const validTreeId = storedTreeId && cleanData.backlogTrees[storedTreeId] ? storedTreeId : null;
        const validWorkItemIds = storedWorkItemIds.filter((id) => cleanData.workItems[id]);

        // Expand all ancestor backlogs so selected backlog items are visible
        const expandedBacklogs = new Set<string>();
        for (const id of validBacklogIds) {
          let current = cleanData.backlogs[id];
          while (current?.parentId) {
            expandedBacklogs.add(current.parentId);
            current = cleanData.backlogs[current.parentId];
          }
        }

        // Expand all ancestor work items so selected work items are visible
        const expandedWorkItems = new Set<string>();
        for (const id of validWorkItemIds) {
          let current = cleanData.workItems[id];
          while (current?.parentId) {
            expandedWorkItems.add(current.parentId);
            current = cleanData.workItems[current.parentId];
          }
        }

        set({
          ...cleanData,
          hyperlinks,
          isLoading: false,
          undoStack: [],
          redoStack: [],
          selectedBacklogIds: validBacklogIds,
          selectedTreeId: validTreeId,
          selectedWorkItemIds: validWorkItemIds,
          expandedBacklogs,
          expandedWorkItems,
        });
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
        const orgId = get().organizationId;
        if (orgId) {
          localStorage.setItem(`selection_${orgId}_backlogIds`, JSON.stringify(ids));
          localStorage.setItem(`selection_${orgId}_treeId`, treeId);
          localStorage.removeItem(`selection_${orgId}_workItemIds`);
        }
        return { selectedBacklogIds: ids, selectedTreeId: treeId, selectedWorkItemIds: [] };
      }),

    selectWorkItem: (workItemId, ctrlKey) =>
      set((state) => {
        const orgId = get().organizationId;
        if (!workItemId) {
          if (orgId) localStorage.removeItem(`selection_${orgId}_workItemIds`);
          return { selectedWorkItemIds: [] };
        }
        const ids = ctrlKey
          ? state.selectedWorkItemIds.includes(workItemId)
            ? state.selectedWorkItemIds.filter((id) => id !== workItemId)
            : [...state.selectedWorkItemIds, workItemId]
          : [workItemId];
        if (orgId) {
          localStorage.setItem(`selection_${orgId}_workItemIds`, JSON.stringify(ids));
        }
        return { selectedWorkItemIds: ids };
      }),

    clearWorkItemSelection: () => {
      const orgId = get().organizationId;
      if (orgId) localStorage.removeItem(`selection_${orgId}_workItemIds`);
      set({ selectedWorkItemIds: [] });
    },

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

    addWorkItem: (title, parentId, backlogId, treeId, requestedRank) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;

      const updatedWorkItems = { ...state.workItems };
      const itemsToUpdateInDB: WorkItem[] = [];

      let finalRank: number;
      if (requestedRank != null) {
        finalRank = requestedRank;
      } else {
        let maxRank = -1;
        Object.values(state.workItems).forEach((wi) => {
          if (wi.parentId === parentId && wi.backlogAssignments[treeId] === backlogId) {
            if (wi.rank > maxRank) maxRank = wi.rank;
          }
        });
        finalRank = maxRank + 1;
      }

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

      const newExpanded = new Set(state.expandedWorkItems);
      if (parentId) newExpanded.add(parentId);

      set({
        workItems: updatedWorkItems,
        selectedWorkItemIds: [id],
        expandedWorkItems: newExpanded,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });

      internalLog({ action: "Add", entityType: "work_item", entityId: id, entityName: title });
    },

    bulkAddWorkItems: (titles, parentId, backlogId, treeId) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || titles.length === 0) return;

      const updatedWorkItems = { ...state.workItems };
      let maxRank = -1;
      Object.values(updatedWorkItems).forEach((wi) => {
        if (wi.parentId === parentId && wi.backlogAssignments[treeId] === backlogId) {
          if (wi.rank > maxRank) maxRank = wi.rank;
        }
      });

      const newItems: WorkItem[] = [];
      titles.forEach((title, i) => {
        const id = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
        const newItem: WorkItem = {
          id,
          title,
          parentId,
          rank: maxRank + 1 + i,
          backlogAssignments: { [treeId]: backlogId },
          status: "not_started" as WorkItemStatus,
          childrenIds: [],
          points: undefined,
        };
        updatedWorkItems[id] = newItem;
        newItems.push(newItem);

        if (parentId && updatedWorkItems[parentId]) {
          updatedWorkItems[parentId] = {
            ...updatedWorkItems[parentId],
            childrenIds: [...updatedWorkItems[parentId].childrenIds, id],
          };
        }
      });

      upsertWorkItems(newItems, orgId);
      internalLog({ action: "Bulk Add", entityType: "work_item", details: `${titles.length} items added` });

      set({
        workItems: updatedWorkItems,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    deleteWorkItem: (workItemId) => {
      const state = get();
      const item = state.workItems[workItemId];
      if (!item) return;

      const idsToDelete: string[] = [];
      const collectIds = (id: string) => {
        idsToDelete.push(id);
        state.workItems[id]?.childrenIds.forEach(collectIds);
      };
      collectIds(workItemId);

      const updatedItems = { ...state.workItems };
      idsToDelete.forEach((id) => delete updatedItems[id]);

      // Clean up all deleted items from their parents' childrenIds
      idsToDelete.forEach((deletedId) => {
        const deletedItem = state.workItems[deletedId];
        if (deletedItem?.parentId && updatedItems[deletedItem.parentId]) {
          updatedItems[deletedItem.parentId] = {
            ...updatedItems[deletedItem.parentId],
            childrenIds: updatedItems[deletedItem.parentId].childrenIds.filter((id) => id !== deletedId),
          };
        }
      });

      deleteWorkItems(idsToDelete)?.catch((err) => console.error("Delete work item failed", err));
      internalLog({ action: "Delete", entityType: "work_item", entityId: workItemId, entityName: item.title });
      set({
        workItems: updatedItems,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    renameWorkItem: (workItemId, title) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updated = { ...item, title };
      upsertWorkItem(updated, orgId);
      internalLog({ action: "Rename", entityType: "work_item", entityId: workItemId, entityName: title });
      set({
        workItems: { ...state.workItems, [workItemId]: updated },
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    setWorkItemStatus: (workItemId, status) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updatedWorkItems = { ...state.workItems, [workItemId]: { ...item, status } };
      upsertWorkItem(updatedWorkItems[workItemId], orgId);
      internalLog({ action: "Status Change", entityType: "work_item", entityId: workItemId, details: status });
      if (status === "in_progress") {
        const visited = new Set<string>([workItemId]);
        let ancestorId = item.parentId;
        while (ancestorId && !visited.has(ancestorId)) {
          visited.add(ancestorId);
          const ancestor = updatedWorkItems[ancestorId];
          if (!ancestor) break;
          if (ancestor.status !== "in_progress") {
            updatedWorkItems[ancestorId] = { ...ancestor, status: "in_progress" };
            upsertWorkItem(updatedWorkItems[ancestorId], orgId);
            internalLog({ action: "Status Change", entityType: "work_item", entityId: ancestorId, details: "in_progress" });
          }
          ancestorId = ancestor.parentId;
        }
      }
      set({
        workItems: updatedWorkItems,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    setWorkItemPoints: (workItemId, points) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updated = { ...item, points };
      upsertWorkItem(updated, orgId);
      internalLog({
        action: "Set Points",
        entityType: "work_item",
        entityId: workItemId,
        details: String(points ?? "none"),
      });
      set({
        workItems: { ...state.workItems, [workItemId]: updated },
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    removeWorkItemFromTree: (workItemId, treeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const newAssignments = { ...item.backlogAssignments };
      delete newAssignments[treeId];
      if (Object.keys(newAssignments).length === 0) {
        get().deleteWorkItem(workItemId);
        return;
      }
      const updated = { ...item, backlogAssignments: newAssignments };
      upsertWorkItem(updated, orgId);
      internalLog({ action: "Remove from Tree", entityType: "work_item", entityId: workItemId });
      set({
        workItems: { ...state.workItems, [workItemId]: updated },
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    reparentWorkItem: (workItemId, newParentId, _treeId, _backlogId) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updatedItems = { ...state.workItems };
      if (item.parentId && updatedItems[item.parentId]) {
        updatedItems[item.parentId] = {
          ...updatedItems[item.parentId],
          childrenIds: updatedItems[item.parentId].childrenIds.filter((id) => id !== workItemId),
        };
      }
      if (newParentId && updatedItems[newParentId]) {
        updatedItems[newParentId] = {
          ...updatedItems[newParentId],
          childrenIds: [...updatedItems[newParentId].childrenIds, workItemId],
        };
      }
      updatedItems[workItemId] = { ...item, parentId: newParentId };
      const changed = [updatedItems[workItemId]];
      if (item.parentId && updatedItems[item.parentId]) changed.push(updatedItems[item.parentId]);
      if (newParentId && updatedItems[newParentId]) changed.push(updatedItems[newParentId]);
      upsertWorkItems(changed, orgId);
      internalLog({ action: "Reparent", entityType: "work_item", entityId: workItemId });
      set({
        workItems: updatedItems,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    setWorkItemRespawn: (workItemId, respawnEnabled, respawnIntervalDays, respawnHour) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updated: WorkItem = {
        ...item,
        respawnEnabled,
        respawnIntervalDays: respawnEnabled ? respawnIntervalDays : undefined,
        respawnHour: respawnEnabled ? respawnHour : undefined,
      };
      upsertWorkItem(updated, orgId);
      internalLog({ action: "Set Respawn", entityType: "work_item", entityId: workItemId });
      set({ workItems: { ...state.workItems, [workItemId]: updated } });
    },

    respawnItem: (workItemId) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;
      const item = state.workItems[workItemId];
      if (!item || !item.respawnEnabled) return;

      const updatedWorkItems = { ...state.workItems };
      const itemsToUpdateInDB: WorkItem[] = [];

      if (Object.keys(item.backlogAssignments).length === 0) return;

      const insertRank = item.rank + 1;

      // Shift siblings below the original item down across ALL backlog tree contexts
      Object.values(updatedWorkItems).forEach((wi) => {
        if (wi.id === workItemId) return;
        const isSiblingInAnyContext =
          wi.parentId === item.parentId &&
          Object.entries(item.backlogAssignments).some(
            ([treeId, backlogId]) => wi.backlogAssignments[treeId] === backlogId
          );
        if (isSiblingInAnyContext && wi.rank >= insertRank) {
          const shifted = { ...wi, rank: wi.rank + 1 };
          updatedWorkItems[wi.id] = shifted;
          itemsToUpdateInDB.push(shifted);
        }
      });

      const newId = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const copy: WorkItem = {
        id: newId,
        title: item.title,
        description: item.description,
        points: item.points,
        parentId: item.parentId,
        rank: insertRank,
        backlogAssignments: { ...item.backlogAssignments },
        status: "not_started" as WorkItemStatus,
        childrenIds: [],
      };
      updatedWorkItems[newId] = copy;
      itemsToUpdateInDB.push(copy);

      if (item.parentId && updatedWorkItems[item.parentId]) {
        updatedWorkItems[item.parentId] = {
          ...updatedWorkItems[item.parentId],
          childrenIds: [...updatedWorkItems[item.parentId].childrenIds, newId],
        };
      }

      // Update lastTriggeredAt on the source item
      const now = new Date().toISOString();
      const updatedSource: WorkItem = { ...item, respawnLastTriggeredAt: now };
      updatedWorkItems[workItemId] = updatedSource;
      itemsToUpdateInDB.push(updatedSource);

      upsertWorkItems(itemsToUpdateInDB, orgId);
      internalLog({ action: "Respawn", entityType: "work_item", entityId: workItemId, entityName: item.title });
      set({ workItems: updatedWorkItems });
    },

    addBacklog: (name, parentId, treeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const id = ensureCleanId(`bl-${crypto.randomUUID().slice(0, 8)}`, orgId);
      let maxRank = -1;
      Object.values(state.backlogs).forEach((bl) => {
        const isSibling = parentId ? bl.parentId === parentId : !bl.parentId && bl.treeId === treeId;
        if (isSibling && bl.rank > maxRank) maxRank = bl.rank;
      });
      const newBacklog: Backlog = { id, name, parentId, childrenIds: [], treeId, rank: maxRank + 1 };
      const updatedBacklogs = { ...state.backlogs, [id]: newBacklog };
      const updatedTrees = { ...state.backlogTrees };
      if (parentId && updatedBacklogs[parentId]) {
        updatedBacklogs[parentId] = {
          ...updatedBacklogs[parentId],
          childrenIds: [...updatedBacklogs[parentId].childrenIds, id],
        };
      } else if (updatedTrees[treeId]) {
        updatedTrees[treeId] = {
          ...updatedTrees[treeId],
          rootBacklogIds: [...updatedTrees[treeId].rootBacklogIds, id],
        };
      }
      upsertBacklog(newBacklog, orgId);
      internalLog({ action: "Add", entityType: "backlog", entityId: id, entityName: name });

      const newExpandedBacklogs = new Set(state.expandedBacklogs);
      if (parentId) newExpandedBacklogs.add(parentId);

      set({
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        selectedBacklogIds: [id],
        selectedTreeId: treeId,
        expandedBacklogs: newExpandedBacklogs,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    deleteBacklog: (backlogId) => {
      const state = get();
      const bl = state.backlogs[backlogId];
      if (!bl) return;

      const blIdsToDelete: string[] = [];
      const collectBlIds = (id: string) => {
        blIdsToDelete.push(id);
        state.backlogs[id]?.childrenIds.forEach(collectBlIds);
      };
      collectBlIds(backlogId);
      const blIdSet = new Set(blIdsToDelete);

      const wiIdsToDelete: string[] = [];
      const updatedItems = { ...state.workItems };
      Object.values(updatedItems).forEach((wi) => {
        const newAssignments = { ...wi.backlogAssignments };
        Object.entries(newAssignments).forEach(([tId, bId]) => {
          if (blIdSet.has(bId)) delete newAssignments[tId];
        });
        if (Object.keys(newAssignments).length === 0) {
          wiIdsToDelete.push(wi.id);
        } else if (Object.keys(newAssignments).length !== Object.keys(wi.backlogAssignments).length) {
          updatedItems[wi.id] = { ...wi, backlogAssignments: newAssignments };
        }
      });

      // Korjataan "Ghost Parent" siivoamalla orvot lapset vanhemmilta
      wiIdsToDelete.forEach((childId) => {
        const childItem = state.workItems[childId];
        if (childItem && childItem.parentId && updatedItems[childItem.parentId]) {
          updatedItems[childItem.parentId] = {
            ...updatedItems[childItem.parentId],
            childrenIds: updatedItems[childItem.parentId].childrenIds.filter((id) => id !== childId),
          };
        }
      });

      wiIdsToDelete.forEach((id) => delete updatedItems[id]);
      const updatedBacklogs = { ...state.backlogs };
      blIdsToDelete.forEach((id) => delete updatedBacklogs[id]);

      const updatedTrees = { ...state.backlogTrees };
      if (bl.parentId && updatedBacklogs[bl.parentId]) {
        updatedBacklogs[bl.parentId] = {
          ...updatedBacklogs[bl.parentId],
          childrenIds: updatedBacklogs[bl.parentId].childrenIds.filter((id) => id !== backlogId),
        };
      } else if (updatedTrees[bl.treeId]) {
        updatedTrees[bl.treeId] = {
          ...updatedTrees[bl.treeId],
          rootBacklogIds: updatedTrees[bl.treeId].rootBacklogIds.filter((id) => id !== backlogId),
        };
      }

      deleteWorkItems(wiIdsToDelete)?.catch((err) => console.error("Delete work items failed", err));
      deleteBacklogs(blIdsToDelete)?.catch((err) => console.error("Delete backlogs failed", err));
      internalLog({ action: "Delete", entityType: "backlog", entityId: backlogId, entityName: bl.name });
      set({
        workItems: updatedItems,
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    renameBacklog: (backlogId, name) => {
      const state = get();
      const orgId = state.organizationId!;
      const bl = state.backlogs[backlogId];
      if (!bl) return;
      const updated = { ...bl, name };
      upsertBacklog(updated, orgId);
      internalLog({ action: "Rename", entityType: "backlog", entityId: backlogId, entityName: name });
      set({
        backlogs: { ...state.backlogs, [backlogId]: updated },
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    reorderBacklogAmongSiblings: (backlogId, targetIndex, _targetParentId, _treeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const bl = state.backlogs[backlogId];
      if (!bl) return;
      const siblingIds = bl.parentId
        ? (state.backlogs[bl.parentId]?.childrenIds ?? [])
        : (state.backlogTrees[bl.treeId]?.rootBacklogIds ?? []);
      const siblings = siblingIds.map((id) => state.backlogs[id]).filter(Boolean);
      const remaining = siblings.filter((s) => s.id !== backlogId);
      const clamped = Math.max(0, Math.min(targetIndex, remaining.length));
      remaining.splice(clamped, 0, bl);
      const updatedBacklogs = { ...state.backlogs };
      remaining.forEach((s, i) => {
        updatedBacklogs[s.id] = { ...updatedBacklogs[s.id], rank: i };
      });
      const newIds = remaining.map((s) => s.id);
      const updatedTrees = { ...state.backlogTrees };
      if (bl.parentId && updatedBacklogs[bl.parentId]) {
        updatedBacklogs[bl.parentId] = { ...updatedBacklogs[bl.parentId], childrenIds: newIds };
      } else if (updatedTrees[bl.treeId]) {
        updatedTrees[bl.treeId] = { ...updatedTrees[bl.treeId], rootBacklogIds: newIds };
      }
      upsertBacklogs(
        remaining.map((s) => updatedBacklogs[s.id]),
        orgId,
      );
      internalLog({ action: "Reorder", entityType: "backlog" });
      set({
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    moveBacklog: (backlogId, targetParentId, treeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const bl = state.backlogs[backlogId];
      if (!bl) return;
      const updatedBacklogs = { ...state.backlogs };
      const updatedTrees = { ...state.backlogTrees };
      if (bl.parentId && updatedBacklogs[bl.parentId]) {
        updatedBacklogs[bl.parentId] = {
          ...updatedBacklogs[bl.parentId],
          childrenIds: updatedBacklogs[bl.parentId].childrenIds.filter((id) => id !== backlogId),
        };
      } else if (updatedTrees[bl.treeId]) {
        updatedTrees[bl.treeId] = {
          ...updatedTrees[bl.treeId],
          rootBacklogIds: updatedTrees[bl.treeId].rootBacklogIds.filter((id) => id !== backlogId),
        };
      }
      if (targetParentId && updatedBacklogs[targetParentId]) {
        updatedBacklogs[targetParentId] = {
          ...updatedBacklogs[targetParentId],
          childrenIds: [...updatedBacklogs[targetParentId].childrenIds, backlogId],
        };
      } else if (updatedTrees[treeId]) {
        updatedTrees[treeId] = {
          ...updatedTrees[treeId],
          rootBacklogIds: [...updatedTrees[treeId].rootBacklogIds, backlogId],
        };
      }
      updatedBacklogs[backlogId] = { ...bl, parentId: targetParentId, treeId };
      upsertBacklog(updatedBacklogs[backlogId], orgId);
      internalLog({ action: "Move", entityType: "backlog", entityId: backlogId });
      set({
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    addBacklogTree: (name) => {
      const state = get();
      const orgId = state.organizationId!;
      const id = ensureCleanId(`bt-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const rank = Object.keys(state.backlogTrees).length;
      const newTree: BacklogTree = { id, name, rootBacklogIds: [], rank };
      upsertBacklogTree(newTree, orgId);
      internalLog({ action: "Add", entityType: "backlog_tree", entityId: id, entityName: name });
      set({
        backlogTrees: { ...state.backlogTrees, [id]: newTree },
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    deleteBacklogTree: (treeId) => {
      const state = get();
      const blIdsToDelete = Object.values(state.backlogs)
        .filter((bl) => bl.treeId === treeId)
        .map((bl) => bl.id);
      const blIdSet = new Set(blIdsToDelete);
      const wiIdsToDelete: string[] = [];
      const updatedItems = { ...state.workItems };
      Object.values(updatedItems).forEach((wi) => {
        const newAssignments = { ...wi.backlogAssignments };
        delete newAssignments[treeId];
        Object.entries(newAssignments).forEach(([tId, bId]) => {
          if (blIdSet.has(bId)) delete newAssignments[tId];
        });
        if (Object.keys(newAssignments).length === 0) wiIdsToDelete.push(wi.id);
        else updatedItems[wi.id] = { ...wi, backlogAssignments: newAssignments };
      });
      wiIdsToDelete.forEach((id) => delete updatedItems[id]);
      const updatedBacklogs = { ...state.backlogs };
      blIdsToDelete.forEach((id) => delete updatedBacklogs[id]);
      const updatedTrees = { ...state.backlogTrees };
      delete updatedTrees[treeId];
      deleteWorkItems(wiIdsToDelete);
      deleteBacklogs(blIdsToDelete);
      deleteBacklogTreeDB(treeId);
      internalLog({ action: "Delete", entityType: "backlog_tree", entityId: treeId });
      set({
        workItems: updatedItems,
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    renameBacklogTree: (treeId, name) => {
      const state = get();
      const orgId = state.organizationId!;
      const tree = state.backlogTrees[treeId];
      if (!tree) return;
      const updated = { ...tree, name };
      upsertBacklogTree(updated, orgId);
      internalLog({ action: "Rename", entityType: "backlog_tree", entityId: treeId, entityName: name });
      set({
        backlogTrees: { ...state.backlogTrees, [treeId]: updated },
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    reorderBacklogTree: (treeId, targetIndex) => {
      const state = get();
      const orgId = state.organizationId!;
      const sorted = Object.values(state.backlogTrees).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      const remaining = sorted.filter((t) => t.id !== treeId);
      const tree = sorted.find((t) => t.id === treeId);
      if (!tree) return;
      const clamped = Math.max(0, Math.min(targetIndex, remaining.length));
      remaining.splice(clamped, 0, tree);
      const updatedTrees = { ...state.backlogTrees };
      remaining.forEach((t, i) => {
        updatedTrees[t.id] = { ...updatedTrees[t.id], rank: i };
      });
      upsertBacklogTrees(
        remaining.map((t) => updatedTrees[t.id]),
        orgId,
      );
      internalLog({ action: "Reorder", entityType: "backlog_tree" });
      set({
        backlogTrees: updatedTrees,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    resetToMockData: async () => {
      const orgId = get().organizationId;
      if (!orgId) return;
      set({ isLoading: true });
      try {
        const mockData = generateMockData();
        await resetOrgData(orgId, mockData);
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

    addHyperlink: (workItemId, url, altText) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;
      const existing = state.hyperlinks[workItemId] ?? [];
      const id = crypto.randomUUID();
      const newLink: Hyperlink = {
        id,
        workItemId,
        url,
        altText,
        rank: existing.length,
      };
      upsertHyperlink(newLink, orgId);
      internalLog({ action: "Add Hyperlink", entityType: "hyperlink", entityId: workItemId, details: url });
      set({
        hyperlinks: { ...state.hyperlinks, [workItemId]: [...existing, newLink] },
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    updateHyperlink: (linkId, workItemId, url, altText) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;
      const existing = state.hyperlinks[workItemId] ?? [];
      const idx = existing.findIndex((l) => l.id === linkId);
      if (idx === -1) return;
      const updated: Hyperlink = { ...existing[idx], url, altText };
      upsertHyperlink(updated, orgId);
      internalLog({ action: "Update Hyperlink", entityType: "hyperlink", entityId: workItemId, details: url });
      const newList = [...existing];
      newList[idx] = updated;
      set({
        hyperlinks: { ...state.hyperlinks, [workItemId]: newList },
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    removeHyperlink: (linkId, workItemId) => {
      const state = get();
      const existing = state.hyperlinks[workItemId] ?? [];
      const filtered = existing.filter((l) => l.id !== linkId);
      deleteHyperlinkDB(linkId);
      internalLog({ action: "Remove Hyperlink", entityType: "hyperlink", entityId: workItemId });
      set({
        hyperlinks: { ...state.hyperlinks, [workItemId]: filtered },
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    loadHyperlinksForItem: async (workItemId) => {
      const links = await loadHyperlinksForWorkItems([workItemId]);
      set((state) => ({
        hyperlinks: { ...state.hyperlinks, [workItemId]: links[workItemId] ?? [] },
      }));
    },

    applyRealtimeWorkItem: (eventType, row) => {
      set((state) => {
        const id = row.id as string;

        if (eventType === 'DELETE') {
          if (!state.workItems[id]) return state;
          const oldItem = state.workItems[id];
          const updatedWorkItems = { ...state.workItems };
          delete updatedWorkItems[id];
          if (oldItem.parentId && updatedWorkItems[oldItem.parentId]) {
            updatedWorkItems[oldItem.parentId] = {
              ...updatedWorkItems[oldItem.parentId],
              childrenIds: updatedWorkItems[oldItem.parentId].childrenIds.filter((cid) => cid !== id),
            };
          }
          return { workItems: updatedWorkItems };
        }

        // INSERT or UPDATE: preserve existing childrenIds from current state
        const newItem: WorkItem = {
          id,
          title: row.title as string,
          description: (row.description as string | null) ?? undefined,
          points: (row.points as number | null) ?? undefined,
          status: ((row.status as string) ?? 'not_started') as WorkItemStatus,
          parentId: (row.parent_id as string | null) ?? null,
          childrenIds: state.workItems[id]?.childrenIds ?? [],
          backlogAssignments: (row.backlog_assignments as Record<string, string>) ?? {},
          rank: row.rank as number,
          respawnEnabled: (row.respawn_enabled as boolean) ?? false,
          respawnIntervalDays: (row.respawn_interval_days as number | null) ?? undefined,
          respawnHour: (row.respawn_hour as number | null) ?? undefined,
          respawnLastTriggeredAt: (row.respawn_last_triggered_at as string | null) ?? undefined,
        };

        const updatedWorkItems = { ...state.workItems, [id]: newItem };

        const sortWorkItemIds = (ids: string[]) =>
          [...ids].sort((a, b) => (updatedWorkItems[a]?.rank ?? 0) - (updatedWorkItems[b]?.rank ?? 0));

        const oldItem = state.workItems[id];
        const oldParentId = oldItem?.parentId ?? null;

        if (eventType === 'INSERT' || oldParentId !== newItem.parentId) {
          // Remove from old parent (UPDATE reparent case)
          if (oldParentId && oldParentId !== newItem.parentId && updatedWorkItems[oldParentId]) {
            updatedWorkItems[oldParentId] = {
              ...updatedWorkItems[oldParentId],
              childrenIds: updatedWorkItems[oldParentId].childrenIds.filter((cid) => cid !== id),
            };
          }
          // Add to new parent if not already there
          if (newItem.parentId && updatedWorkItems[newItem.parentId]) {
            const parent = updatedWorkItems[newItem.parentId];
            if (!parent.childrenIds.includes(id)) {
              updatedWorkItems[newItem.parentId] = { ...parent, childrenIds: sortWorkItemIds([...parent.childrenIds, id]) };
            }
          }
        } else if (newItem.parentId && updatedWorkItems[newItem.parentId]) {
          // Same non-null parent: re-sort childrenIds in case rank changed.
          // Note: root work items (parentId=null) have no childrenIds container – they are
          // rendered by querying work items directly sorted by rank, so no array update is needed.
          const parent = updatedWorkItems[newItem.parentId];
          updatedWorkItems[newItem.parentId] = { ...parent, childrenIds: sortWorkItemIds(parent.childrenIds) };
        }

        return { workItems: updatedWorkItems };
      });
    },

    applyRealtimeBacklog: (eventType, row) => {
      set((state) => {
        const id = row.id as string;

        if (eventType === 'DELETE') {
          if (!state.backlogs[id]) return state;
          const bl = state.backlogs[id];
          const updatedBacklogs = { ...state.backlogs };
          delete updatedBacklogs[id];
          const updatedTrees = { ...state.backlogTrees };
          if (bl.parentId && updatedBacklogs[bl.parentId]) {
            updatedBacklogs[bl.parentId] = {
              ...updatedBacklogs[bl.parentId],
              childrenIds: updatedBacklogs[bl.parentId].childrenIds.filter((cid) => cid !== id),
            };
          } else if (updatedTrees[bl.treeId]) {
            updatedTrees[bl.treeId] = {
              ...updatedTrees[bl.treeId],
              rootBacklogIds: updatedTrees[bl.treeId].rootBacklogIds.filter((bid) => bid !== id),
            };
          }
          return { backlogs: updatedBacklogs, backlogTrees: updatedTrees };
        }

        // INSERT or UPDATE: preserve existing childrenIds from current state
        const newBacklog: Backlog = {
          id,
          name: row.name as string,
          parentId: (row.parent_id as string | null) ?? null,
          childrenIds: state.backlogs[id]?.childrenIds ?? [],
          treeId: row.tree_id as string,
          rank: row.rank as number,
        };

        const updatedBacklogs = { ...state.backlogs, [id]: newBacklog };
        const updatedTrees = { ...state.backlogTrees };

        const sortBacklogIds = (ids: string[]) =>
          [...ids].sort((a, b) => (updatedBacklogs[a]?.rank ?? 0) - (updatedBacklogs[b]?.rank ?? 0));

        const oldBacklog = state.backlogs[id];
        const oldParentId = oldBacklog?.parentId ?? null;
        const oldTreeId = oldBacklog?.treeId ?? null;
        const parentChanged = oldParentId !== newBacklog.parentId || oldTreeId !== newBacklog.treeId;

        if (eventType === 'INSERT' || parentChanged) {
          // Remove from old location (UPDATE reparent case)
          if (oldBacklog && parentChanged) {
            if (oldParentId && updatedBacklogs[oldParentId]) {
              updatedBacklogs[oldParentId] = {
                ...updatedBacklogs[oldParentId],
                childrenIds: updatedBacklogs[oldParentId].childrenIds.filter((cid) => cid !== id),
              };
            } else if (oldTreeId && updatedTrees[oldTreeId]) {
              updatedTrees[oldTreeId] = {
                ...updatedTrees[oldTreeId],
                rootBacklogIds: updatedTrees[oldTreeId].rootBacklogIds.filter((bid) => bid !== id),
              };
            }
          }
          // Add to new location if not already present
          if (newBacklog.parentId && updatedBacklogs[newBacklog.parentId]) {
            const parent = updatedBacklogs[newBacklog.parentId];
            if (!parent.childrenIds.includes(id)) {
              updatedBacklogs[newBacklog.parentId] = { ...parent, childrenIds: sortBacklogIds([...parent.childrenIds, id]) };
            }
          } else if (updatedTrees[newBacklog.treeId]) {
            const tree = updatedTrees[newBacklog.treeId];
            if (!tree.rootBacklogIds.includes(id)) {
              updatedTrees[newBacklog.treeId] = { ...tree, rootBacklogIds: sortBacklogIds([...tree.rootBacklogIds, id]) };
            }
          }
        } else {
          // Same parent: re-sort in case rank changed
          if (newBacklog.parentId && updatedBacklogs[newBacklog.parentId]) {
            const parent = updatedBacklogs[newBacklog.parentId];
            updatedBacklogs[newBacklog.parentId] = { ...parent, childrenIds: sortBacklogIds(parent.childrenIds) };
          } else if (updatedTrees[newBacklog.treeId]) {
            const tree = updatedTrees[newBacklog.treeId];
            updatedTrees[newBacklog.treeId] = { ...tree, rootBacklogIds: sortBacklogIds(tree.rootBacklogIds) };
          }
        }

        return { backlogs: updatedBacklogs, backlogTrees: updatedTrees };
      });
    },

    applyRealtimeBacklogTree: (eventType, row) => {
      set((state) => {
        const id = row.id as string;

        if (eventType === 'DELETE') {
          if (!state.backlogTrees[id]) return state;
          const updatedTrees = { ...state.backlogTrees };
          delete updatedTrees[id];
          return { backlogTrees: updatedTrees };
        }

        // INSERT or UPDATE: preserve existing rootBacklogIds so backlogs stay attached
        const newTree: BacklogTree = {
          id,
          name: row.name as string,
          rank: row.rank as number,
          rootBacklogIds: state.backlogTrees[id]?.rootBacklogIds ?? [],
        };

        return { backlogTrees: { ...state.backlogTrees, [id]: newTree } };
      });
    },
  };
});
