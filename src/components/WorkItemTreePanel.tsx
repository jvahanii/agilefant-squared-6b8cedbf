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
  return `${orgId}::${parts[parts.length - 1]}`;
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
      if (cleanTrees[cleanT] && cleanBacklogs[cleanB]) validAssignments[cleanT] = cleanB;
    });
    cleanWorkItems[id] = {
      ...wi,
      id,
      parentId: wi.parentId ? ensureCleanId(wi.parentId, orgId) : null,
      backlogAssignments: validAssignments,
      childrenIds: [],
    };
  });

  [cleanWorkItems, cleanBacklogs].forEach((dict) => {
    Object.values(dict)
      .sort((a: any, b: any) => (a.rank || 0) - (b.rank || 0))
      .forEach((item: any) => {
        if (item.parentId && dict[item.parentId]) {
          const parent = dict[item.parentId];
          if (!parent.childrenIds.includes(item.id)) parent.childrenIds.push(item.id);
        }
      });
  });

  return { workItems: cleanWorkItems, backlogs: cleanBacklogs, backlogTrees: cleanTrees };
}

const snapshot = (state: DataSnapshot): DataSnapshot =>
  JSON.parse(
    JSON.stringify({
      ...state,
      expandedWorkItems: Array.from(state.expandedWorkItems),
      expandedBacklogs: Array.from(state.expandedBacklogs),
    }),
  );

const MAX_UNDO = 100;

