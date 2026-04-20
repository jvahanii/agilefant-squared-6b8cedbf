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
  registerWorkItemRenameCallback,
} from "./supabaseSync";
import { mockData as staticMockData } from "./mockData";
import { insertChangeLogEntry, loadChangeLog, type ChangeLogEntry } from "./changeLog";
import { useTreeStatusesStore } from "./treeStatusesStore";

function generateMockData() {
  return JSON.parse(JSON.stringify(staticMockData));
}

/** Get the rank of a work item in a specific tree context. */
function getWorkItemRank(item: WorkItem, treeId: string): number {
  const backlogId = item.backlogAssignments[treeId];
  return backlogId ? (item.ranks[backlogId] ?? 0) : 0;
}

export type { ChangeLogEntry } from "./changeLog";

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
  userId: string | null;
  userEmail: string | null;
  setOrganizationId: (orgId: string) => void;
  setUser: (userId: string, userEmail: string) => void;
  loadFromSupabase: () => Promise<void>;
  logChange: (entry: Omit<ChangeLogEntry, "timestamp" | "id" | "userEmail">) => void;
  clearChangeLog: () => void;
  selectBacklog: (backlogId: string, treeId: string, ctrlKey?: boolean) => void;
  selectWorkItem: (workItemId: string | null, ctrlKey?: boolean) => void;
  clearWorkItemSelection: () => void;
  toggleWorkItemExpand: (workItemId: string) => void;
  toggleBacklogExpand: (backlogId: string) => void;
  expandWorkItemsRecursive: (workItemId: string) => void;
  collapseWorkItemsRecursive: (workItemId: string) => void;
  expandBacklogsRecursive: (backlogId: string) => void;
  collapseBacklogsRecursive: (backlogId: string) => void;
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
  applyRealtimeWorkItemRank: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeBacklog: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeBacklogTree: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeHyperlink: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

/**
 * Resolve duplicate work-item ranks in-place.  For each (treeId, backlogId,
 * parentId) group, items sharing a rank are re-numbered sequentially (ties
 * broken by ID for determinism).  Mutates `items` directly for performance.
 */