export const useAppStore = create<AppState>()((set, get) => {
  const internalLog = (entry: Omit<ChangeLogEntry, "timestamp">) =>
    set((s) => ({ changeLog: [...s.changeLog, { ...entry, timestamp: new Date().toISOString() }] }));

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
      if (!orgId) return set({ isLoading: false });
      try {
        const raw = await loadFromSupabase(orgId);
        set({ ...sanitizeData(raw, orgId), isLoading: false, undoStack: [], redoStack: [] });
      } catch {
        set({ isLoading: false });
      }
    },
    toggleWorkItemExpand: (id) =>
      set((s) => {
        const n = new Set(s.expandedWorkItems);
        n.has(id) ? n.delete(id) : n.add(id);
        return { expandedWorkItems: n };
      }),
    toggleBacklogExpand: (id) =>
      set((s) => {
        const n = new Set(s.expandedBacklogs);
        n.has(id) ? n.delete(id) : n.add(id);
        return { expandedBacklogs: n };
      }),
    selectBacklog: (id, tId, ctrl) =>
      set((s) => ({
        selectedBacklogIds:
          ctrl && s.selectedTreeId === tId
            ? s.selectedBacklogIds.includes(id)
              ? s.selectedBacklogIds.filter((x) => x !== id)
              : [...s.selectedBacklogIds, id]
            : [id],
        selectedTreeId: tId,
        selectedWorkItemIds: [],
      })),
    selectWorkItem: (id, ctrl) =>
      set((s) => ({
        selectedWorkItemIds: !id
          ? []
          : ctrl
            ? s.selectedWorkItemIds.includes(id)
              ? s.selectedWorkItemIds.filter((x) => x !== id)
              : [...s.selectedWorkItemIds, id]
            : [id],
      })),
    clearWorkItemSelection: () => set({ selectedWorkItemIds: [] }),
    reorderWorkItemAmongSiblings: (id, idx, tId, bIds) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId) return;
      const main = s.workItems[id];
      if (!main) return;
      const movingIds = s.selectedWorkItemIds.includes(id) ? s.selectedWorkItemIds : [id];
      const bSet = new Set(bIds.map((x) => ensureCleanId(x, orgId)));
      const siblings = Object.values(s.workItems)
        .filter((wi) => bSet.has(wi.backlogAssignments[tId]) && wi.parentId === main.parentId)
        .sort((a, b) => a.rank - b.rank);
      const remaining = siblings.filter((x) => !movingIds.includes(x.id));
      const reordered = [...remaining];
      reordered.splice(
        Math.max(0, Math.min(idx, remaining.length)),
        0,
        ...siblings.filter((x) => movingIds.includes(x.id)),
      );
      const updated = { ...s.workItems };
      reordered.forEach((x, i) => {
        updated[x.id] = { ...updated[x.id], rank: i };
      });
      upsertWorkItems(
        reordered.map((x) => updated[x.id]),
        orgId,
      );
      set({ workItems: updated, undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)], redoStack: [] });
    },
    moveWorkItemToBacklog: (id, targetBl, tId) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId) return;
      const cleanTarget = ensureCleanId(targetBl, orgId);
      const updated = { ...s.workItems };
      const changed: any[] = [];
      const move = (currId: string) => {
        const wi = updated[currId];
        if (!wi) return;
        updated[currId] = { ...wi, backlogAssignments: { ...wi.backlogAssignments, [tId]: cleanTarget } };
        changed.push(updated[currId]);
        wi.childrenIds.forEach(move);
      };
      move(id);
      upsertWorkItems(changed, orgId);
      set({ workItems: updated, undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)] });
    },
    addWorkItem: (title, parentId, backlogId, treeId, reqRank) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId) return;
      const updated = { ...s.workItems };
      const toDb: any[] = [];
      const finalRank = reqRank ?? 0;
      Object.values(updated).forEach((wi) => {
        if (wi.parentId === parentId && wi.backlogAssignments[treeId] === backlogId && wi.rank >= finalRank) {
          updated[wi.id] = { ...wi, rank: wi.rank + 1 };
          toDb.push(updated[wi.id]);
        }
      });
      const id = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const newItem = {
        id,
        title,
        parentId,
        rank: finalRank,
        backlogAssignments: { [treeId]: backlogId },
        status: "not_started" as WorkItemStatus,
        childrenIds: [],
      };
      updated[id] = newItem;
      toDb.push(newItem);
      upsertWorkItems(toDb, orgId);
      if (parentId && updated[parentId])
        updated[parentId] = { ...updated[parentId], childrenIds: [...updated[parentId].childrenIds, id] };
      set({
        workItems: updated,
        selectedWorkItemIds: [id],
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)],
        redoStack: [],
      });
    },
    deleteWorkItem: (id) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId || !s.workItems[id]) return;
      const updated = { ...s.workItems };
      const delIds: string[] = [];
      const collect = (curr: string) => {
        delIds.push(curr);
        updated[curr]?.childrenIds.forEach(collect);
        delete updated[curr];
      };
      collect(id);
      deleteWorkItems(delIds, orgId);
      set({ workItems: updated, undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)] });
    },
    renameWorkItem: (id, title) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId || !s.workItems[id]) return;
      const up = { ...s.workItems[id], title };
      upsertWorkItem(up, orgId);
      set((st) => ({ workItems: { ...st.workItems, [id]: up } }));
    },
    setWorkItemStatus: (id, status) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId || !s.workItems[id]) return;
      const up = { ...s.workItems[id], status };
      upsertWorkItem(up, orgId);
      set((st) => ({ workItems: { ...st.workItems, [id]: up } }));
    },
    setWorkItemPoints: (id, pts) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId || !s.workItems[id]) return;
      const up = { ...s.workItems[id], points: pts };
      upsertWorkItem(up, orgId);
      set((st) => ({ workItems: { ...st.workItems, [id]: up } }));
    },
    removeWorkItemFromTree: (id, tId) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId || !s.workItems[id]) return;
      const updated = { ...s.workItems };
      const item = { ...updated[id] };
      delete item.backlogAssignments[tId];
      if (Object.keys(item.backlogAssignments).length === 0) {
        deleteWorkItems([id], orgId);
        delete updated[id];
      } else {
        upsertWorkItem(item, orgId);
        updated[id] = item;
      }
      set({ workItems: updated, undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)] });
    },
    reparentWorkItem: (id, pId, tId, bId) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId || !s.workItems[id]) return;
      const item = { ...s.workItems[id], parentId: pId };
      if (tId && bId) item.backlogAssignments = { ...item.backlogAssignments, [tId]: bId };
      upsertWorkItem(item, orgId);
      set((st) => ({
        workItems: { ...st.workItems, [id]: item },
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)],
      }));
    },
    addBacklog: (name, pId, tId) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId) return;
      const id = ensureCleanId(`bl-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const siblings = Object.values(s.backlogs).filter((x) => x.parentId === pId && x.treeId === tId);
      const nb: Backlog = { id, name, parentId: pId, treeId: tId, rank: siblings.length, childrenIds: [] };
      upsertBacklog(nb, orgId);
      const upTrees = { ...s.backlogTrees };
      if (!pId && upTrees[tId]) {
        upTrees[tId] = { ...upTrees[tId], rootBacklogIds: [...upTrees[tId].rootBacklogIds, id] };
        upsertBacklogTree(upTrees[tId], orgId);
      }
      set({
        backlogs: { ...s.backlogs, [id]: nb },
        backlogTrees: upTrees,
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)],
      });
    },
    deleteBacklog: (id) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId || !s.backlogs[id]) return;
      const upBls = { ...s.backlogs };
      const delIds: string[] = [];
      const collect = (curr: string) => {
        delIds.push(curr);
        upBls[curr]?.childrenIds.forEach(collect);
        delete upBls[curr];
      };
      collect(id);
      deleteBacklogs(delIds, orgId);
      set({ backlogs: upBls, undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)] });
    },
    renameBacklog: (id, name) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId || !s.backlogs[id]) return;
      const up = { ...s.backlogs[id], name };
      upsertBacklog(up, orgId);
      set((st) => ({ backlogs: { ...st.backlogs, [id]: up } }));
    },
    reorderBacklogAmongSiblings: (id, idx, tPId, tId) => {
      const s = get();
      const orgId = s.organizationId;
      const bl = s.backlogs[id];
      if (!orgId || !bl) return;
      const pId = tPId !== undefined ? tPId : bl.parentId;
      const tid = tId || bl.treeId;
      const sibs = Object.values(s.backlogs)
        .filter((x) => x.parentId === pId && x.treeId === tid && x.id !== id)
        .sort((a, b) => a.rank - b.rank);
      sibs.splice(Math.max(0, Math.min(idx, sibs.length)), 0, bl);
      const upBls = { ...s.backlogs };
      sibs.forEach((x, i) => {
        upBls[x.id] = { ...upBls[x.id], rank: i, parentId: pId };
      });
      upsertBacklogs(sibs, orgId);
      const upTrees = { ...s.backlogTrees };
      if (!pId && upTrees[tid]) {
        upTrees[tid].rootBacklogIds = sibs.map((x) => x.id);
        upsertBacklogTree(upTrees[tid], orgId);
      }
      set({ backlogs: upBls, backlogTrees: upTrees, undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)] });
    },
    moveBacklog: (id, tPId, tId) => get().reorderBacklogAmongSiblings(id, 9999, tPId, tId),
    addBacklogTree: (name) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId) return;
      const id = ensureCleanId(`tree-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const nt: BacklogTree = { id, name, rootBacklogIds: [], rank: Object.keys(s.backlogTrees).length };
      upsertBacklogTree(nt, orgId);
      set({
        backlogTrees: { ...s.backlogTrees, [id]: nt },
        undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)],
      });
    },
    deleteBacklogTree: (tId) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId) return;
      deleteBacklogTreeDB(tId, orgId);
      const upTrees = { ...s.backlogTrees };
      delete upTrees[tId];
      set({ backlogTrees: upTrees, undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)] });
    },
    renameBacklogTree: (tId, name) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId || !s.backlogTrees[tId]) return;
      const up = { ...s.backlogTrees[tId], name };
      upsertBacklogTree(up, orgId);
      set((st) => ({ backlogTrees: { ...st.backlogTrees, [tId]: up } }));
    },
    reorderBacklogTree: (tId, idx) => {
      const s = get();
      const orgId = s.organizationId;
      if (!orgId) return;
      const all = Object.values(s.backlogTrees).sort((a, b) => a.rank - b.rank);
      const target = all.find((x) => x.id === tId);
      if (!target) return;
      const rem = all.filter((x) => x.id !== tId);
      rem.splice(Math.max(0, Math.min(idx, rem.length)), 0, target);
      const upTrees = { ...s.backlogTrees };
      rem.forEach((x, i) => {
        upTrees[x.id] = { ...x, rank: i };
      });
      upsertBacklogTrees(rem, orgId);
      set({ backlogTrees: upTrees, undoStack: [...s.undoStack.slice(-(MAX_UNDO - 1)), snapshot(s)] });
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
      set({ ...sanitizeData(mock, orgId), isLoading: false, undoStack: [], redoStack: [] });
    },
    undo: () => {
      const { undoStack, redoStack, ...curr } = get();
      if (undoStack.length === 0) return;
      const prev = undoStack[undoStack.length - 1];
      set({
        ...prev,
        expandedWorkItems: new Set(prev.expandedWorkItems as any),
        expandedBacklogs: new Set(prev.expandedBacklogs as any),
        undoStack: undoStack.slice(0, -1),
        redoStack: [snapshot(curr as any), ...redoStack],
      });
    },
    redo: () => {
      const { undoStack, redoStack, ...curr } = get();
      if (redoStack.length === 0) return;
      const next = redoStack[0];
      set({
        ...next,
        expandedWorkItems: new Set(next.expandedWorkItems as any),
        expandedBacklogs: new Set(next.expandedBacklogs as any),
        undoStack: [...undoStack, snapshot(curr as any)],
        redoStack: redoStack.slice(1),
      });
    },
  };
});