function dedupWorkItemRanksInPlace(items: Record<string, WorkItem>): void {
  const groups = new Map<string, string[]>();
  for (const wi of Object.values(items)) {
    for (const [treeId, blId] of Object.entries(wi.backlogAssignments)) {
      const key = `${treeId}::${blId}::${wi.parentId ?? 'ROOT'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(wi.id);
    }
  }
  groups.forEach((ids, key) => {
    const backlogId = key.split('::').slice(-3, -1).join('::');  // extract backlogId from key
    // Actually, the key format is `treeId::backlogId::parentId` but treeId and backlogId
    // themselves contain '::'. Parse from the group entries instead.
    if (ids.length < 2) return;
    // Get backlogId from the first item's assignment
    const firstItem = items[ids[0]];
    if (!firstItem) return;
    // Find the backlogId for this group by checking which treeId::blId matches
    let blId: string | null = null;
    for (const [_treeId, bId] of Object.entries(firstItem.backlogAssignments)) {
      // Check if this assignment matches the group key
      const testKey = `${_treeId}::${bId}::${firstItem.parentId ?? 'ROOT'}`;
      if (testKey === key) { blId = bId; break; }
    }
    if (!blId) return;

    const sorted = ids
      .filter((id) => items[id])
      .sort((a, b) => {
        const rA = items[a].ranks[blId!] ?? 0;
        const rB = items[b].ranks[blId!] ?? 0;
        return rA !== rB ? rA - rB : a.localeCompare(b);
      });

    let prev = -Infinity;
    for (const id of sorted) {
      const r = items[id].ranks[blId] ?? 0;
      if (r <= prev) {
        const newRank = prev + 1;
        items[id] = { ...items[id], ranks: { ...items[id].ranks, [blId]: newRank } };
        prev = newRank;
      } else {
        prev = r;
      }
    }
  });
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
    const validRanks: Record<string, number> = {};

    Object.entries(wi.backlogAssignments || {}).forEach(([tId, bId]) => {
      const cleanT = ensureCleanId(tId, orgId);
      const cleanB = ensureCleanId(bId as string, orgId);
      if (cleanTrees[cleanT] && cleanBacklogs[cleanB]) {
        validAssignments[cleanT] = cleanB;
        // Re-key ranks: try original backlogId first, then cleaned
        const origRank = (wi.ranks ?? {})[bId as string] ?? (wi.ranks ?? {})[cleanB] ?? 0;
        validRanks[cleanB] = origRank;
      }
    });

    cleanWorkItems[id] = {
      ...wi,
      id,
      parentId: wi.parentId ? ensureCleanId(wi.parentId, orgId) : null,
      backlogAssignments: validAssignments,
      ranks: validRanks,
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

  // Resolve any duplicate ranks that arrived from the DB
  dedupWorkItemRanksInPlace(cleanWorkItems);

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

/**
 * Applies a batch of work-item ID renames (old → new) to the store's data
 * snapshot.  Rewires every item's own `id`, `parentId` back-references,
 * `childrenIds`, the `hyperlinks` map, and the selected-work-item list.
 * Returns a partial state object suitable for passing directly to `set()`.
 */
function applyWorkItemIdRenames(
  state: Pick<AppState, 'workItems' | 'hyperlinks' | 'selectedWorkItemIds'>,
  oldToNew: Record<string, string>,
): Pick<AppState, 'workItems' | 'hyperlinks' | 'selectedWorkItemIds'> {
  if (Object.keys(oldToNew).length === 0) return {
    workItems: state.workItems,
    hyperlinks: state.hyperlinks,
    selectedWorkItemIds: state.selectedWorkItemIds,
  };

  const updatedWorkItems: Record<string, WorkItem> = {};
  for (const [id, item] of Object.entries(state.workItems)) {
    const newId = oldToNew[id] ?? id;
    updatedWorkItems[newId] = {
      ...item,
      id: newId,
      organizationId: item.organizationId, // preserve
      parentId: item.parentId ? (oldToNew[item.parentId] ?? item.parentId) : null,
      childrenIds: item.childrenIds.map(cid => oldToNew[cid] ?? cid),
    };
  }

  const updatedHyperlinks: Record<string, Hyperlink[]> = {};
  for (const [workItemId, links] of Object.entries(state.hyperlinks)) {
    const newWorkItemId = oldToNew[workItemId] ?? workItemId;
    updatedHyperlinks[newWorkItemId] = links.map(link => ({
      ...link,
      workItemId: newWorkItemId,
    }));
  }

  const updatedSelectedWorkItemIds = state.selectedWorkItemIds.map(id => oldToNew[id] ?? id);

  return {
    workItems: updatedWorkItems,
    hyperlinks: updatedHyperlinks,
    selectedWorkItemIds: updatedSelectedWorkItemIds,
  };
}

/**
 * Compute the set of work-item IDs whose rank in `backlogId` must be incremented
 * by 1 so that inserting an item at `insertRank` does not leave any duplicate
 * ranks within the same backlog.
 *
 * With per-backlog ranks, only items sharing the same (parentId, backlogId)
 * need to be considered — no cross-context cascade is necessary.
 */
function buildCascadedShiftSet(
  allItems: Record<string, WorkItem>,
  parentId: string | null,
  insertRank: number,
  excludeId: string | null,
  backlogId: string,
): Set<string> {
  const toShift = new Set<string>();

  for (const wi of Object.values(allItems)) {
    if (wi.parentId !== parentId) continue;
    if (excludeId && wi.id === excludeId) continue;
    // Only consider items that are assigned to the same backlog
    const wiBacklogIds = Object.values(wi.backlogAssignments);
    if (!wiBacklogIds.includes(backlogId)) continue;
    if ((wi.ranks[backlogId] ?? 0) >= insertRank) toShift.add(wi.id);
  }

  return toShift;
}

export const useAppStore = create<AppState>()((set, get) => {
  // Register a callback so supabaseSync can notify us when work-item IDs are
  // renamed (stale org prefix repaired).  This keeps local state consistent
  // without requiring each individual store action to be made async.
  registerWorkItemRenameCallback((oldToNew) => {
    set(state => applyWorkItemIdRenames(state, oldToNew));
  });

  const internalLog = (entry: Omit<ChangeLogEntry, "timestamp" | "id" | "userEmail">) => {
    const state = get();
    const orgId = state.organizationId;
    const userId = state.userId;
    const userEmail = state.userEmail ?? '';
    const fullEntry: ChangeLogEntry = { ...entry, timestamp: new Date().toISOString(), userEmail };
    set((s) => ({
      changeLog: [fullEntry, ...s.changeLog].slice(0, 5000),
    }));
    // Fire-and-forget persist to DB
    if (orgId && userId) {
      insertChangeLogEntry(orgId, userId, userEmail, entry).catch(() => {});
    }
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
    userId: null,
    userEmail: null,

    setOrganizationId: (orgId) => set({ organizationId: orgId }),
    setUser: (userId, userEmail) => set({ userId, userEmail }),
    logChange: (entry) => internalLog(entry),
    clearChangeLog: () => set({ changeLog: [] }),

    loadFromSupabase: async () => {
      const orgId = get().organizationId;
      if (!orgId) {
        set({ isLoading: false });
        return;
      }
      set({ isLoading: true });

      // Safety timeout: if data loading takes longer than 15 seconds (e.g. due to
      // a hung network request), unblock the UI so the app renders in an empty state
      // rather than showing the loading spinner indefinitely. The isLoading check
      // prevents a no-op state update if the timeout fires after a successful load.
      const timeoutId = setTimeout(() => {
        if (get().isLoading) {
          set({ isLoading: false });
        }
      }, 15000);

      try {
        const rawData = await loadFromSupabase(orgId);
        const cleanData = sanitizeData(rawData, orgId);

        // Load hyperlinks and change log in parallel
        const workItemIds = Object.keys(cleanData.workItems);
        const [hyperlinks, dbChangeLog] = await Promise.all([
          loadHyperlinksForWorkItems(workItemIds),
          loadChangeLog(orgId),
        ]);

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

        clearTimeout(timeoutId);
        set({
          ...cleanData,
          hyperlinks,
          changeLog: dbChangeLog,
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
        clearTimeout(timeoutId);
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

    expandWorkItemsRecursive: (id) =>
      set((s) => {
        const next = new Set(s.expandedWorkItems);
        const collect = (wId: string) => {
          const item = s.workItems[wId];
          if (!item || item.childrenIds.length === 0) return;
          next.add(wId);
          item.childrenIds.forEach(collect);
        };
        collect(id);
        return { expandedWorkItems: next };
      }),

    collapseWorkItemsRecursive: (id) =>
      set((s) => {
        const next = new Set(s.expandedWorkItems);
        const collect = (wId: string) => {
          next.delete(wId);
          const item = s.workItems[wId];
          if (item) item.childrenIds.forEach(collect);
        };
        collect(id);
        return { expandedWorkItems: next };
      }),

    expandBacklogsRecursive: (id) =>
      set((s) => {
        const next = new Set(s.expandedBacklogs);
        const collect = (bId: string) => {
          const backlog = s.backlogs[bId];
          if (!backlog || backlog.childrenIds.length === 0) return;
          next.add(bId);
          backlog.childrenIds.forEach(collect);
        };
        collect(id);
        return { expandedBacklogs: next };
      }),

    collapseBacklogsRecursive: (id) =>
      set((s) => {
        const next = new Set(s.expandedBacklogs);
        const collect = (bId: string) => {
          next.delete(bId);
          const backlog = s.backlogs[bId];
          if (backlog) backlog.childrenIds.forEach(collect);
        };
        collect(id);
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

      // Determine if mainItem is a "root-visible" item in this view: its parent is absent
      // from the backlog context (or has no parent at all).  Items like sub-tasks of a
      // "Collab AI" project that are also tagged for "Today" fall into this category –
      // they appear at the root level of the flat view even though parentId is non-null.
      // In that case we must treat ALL root-visible items as siblings so that moving to
      // top/bottom ranks the item relative to every item shown at that visual level, not
      // just the tiny group that shares the same parentId.
      const mainParentInContext =
        mainItem.parentId !== null &&
        backlogIdSet.has(state.workItems[mainItem.parentId]?.backlogAssignments[treeId]);

      const allSiblings = Object.values(state.workItems)
        .filter((wi) => {
          if (!backlogIdSet.has(wi.backlogAssignments[treeId])) return false;
          if (mainParentInContext) {
            // mainItem is a true child inside this context – use standard same-parent matching.
            return wi.parentId === mainItem.parentId;
          }
          // mainItem is root-visible: include every item whose parent is also absent from
          // the backlog context (covers both parentId=null and cross-context sub-tasks).
          const wiParentInContext =
            wi.parentId !== null &&
            backlogIdSet.has(state.workItems[wi.parentId]?.backlogAssignments[treeId]);
          return !wiParentInContext;
        })
        .sort((a, b) => getWorkItemRank(a, treeId) - getWorkItemRank(b, treeId));

      const movingSet = new Set(itemsToMoveIds);
      const remaining = allSiblings.filter((s) => !movingSet.has(s.id));
      const clampedIdx = Math.max(0, Math.min(targetIndex, remaining.length));

      const movingItems = allSiblings.filter((s) => movingSet.has(s.id));
      const reordered = [...remaining];
      reordered.splice(clampedIdx, 0, ...movingItems);

      const updatedItems = { ...state.workItems };

      // Determine the backlog ID for each sibling in this tree context and
      // update only that backlog's rank entry.
      reordered.forEach((s, i) => {
        const blId = updatedItems[s.id].backlogAssignments[treeId];
        if (blId) {
          updatedItems[s.id] = {
            ...updatedItems[s.id],
            ranks: { ...updatedItems[s.id].ranks, [blId]: i },
          };
        }
      });

      const itemsToUpsert = reordered.map((s) => updatedItems[s.id]);
      upsertWorkItems(itemsToUpsert, orgId);
      internalLog({ action: "Reorder", entityType: "work_item", entityId: workItemId, entityName: mainItem.title, details: `${itemsToMoveIds.length} items moved` });

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

      // Compute rank as max+1 among siblings in the NEW backlog only.
      let maxRank = -1;
      Object.values(state.workItems).forEach((wi) => {
        if (wi.id === workItemId) return;
        if (wi.parentId !== item.parentId) return;
        if (wi.backlogAssignments[treeId] === cleanTargetBl) {
          const wiRank = wi.ranks[cleanTargetBl] ?? 0;
          if (wiRank > maxRank) maxRank = wiRank;
        }
      });
      const newRootRank = maxRank + 1;

      const updatedItems = { ...state.workItems };
      const changed: WorkItem[] = [];

      const moveRecursive = (id: string, isRoot: boolean) => {
        const wi = updatedItems[id];
        if (!wi) return;
        const oldBlId = wi.backlogAssignments[treeId];
        const newRanks = { ...wi.ranks };
        // Remove rank for old backlog, add rank for new backlog
        if (oldBlId && oldBlId !== cleanTargetBl) delete newRanks[oldBlId];
        if (isRoot) {
          newRanks[cleanTargetBl] = newRootRank;
        } else {
          // Preserve existing rank value or default to current
          newRanks[cleanTargetBl] = newRanks[cleanTargetBl] ?? (wi.ranks[oldBlId] ?? 0);
        }
        updatedItems[id] = {
          ...wi,
          backlogAssignments: { ...wi.backlogAssignments, [treeId]: cleanTargetBl },
          ranks: newRanks,
        };
        changed.push(updatedItems[id]);
        wi.childrenIds.forEach((childId) => moveRecursive(childId, false));
      };

      moveRecursive(workItemId, true);

      // Fix rank duplicates among children that were previously in different
      // backlogs and are now all in cleanTargetBl.
      const movedByParent = new Map<string | null, string[]>();
      for (const wi of changed) {
        if (wi.id === workItemId) continue;
        const pid = wi.parentId ?? null;
        if (!movedByParent.has(pid)) movedByParent.set(pid, []);
        movedByParent.get(pid)!.push(wi.id);
      }
      for (const ids of movedByParent.values()) {
        if (ids.length < 2) continue;
        const sorted = [...ids].sort(
          (a, b) => (updatedItems[a]?.ranks[cleanTargetBl] ?? 0) - (updatedItems[b]?.ranks[cleanTargetBl] ?? 0),
        );
        let prevEffective = -Infinity;
        for (const id of sorted) {
          const sibling = updatedItems[id];
          if (!sibling) continue;
          const sibRank = sibling.ranks[cleanTargetBl] ?? 0;
          if (sibRank <= prevEffective) {
            const newRank = prevEffective + 1;
            updatedItems[id] = { ...updatedItems[id], ranks: { ...updatedItems[id].ranks, [cleanTargetBl]: newRank } };
            const idx = changed.findIndex((c) => c.id === id);
            if (idx >= 0) changed[idx] = updatedItems[id];
            prevEffective = newRank;
          } else {
            prevEffective = sibRank;
          }
        }
      }

      upsertWorkItems(changed, orgId);
      const oldBacklogId = item.backlogAssignments[treeId];
      const oldBacklogName = oldBacklogId ? state.backlogs[oldBacklogId]?.name : '?';
      const newBacklogName = state.backlogs[cleanTargetBl]?.name ?? cleanTargetBl;
      internalLog({ action: "Move to Backlog", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `backlog: "${oldBacklogName}" → "${newBacklogName}"` });
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
        const toShift = buildCascadedShiftSet(
          updatedWorkItems,
          parentId,
          finalRank,
          null,
          backlogId,
        );
        toShift.forEach((id) => {
          const wi = updatedWorkItems[id];
          const updatedItem = { ...wi, ranks: { ...wi.ranks, [backlogId]: (wi.ranks[backlogId] ?? 0) + 1 } };
          updatedWorkItems[id] = updatedItem;
          itemsToUpdateInDB.push(updatedItem);
        });
      } else {
        let minRank = Infinity;
        Object.values(state.workItems).forEach((wi) => {
          if (wi.parentId === parentId && wi.backlogAssignments[treeId] === backlogId) {
            const wiRank = wi.ranks[backlogId] ?? 0;
            if (wiRank < minRank) minRank = wiRank;
          }
        });
        finalRank = minRank === Infinity ? 0 : minRank - 1;
      }

      const id = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const newItem: WorkItem = {
        id,
        title,
        parentId,
        ranks: { [backlogId]: finalRank },
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
          childrenIds: [id, ...updatedWorkItems[parentId].childrenIds],
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

      const backlogName = state.backlogs[ensureCleanId(backlogId, orgId)]?.name ?? backlogId;
      internalLog({ action: "Add", entityType: "work_item", entityId: id, entityName: title, details: `backlog: "${backlogName}", parent: ${parentId ? `"${state.workItems[parentId]?.title ?? parentId}"` : "none"}` });
    },

    bulkAddWorkItems: (titles, parentId, backlogId, treeId) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || titles.length === 0) return;

      // Collect all backlog IDs in the subtree rooted at backlogId so that pasted
      // items are placed after every item currently visible in the combined panel
      // (which shows items from the selected backlog AND all its descendants).
      // Without this, items pasted into a parent backlog could share ranks with
      // items in child backlogs, causing them to be interleaved instead of appended.
      const allBacklogIds = new Set<string>();
      const collectDescendants = (id: string) => {
        allBacklogIds.add(id);
        state.backlogs[id]?.childrenIds.forEach(collectDescendants);
      };
      collectDescendants(backlogId);

      const updatedWorkItems = { ...state.workItems };
      let maxRank = -1;
      Object.values(updatedWorkItems).forEach((wi) => {
        if (wi.parentId === parentId && allBacklogIds.has(wi.backlogAssignments[treeId])) {
          const wiRank = wi.ranks[wi.backlogAssignments[treeId]] ?? 0;
          if (wiRank > maxRank) maxRank = wiRank;
        }
      });

      const newItems: WorkItem[] = [];
      titles.forEach((title, i) => {
        const id = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
        const newItem: WorkItem = {
          id,
          title,
          parentId,
          ranks: { [backlogId]: maxRank + 1 + i },
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
      internalLog({ action: "Rename", entityType: "work_item", entityId: workItemId, entityName: title, details: `"${item.title}" → "${title}"` });
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
      internalLog({ action: "Status Change", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `"${item.status}" → "${status}"` });
      if (status === "in_progress" || status === "done") {
        const visited = new Set<string>([workItemId]);
        let ancestorId = item.parentId;
        while (ancestorId && !visited.has(ancestorId)) {
          visited.add(ancestorId);
          const ancestor = updatedWorkItems[ancestorId];
          if (!ancestor) break;
          // "done" only promotes not_started ancestors; "in_progress" promotes all non-in_progress ancestors.
          const shouldUpdate = status === "done"
            ? ancestor.status === "not_started"
            : ancestor.status !== "in_progress";
          if (shouldUpdate) {
            updatedWorkItems[ancestorId] = { ...ancestor, status: "in_progress" };
            upsertWorkItem(updatedWorkItems[ancestorId], orgId);
            internalLog({ action: "Status Change", entityType: "work_item", entityId: ancestorId, entityName: ancestor.title, details: `"${ancestor.status}" → "in_progress" (auto)` });
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
        entityName: item.title,
        details: `${item.points ?? "none"} → ${points ?? "none"}`,
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
      const removedBlId = newAssignments[treeId];
      delete newAssignments[treeId];
      if (Object.keys(newAssignments).length === 0) {
        get().deleteWorkItem(workItemId);
        return;
      }
      const newRanks = { ...item.ranks };
      if (removedBlId) delete newRanks[removedBlId];
      const updated = { ...item, backlogAssignments: newAssignments, ranks: newRanks };
      upsertWorkItem(updated, orgId);
      const treeName = state.backlogTrees[treeId]?.name ?? treeId;
      internalLog({ action: "Remove from Tree", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `tree: "${treeName}"` });
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
      // Assign a rank that avoids conflicts with existing siblings in the new parent's
      // context. With per-backlog ranks, compute max rank in each backlog the item belongs to.
      const newRanks = { ...item.ranks };
      for (const [tId, blId] of Object.entries(item.backlogAssignments)) {
        let maxRank = -1;
        Object.values(state.workItems).forEach((wi) => {
          if (wi.id === workItemId) return;
          if (wi.parentId !== newParentId) return;
          if (wi.backlogAssignments[tId] === blId) {
            const wiRank = wi.ranks[blId] ?? 0;
            if (wiRank > maxRank) maxRank = wiRank;
          }
        });
        newRanks[blId] = maxRank + 1;
      }
      updatedItems[workItemId] = { ...item, parentId: newParentId, ranks: newRanks };
      const changed = [updatedItems[workItemId]];
      if (item.parentId && updatedItems[item.parentId]) changed.push(updatedItems[item.parentId]);
      if (newParentId && updatedItems[newParentId]) changed.push(updatedItems[newParentId]);
      upsertWorkItems(changed, orgId);
      const oldParentName = item.parentId ? (state.workItems[item.parentId]?.title ?? item.parentId) : "none";
      const newParentName = newParentId ? (state.workItems[newParentId]?.title ?? newParentId) : "none";
      internalLog({ action: "Reparent", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `parent: "${oldParentName}" → "${newParentName}"` });
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
      internalLog({ action: "Set Respawn", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `enabled: ${respawnEnabled}, interval: ${respawnIntervalDays ?? 'n/a'}d, hour: ${respawnHour ?? 'n/a'}` });
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

      // For each backlog the item is in, compute the insert rank and shift siblings.
      const copyRanks: Record<string, number> = {};
      for (const [tId, blId] of Object.entries(item.backlogAssignments)) {
        const insertRank = (item.ranks[blId] ?? 0) + 1;
        copyRanks[blId] = insertRank;

        const toShift = buildCascadedShiftSet(
          updatedWorkItems,
          item.parentId,
          insertRank,
          workItemId,
          blId,
        );
        toShift.forEach((id) => {
          const wi = updatedWorkItems[id];
          const shifted = { ...wi, ranks: { ...wi.ranks, [blId]: (wi.ranks[blId] ?? 0) + 1 } };
          updatedWorkItems[id] = shifted;
          itemsToUpdateInDB.push(shifted);
        });
      }

      const newId = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const copy: WorkItem = {
        id: newId,
        title: item.title,
        description: item.description,
        points: item.points,
        parentId: item.parentId,
        ranks: copyRanks,
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
          childrenIds: [id, ...updatedBacklogs[parentId].childrenIds],
        };
      } else if (updatedTrees[treeId]) {
        updatedTrees[treeId] = {
          ...updatedTrees[treeId],
          rootBacklogIds: [id, ...updatedTrees[treeId].rootBacklogIds],
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
        const newRanks = { ...wi.ranks };
        Object.entries(newAssignments).forEach(([tId, bId]) => {
          if (blIdSet.has(bId)) {
            delete newAssignments[tId];
            delete newRanks[bId];
          }
        });
        if (Object.keys(newAssignments).length === 0) {
          wiIdsToDelete.push(wi.id);
        } else if (Object.keys(newAssignments).length !== Object.keys(wi.backlogAssignments).length) {
          updatedItems[wi.id] = { ...wi, backlogAssignments: newAssignments, ranks: newRanks };
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

      // Items that lost at least one assignment but still belong to other trees must
      // be persisted so the DB doesn't retain the stale backlog_assignments entry.
      // Without this, a page reload silently drops the stale entry and the "also in"
      // cross-tree badge disappears permanently for those items.
      const wiIdsToUpsert = Object.values(updatedItems).filter(
        (wi) =>
          !wiIdsToDelete.includes(wi.id) &&
          Object.keys(wi.backlogAssignments).length !==
            Object.keys(state.workItems[wi.id]?.backlogAssignments ?? {}).length,
      );
      deleteWorkItems(wiIdsToDelete)?.catch((err) => console.error("Delete work items failed", err));
      deleteBacklogs(blIdsToDelete)?.catch((err) => console.error("Delete backlogs failed", err));
      if (wiIdsToUpsert.length > 0) {
        upsertWorkItems(wiIdsToUpsert, state.organizationId!)?.catch((err) => console.error("Update work item assignments failed", err));
      }
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
      internalLog({ action: "Rename", entityType: "backlog", entityId: backlogId, entityName: name, details: `"${bl.name}" → "${name}"` });
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
      internalLog({ action: "Reorder", entityType: "backlog", entityId: backlogId, entityName: bl.name });
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
      // Compute a rank for the moved backlog that avoids conflicts among its new siblings.
      let maxRank = -1;
      Object.values(state.backlogs).forEach((sibling) => {
        if (sibling.id === backlogId) return;
        const isSiblingAtTarget = targetParentId
          ? sibling.parentId === targetParentId && sibling.treeId === treeId
          : !sibling.parentId && sibling.treeId === treeId;
        if (isSiblingAtTarget && sibling.rank > maxRank) maxRank = sibling.rank;
      });
      updatedBacklogs[backlogId] = { ...bl, parentId: targetParentId, treeId, rank: maxRank + 1 };

      const oldTreeId = bl.treeId;
      let updatedWorkItems = state.workItems;

      if (oldTreeId !== treeId) {
        // Collect all backlog IDs in the moved subtree (BFS over children)
        const movedBacklogIds = new Set<string>([backlogId]);
        const queue = [...(state.backlogs[backlogId]?.childrenIds ?? [])];
        while (queue.length) {
          const childId = queue.shift();
          if (!childId) break;
          movedBacklogIds.add(childId);
          const child = state.backlogs[childId];
          if (child) queue.push(...child.childrenIds);
        }

        // Update treeId for all descendant backlogs (the root was already updated above)
        movedBacklogIds.forEach((id) => {
          if (id !== backlogId) {
            updatedBacklogs[id] = { ...updatedBacklogs[id], treeId };
          }
        });

        // Remap work item backlog assignments: oldTreeId key → newTreeId key
        const changedItems: WorkItem[] = [];
        updatedWorkItems = { ...state.workItems };
        Object.values(state.workItems).forEach((wi) => {
          const blId = wi.backlogAssignments[oldTreeId];
          if (blId && movedBacklogIds.has(blId)) {
            const newAssignments = { ...wi.backlogAssignments };
            delete newAssignments[oldTreeId];
            newAssignments[treeId] = blId;
            const updated = { ...wi, backlogAssignments: newAssignments };
            updatedWorkItems[wi.id] = updated;
            changedItems.push(updated);
          }
        });

        // Persist descendant backlogs and changed work items
        const descendantBacklogs = [...movedBacklogIds]
          .filter((id) => id !== backlogId)
          .map((id) => updatedBacklogs[id]);
        if (descendantBacklogs.length) upsertBacklogs(descendantBacklogs, orgId);
        if (changedItems.length) upsertWorkItems(changedItems, orgId);
      }

      upsertBacklog(updatedBacklogs[backlogId], orgId);
      internalLog({ action: "Move", entityType: "backlog", entityId: backlogId, entityName: bl.name, details: `parent: "${bl.parentId ? state.backlogs[bl.parentId]?.name ?? bl.parentId : 'root'}" → "${targetParentId ? state.backlogs[targetParentId]?.name ?? targetParentId : 'root'}"` });
      set({
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        workItems: updatedWorkItems,
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });
    },

    addBacklogTree: (name) => {
      const state = get();
      const orgId = state.organizationId!;
      const id = ensureCleanId(`bt-${crypto.randomUUID().slice(0, 8)}`, orgId);
      let maxRank = -1;
      Object.values(state.backlogTrees).forEach((t) => {
        if (t.rank > maxRank) maxRank = t.rank;
      });
      const rank = maxRank + 1;
      const newTree: BacklogTree = { id, name, rootBacklogIds: [], rank };
      upsertBacklogTree(newTree, orgId);
      // Seed the required pinned statuses for the new tree.
      useTreeStatusesStore.getState().seedPinnedStatuses(id);
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
        const newRanks = { ...wi.ranks };
        const removedBlId = newAssignments[treeId];
        delete newAssignments[treeId];
        if (removedBlId) delete newRanks[removedBlId];
        Object.entries(newAssignments).forEach(([tId, bId]) => {
          if (blIdSet.has(bId)) {
            delete newAssignments[tId];
            delete newRanks[bId];
          }
        });
        if (Object.keys(newAssignments).length === 0) wiIdsToDelete.push(wi.id);
        else updatedItems[wi.id] = { ...wi, backlogAssignments: newAssignments, ranks: newRanks };
      });
      wiIdsToDelete.forEach((id) => delete updatedItems[id]);
      const updatedBacklogs = { ...state.backlogs };
      blIdsToDelete.forEach((id) => delete updatedBacklogs[id]);
      const updatedTrees = { ...state.backlogTrees };
      delete updatedTrees[treeId];
      deleteWorkItems(wiIdsToDelete);
      deleteBacklogs(blIdsToDelete);
      deleteBacklogTreeDB(treeId);
      internalLog({ action: "Delete", entityType: "backlog_tree", entityId: treeId, entityName: state.backlogTrees[treeId]?.name });
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
      internalLog({ action: "Rename", entityType: "backlog_tree", entityId: treeId, entityName: name, details: `"${tree.name}" → "${name}"` });
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
      internalLog({ action: "Reorder", entityType: "backlog_tree", entityId: treeId, entityName: tree.name });
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
      const itemOrgId = state.workItems[workItemId]?.organizationId;
      upsertHyperlink(newLink, orgId, itemOrgId);
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
      const itemOrgId = state.workItems[workItemId]?.organizationId;
      upsertHyperlink(updated, orgId, itemOrgId);
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

        // INSERT or UPDATE: preserve existing childrenIds and ranks from current state.
        // Ranks live in the separate work_item_backlog_ranks table and arrive
        // via applyRealtimeWorkItemRank; we keep the existing local ranks here.
        const rawAssignments = row.backlog_assignments as Record<string, unknown> | null;
        const parsedAssignments: Record<string, string> = {};
        if (rawAssignments) {
          for (const [tId, value] of Object.entries(rawAssignments)) {
            if (typeof value === 'string') {
              parsedAssignments[tId] = value;
            } else if (value && typeof value === 'object' && 'backlogId' in value) {
              // Legacy enriched format – extract plain backlogId
              parsedAssignments[tId] = (value as { backlogId: string }).backlogId;
            }
          }
        }

        const newItem: WorkItem = {
          id,
          title: row.title as string,
          description: (row.description as string | null) ?? undefined,
          points: (row.points as number | null) ?? undefined,
          status: ((row.status as string) ?? 'not_started') as WorkItemStatus,
          parentId: (row.parent_id as string | null) ?? null,
          childrenIds: state.workItems[id]?.childrenIds ?? [],
          backlogAssignments: parsedAssignments,
          ranks: state.workItems[id]?.ranks ?? {},
          organizationId: (row.organization_id as string) ?? undefined,
          respawnEnabled: (row.respawn_enabled as boolean) ?? false,
          respawnIntervalDays: (row.respawn_interval_days as number | null) ?? undefined,
          respawnHour: (row.respawn_hour as number | null) ?? undefined,
          respawnLastTriggeredAt: (row.respawn_last_triggered_at as string | null) ?? undefined,
        };

        const updatedWorkItems = { ...state.workItems, [id]: newItem };

        const sortWorkItemIds = (ids: string[]) =>
          [...ids].sort((a, b) => {
            const wiA = updatedWorkItems[a];
            const wiB = updatedWorkItems[b];
            const rankA = wiA ? Math.min(...Object.values(wiA.ranks), 0) : 0;
            const rankB = wiB ? Math.min(...Object.values(wiB.ranks), 0) : 0;
            return rankA - rankB;
          });

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
          const parent = updatedWorkItems[newItem.parentId];
          updatedWorkItems[newItem.parentId] = { ...parent, childrenIds: sortWorkItemIds(parent.childrenIds) };
        }

        return { workItems: updatedWorkItems };
      });
    },

    applyRealtimeWorkItemRank: (eventType, row) => {
      set((state) => {
        const workItemId = row.work_item_id as string;
        const backlogId = row.backlog_id as string;
        const wi = state.workItems[workItemId];
        if (!wi) return state;

        if (eventType === 'DELETE') {
          const newRanks = { ...wi.ranks };
          delete newRanks[backlogId];
          const updatedWorkItems = { ...state.workItems, [workItemId]: { ...wi, ranks: newRanks } };
          return { workItems: updatedWorkItems };
        }

        // INSERT or UPDATE
        const newRank = (row.rank as number) ?? 0;
        const newRanks = { ...wi.ranks, [backlogId]: newRank };
        const updatedWorkItems = { ...state.workItems, [workItemId]: { ...wi, ranks: newRanks } };

        // Resolve any duplicate ranks introduced by this realtime update
        dedupWorkItemRanksInPlace(updatedWorkItems);

        // Re-sort parent's childrenIds if this item has a parent.
        // Use the updated backlog context instead of the minimum rank across all backlogs.
        const treeId = state.backlogs[backlogId]?.treeId;
        if (wi.parentId && updatedWorkItems[wi.parentId] && treeId) {
          const parent = updatedWorkItems[wi.parentId];
          const sortWorkItemIds = (ids: string[]) =>
            [...ids].sort((a, b) => {
              const wiA = updatedWorkItems[a];
              const wiB = updatedWorkItems[b];
              const backlogA = wiA?.backlogAssignments[treeId];
              const backlogB = wiB?.backlogAssignments[treeId];
              const rankA = wiA && backlogA ? (wiA.ranks[backlogA] ?? 0) : 0;
              const rankB = wiB && backlogB ? (wiB.ranks[backlogB] ?? 0) : 0;
              return rankA - rankB;
            });
          updatedWorkItems[wi.parentId] = { ...parent, childrenIds: sortWorkItemIds(parent.childrenIds) };
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

    applyRealtimeHyperlink: (eventType, row) => {
      set((state) => {
        const id = row.id as string;
        const workItemId = row.work_item_id as string;

        if (eventType === 'DELETE') {
          const existing = state.hyperlinks[workItemId] ?? [];
          const filtered = existing.filter((l) => l.id !== id);
          if (filtered.length === existing.length) return state;
          return { hyperlinks: { ...state.hyperlinks, [workItemId]: filtered } };
        }

        // INSERT or UPDATE
        const link: Hyperlink = {
          id,
          workItemId,
          url: row.url as string,
          altText: (row.alt_text as string) ?? '',
          rank: (row.rank as number) ?? 0,
        };

        const existing = state.hyperlinks[workItemId] ?? [];
        const idx = existing.findIndex((l) => l.id === id);
        let newList: Hyperlink[];
        if (idx >= 0) {
          newList = [...existing];
          newList[idx] = link;
        } else {
          newList = [...existing, link];
        }
        newList.sort((a, b) => a.rank - b.rank);

        return { hyperlinks: { ...state.hyperlinks, [workItemId]: newList } };
      });
    },
  };
});
