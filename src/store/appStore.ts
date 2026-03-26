import { create } from 'zustand';
import { WorkItem, WorkItemStatus, Backlog, BacklogTree } from '@/types/models';
import {
  loadFromSupabase,
  upsertWorkItem, upsertWorkItems, deleteWorkItems,
  upsertBacklog, upsertBacklogs, deleteBacklogs,
  upsertBacklogTree, upsertBacklogTrees, deleteBacklogTree as deleteBacklogTreeFromDb,
  resetOrgData,
} from './supabaseSync';
import { generateMockData } from './mockData';
import { logChange, clearChangeLog } from './changeLog';

interface DataSnapshot {
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
  selectedBacklogIds: string[];
  selectedTreeId: string | null;
  selectedWorkItemIds: string[];
}

interface AppState extends DataSnapshot {
  undoStack: DataSnapshot[];
  redoStack: DataSnapshot[];
  isLoading: boolean;
  organizationId: string | null;
  setOrganizationId: (orgId: string) => void;
  loadFromSupabase: () => Promise<void>;

  selectBacklog: (backlogId: string, treeId: string, ctrlKey?: boolean) => void;
  selectWorkItem: (workItemId: string | null, ctrlKey?: boolean) => void;
  clearWorkItemSelection: () => void;
  moveWorkItemToBacklog: (workItemId: string, targetBacklogId: string, treeId: string) => void;
  reparentWorkItem: (workItemId: string, newParentId: string | null, treeId: string, backlogId: string) => void;
  reorderWorkItemAmongSiblings: (workItemId: string, targetIndex: number, treeId: string, backlogIds: string[]) => void;
  
  reorderWorkItem: (workItemId: string, newRank: number, backlogId: string) => void;
  moveBacklog: (backlogId: string, newParentId: string | null, treeId: string) => void;
  reorderBacklogAmongSiblings: (backlogId: string, targetIndex: number, newParentId: string | null, treeId: string) => void;
  toggleWorkItemExpand: (workItemId: string) => void;
  toggleBacklogExpand: (backlogId: string) => void;
  addBacklog: (name: string, parentId: string | null, treeId: string) => void;
  deleteBacklog: (backlogId: string) => void;
  renameBacklog: (backlogId: string, name: string) => void;
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string) => void;
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

// Helper to get org ID or throw
function getOrgId(state: { organizationId: string | null }): string {
  if (!state.organizationId) throw new Error('No organization selected');
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
    expandedWorkItems,
    expandedBacklogs,
    undoStack: [],
    redoStack: [],
    isLoading: true,
    organizationId: null,

    setOrganizationId: (orgId: string) => {
      set({ organizationId: orgId });
    },

    loadFromSupabase: async () => {
      const orgId = get().organizationId;
      if (!orgId) {
        set({ isLoading: false, workItems: {}, backlogs: {}, backlogTrees: {} });
        return;
      }
      try {
        const data = await loadFromSupabase(orgId);
        const nextExpanded = new Set<string>();
        Object.values(data.backlogs).forEach(b => {
          if (!b.parentId) nextExpanded.add(b.id);
        });
        set({
          ...data,
          expandedBacklogs: nextExpanded,
          expandedWorkItems: new Set<string>(),
          isLoading: false,
          undoStack: [],
          redoStack: [],
        });
      } catch (err) {
        console.error('Failed to load from Supabase:', err);
        set({ isLoading: false });
      }
    },

    selectBacklog: (backlogId, treeId, ctrlKey = false) => set(state => {
      if (ctrlKey) {
        if (state.selectedTreeId && state.selectedTreeId !== treeId) {
          return { selectedBacklogIds: [backlogId], selectedTreeId: treeId, selectedWorkItemIds: [] };
        }
        const ids = state.selectedBacklogIds.includes(backlogId)
          ? state.selectedBacklogIds.filter(id => id !== backlogId)
          : [...state.selectedBacklogIds, backlogId];
        return { selectedBacklogIds: ids, selectedTreeId: treeId, selectedWorkItemIds: [] };
      }
      return { selectedBacklogIds: [backlogId], selectedTreeId: treeId, selectedWorkItemIds: [] };
    }),

    selectWorkItem: (workItemId, ctrlKey = false) => set(state => {
      if (!workItemId) return { selectedWorkItemIds: [] };
      if (ctrlKey) {
        const ids = state.selectedWorkItemIds.includes(workItemId)
          ? state.selectedWorkItemIds.filter(id => id !== workItemId)
          : [...state.selectedWorkItemIds, workItemId];
        return { selectedWorkItemIds: ids };
      }
      return { selectedWorkItemIds: [workItemId] };
    }),

    clearWorkItemSelection: () => set({ selectedWorkItemIds: [] }),

    undo: () => {
      set(state => {
        const stack = [...state.undoStack];
        const prev = stack.pop();
        if (!prev) return state;
        return { ...prev, undoStack: stack, redoStack: [...state.redoStack, snapshot(state)] };
      });
    },

    redo: () => {
      set(state => {
        const stack = [...state.redoStack];
        const next = stack.pop();
        if (!next) return state;
        return { ...next, undoStack: [...state.undoStack, snapshot(state)], redoStack: stack };
      });
    },

    resetToMockData: async () => {
      const orgId = get().organizationId;
      if (!orgId) return;
      set({ isLoading: true });
      try {
        const mockData = generateMockData();
        await resetOrgData(orgId, mockData);
        clearChangeLog();
        logChange({ action: 'Reset to mock data', entityType: 'data' });
        await get().loadFromSupabase();
      } catch (err) {
        console.error('resetToMockData failed:', err);
        set({ isLoading: false });
      }
    },

    moveWorkItemToBacklog: (workItemId, targetBacklogId, treeId) => {
      set(state => {
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

        logChange({ action: 'Move to backlog', entityType: 'work_item', entityId: workItemId, entityName: item.title, details: `Moved to backlog ${targetBacklogId}` });
        upsertWorkItems(changedItems, orgId);
        return { ...undo, workItems: updatedItems };
      });
    },

    reparentWorkItem: (workItemId, newParentId, treeId, backlogId) => {
      set(state => {
        const orgId = getOrgId(state);
        const item = state.workItems[workItemId];
        if (!item) return state;
        if (newParentId === workItemId) return state;
        if (newParentId) {
          let check: string | null = newParentId;
          while (check) {
            if (check === workItemId) return state;
            check = state.workItems[check]?.parentId ?? null;
          }
        }
        if (item.parentId === newParentId) return state;

        const undo = pushUndo(state);
        const updatedItems = { ...state.workItems };
        const changedItems: WorkItem[] = [];

        if (item.parentId && updatedItems[item.parentId]) {
          const oldParent = { ...updatedItems[item.parentId], childrenIds: updatedItems[item.parentId].childrenIds.filter(id => id !== workItemId) };
          updatedItems[item.parentId] = oldParent;
          changedItems.push(oldParent);
        }

        if (newParentId && updatedItems[newParentId]) {
          const newParent = { ...updatedItems[newParentId], childrenIds: [...updatedItems[newParentId].childrenIds, workItemId] };
          updatedItems[newParentId] = newParent;
          changedItems.push(newParent);
        }

        const movedItem = { ...item, parentId: newParentId };
        updatedItems[workItemId] = movedItem;
        changedItems.push(movedItem);

        upsertWorkItems(changedItems, orgId);

        const nextExpanded = new Set(state.expandedWorkItems);
        if (newParentId) nextExpanded.add(newParentId);

        return { ...undo, workItems: updatedItems, expandedWorkItems: nextExpanded };
      });
    },

    reorderWorkItem: (workItemId, newRank) => {
      set(state => {
        const orgId = getOrgId(state);
        const item = state.workItems[workItemId];
        if (!item) return state;
        const undo = pushUndo(state);
        const updated = { ...item, rank: newRank };
        upsertWorkItem(updated, orgId);
        return { ...undo, workItems: { ...state.workItems, [workItemId]: updated } };
      });
    },

    reorderWorkItemAmongSiblings: (workItemId, targetIndex, treeId, backlogIds) => {
      set(state => {
        const orgId = getOrgId(state);
        const item = state.workItems[workItemId];
        if (!item) return state;

        const backlogIdSet = new Set(backlogIds);
        const siblings = Object.values(state.workItems)
          .filter(wi => {
            if (!backlogIdSet.has(wi.backlogAssignments[treeId])) return false;
            if (item.parentId === null) {
              return wi.parentId === null || !state.workItems[wi.parentId] || !backlogIdSet.has(state.workItems[wi.parentId].backlogAssignments[treeId]);
            }
            return wi.parentId === item.parentId;
          })
          .sort((a, b) => a.rank - b.rank);

        const currentIndex = siblings.findIndex(s => s.id === workItemId);
        if (currentIndex === -1 || currentIndex === targetIndex) return state;

        const undo = pushUndo(state);
        const reordered = siblings.filter(s => s.id !== workItemId);
        const clampedIndex = Math.max(0, Math.min(targetIndex, reordered.length));
        reordered.splice(clampedIndex, 0, item);

        const updatedItems = { ...state.workItems };
        const changedItems: WorkItem[] = [];
        reordered.forEach((s, i) => {
          const updated = { ...updatedItems[s.id], rank: i };
          updatedItems[s.id] = updated;
          changedItems.push(updated);
        });

        upsertWorkItems(changedItems, orgId);
        return { ...undo, workItems: updatedItems };
      });
    },

    moveBacklog: (backlogId, newParentId, treeId) => {
      set(state => {
        const orgId = getOrgId(state);
        const backlog = state.backlogs[backlogId];
        if (!backlog) return state;

        const undo = pushUndo(state);
        const updatedBacklogs = { ...state.backlogs };
        const updatedTrees = { ...state.backlogTrees };

        if (backlog.parentId) {
          const oldParent = updatedBacklogs[backlog.parentId];
          if (oldParent) updatedBacklogs[backlog.parentId] = { ...oldParent, childrenIds: oldParent.childrenIds.filter(id => id !== backlogId) };
        } else {
          const tree = updatedTrees[treeId];
          if (tree) updatedTrees[treeId] = { ...tree, rootBacklogIds: tree.rootBacklogIds.filter(id => id !== backlogId) };
        }

        if (newParentId) {
          const newParent = updatedBacklogs[newParentId];
          if (newParent) updatedBacklogs[newParentId] = { ...newParent, childrenIds: [...newParent.childrenIds, backlogId] };
        } else {
          const tree = updatedTrees[treeId];
          if (tree) updatedTrees[treeId] = { ...tree, rootBacklogIds: [...tree.rootBacklogIds, backlogId] };
        }

        const updated = { ...backlog, parentId: newParentId };
        updatedBacklogs[backlogId] = updated;

        upsertBacklog(updated, orgId);
        return { ...undo, backlogs: updatedBacklogs, backlogTrees: updatedTrees };
      });
    },

    reorderBacklogAmongSiblings: (backlogId, targetIndex, newParentId, treeId) => {
      set(state => {
        const orgId = getOrgId(state);
        const backlog = state.backlogs[backlogId];
        if (!backlog || backlog.treeId !== treeId) return state;

        const updatedBacklogs = { ...state.backlogs };
        const updatedTrees = { ...state.backlogTrees };

        if (backlog.parentId !== newParentId) {
          if (backlog.parentId) {
            const oldParent = updatedBacklogs[backlog.parentId];
            if (oldParent) updatedBacklogs[backlog.parentId] = { ...oldParent, childrenIds: oldParent.childrenIds.filter(id => id !== backlogId) };
          } else {
            const tree = updatedTrees[treeId];
            if (tree) updatedTrees[treeId] = { ...tree, rootBacklogIds: tree.rootBacklogIds.filter(id => id !== backlogId) };
          }
          updatedBacklogs[backlogId] = { ...backlog, parentId: newParentId };
          if (newParentId) {
            const newParent = updatedBacklogs[newParentId];
            if (newParent) updatedBacklogs[newParentId] = { ...newParent, childrenIds: [...newParent.childrenIds, backlogId] };
          } else {
            const tree = updatedTrees[treeId];
            if (tree) updatedTrees[treeId] = { ...tree, rootBacklogIds: [...tree.rootBacklogIds, backlogId] };
          }
        }

        let siblings: string[];
        if (newParentId) {
          siblings = [...(updatedBacklogs[newParentId]?.childrenIds ?? [])];
        } else {
          siblings = [...(updatedTrees[treeId]?.rootBacklogIds ?? [])];
        }

        const currentIdx = siblings.indexOf(backlogId);
        if (currentIdx !== -1) siblings.splice(currentIdx, 1);
        const clampedIdx = Math.max(0, Math.min(targetIndex, siblings.length));
        siblings.splice(clampedIdx, 0, backlogId);

        const changedBacklogs: Backlog[] = [];
        siblings.forEach((id, i) => {
          const updated = { ...updatedBacklogs[id], rank: i };
          updatedBacklogs[id] = updated;
          changedBacklogs.push(updated);
        });

        if (newParentId) {
          updatedBacklogs[newParentId] = { ...updatedBacklogs[newParentId], childrenIds: siblings };
        } else {
          updatedTrees[treeId] = { ...updatedTrees[treeId], rootBacklogIds: siblings };
        }

        const nextExpanded = new Set(state.expandedBacklogs);
        if (newParentId) nextExpanded.add(newParentId);

        upsertBacklogs(changedBacklogs, orgId);
        return { ...pushUndo(state), backlogs: updatedBacklogs, backlogTrees: updatedTrees, expandedBacklogs: nextExpanded };
      });
    },

    toggleWorkItemExpand: (workItemId) => {
      set(state => {
        const next = new Set(state.expandedWorkItems);
        if (next.has(workItemId)) next.delete(workItemId);
        else next.add(workItemId);
        return { expandedWorkItems: next };
      });
    },

    toggleBacklogExpand: (backlogId) => {
      set(state => {
        const next = new Set(state.expandedBacklogs);
        if (next.has(backlogId)) next.delete(backlogId);
        else next.add(backlogId);
        return { expandedBacklogs: next };
      });
    },

    addBacklog: (name, parentId, treeId) => {
      set(state => {
        const orgId = getOrgId(state);
        const undo = pushUndo(state);
        const id = `bl-${crypto.randomUUID().slice(0, 8)}`;
        const newBacklog: Backlog = {
          id, name, parentId, childrenIds: [], treeId,
          rank: Object.values(state.backlogs).filter(b => b.treeId === treeId).length,
        };
        const updatedBacklogs = { ...state.backlogs, [id]: newBacklog };
        const updatedTrees = { ...state.backlogTrees };

        if (parentId) {
          const parent = updatedBacklogs[parentId];
          if (parent) updatedBacklogs[parentId] = { ...parent, childrenIds: [...parent.childrenIds, id] };
        } else {
          const tree = updatedTrees[treeId];
          if (tree) updatedTrees[treeId] = { ...tree, rootBacklogIds: [...tree.rootBacklogIds, id] };
        }

        const next = new Set(state.expandedBacklogs);
        if (parentId) next.add(parentId);

        logChange({ action: 'Add backlog', entityType: 'backlog', entityId: id, entityName: name });
        upsertBacklog(newBacklog, orgId);
        return { ...undo, backlogs: updatedBacklogs, backlogTrees: updatedTrees, expandedBacklogs: next };
      });
    },

    deleteBacklog: (backlogId) => {
      set(state => {
        const orgId = getOrgId(state);
        const backlog = state.backlogs[backlogId];
        if (!backlog) return state;
        logChange({ action: 'Delete backlog', entityType: 'backlog', entityId: backlogId, entityName: backlog.name });

        const undo = pushUndo(state);
        const toDelete = new Set<string>();
        const collect = (id: string) => {
          toDelete.add(id);
          state.backlogs[id]?.childrenIds.forEach(collect);
        };
        collect(backlogId);

        const updatedBacklogs = { ...state.backlogs };
        const updatedTrees = { ...state.backlogTrees };
        const updatedItems = { ...state.workItems };

        const deletedWorkItemIds: string[] = [];
        const changedWorkItems: WorkItem[] = [];

        const deleteWorkItemRecursive = (wiId: string) => {
          const wi = updatedItems[wiId];
          if (!wi) return;
          [...wi.childrenIds].forEach(deleteWorkItemRecursive);
          if (wi.backlogAssignments[backlog.treeId] && toDelete.has(wi.backlogAssignments[backlog.treeId])) {
            const otherAssignments = Object.keys(wi.backlogAssignments).filter(t => t !== backlog.treeId);
            if (otherAssignments.length > 0) {
              const newAssignments = { ...wi.backlogAssignments };
              delete newAssignments[backlog.treeId];
              const updated = { ...wi, backlogAssignments: newAssignments };
              updatedItems[wiId] = updated;
              changedWorkItems.push(updated);
            } else {
              if (wi.parentId && updatedItems[wi.parentId]) {
                updatedItems[wi.parentId] = { ...updatedItems[wi.parentId], childrenIds: updatedItems[wi.parentId].childrenIds.filter(id => id !== wiId) };
              }
              delete updatedItems[wiId];
              deletedWorkItemIds.push(wiId);
            }
          }
        };
        Object.keys(updatedItems).forEach(wiId => {
          const wi = updatedItems[wiId];
          if (wi && wi.backlogAssignments[backlog.treeId] && toDelete.has(wi.backlogAssignments[backlog.treeId])) {
            deleteWorkItemRecursive(wiId);
          }
        });

        if (backlog.parentId) {
          const parent = updatedBacklogs[backlog.parentId];
          if (parent) updatedBacklogs[backlog.parentId] = { ...parent, childrenIds: parent.childrenIds.filter(id => id !== backlogId) };
        } else {
          const tree = updatedTrees[backlog.treeId];
          if (tree) updatedTrees[backlog.treeId] = { ...tree, rootBacklogIds: tree.rootBacklogIds.filter(id => id !== backlogId) };
        }

        toDelete.forEach(id => delete updatedBacklogs[id]);
        const selectedBacklogIds = state.selectedBacklogIds.filter(id => !toDelete.has(id));

        deleteWorkItems(deletedWorkItemIds);
        if (changedWorkItems.length) upsertWorkItems(changedWorkItems, orgId);
        deleteBacklogs([...toDelete]);

        return { ...undo, backlogs: updatedBacklogs, backlogTrees: updatedTrees, workItems: updatedItems, selectedBacklogIds };
      });
    },

    addWorkItem: (title, parentId, backlogId, treeId) => {
      set(state => {
        const orgId = getOrgId(state);
        const undo = pushUndo(state);
        const id = `wi-${crypto.randomUUID().slice(0, 8)}`;
        const newItem: WorkItem = {
          id, title, parentId, childrenIds: [],
          status: 'not_started',
          backlogAssignments: { [treeId]: backlogId },
          rank: Object.values(state.workItems).length,
        };
        const updatedItems = { ...state.workItems, [id]: newItem };

        logChange({ action: 'Add work item', entityType: 'work_item', entityId: id, entityName: title });
        upsertWorkItem(newItem, orgId);

        if (parentId && updatedItems[parentId]) {
          const updatedParent = { ...updatedItems[parentId], childrenIds: [...updatedItems[parentId].childrenIds, id] };
          updatedItems[parentId] = updatedParent;
          const next = new Set(state.expandedWorkItems);
          next.add(parentId);
          return { ...undo, workItems: updatedItems, expandedWorkItems: next };
        }

        return { ...undo, workItems: updatedItems };
      });
    },

    deleteWorkItem: (workItemId) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item) return state;
        logChange({ action: 'Delete work item', entityType: 'work_item', entityId: workItemId, entityName: item.title });

        const undo = pushUndo(state);
        const toDelete = new Set<string>();
        const collect = (id: string) => { toDelete.add(id); state.workItems[id]?.childrenIds.forEach(collect); };
        collect(workItemId);

        const updatedItems = { ...state.workItems };
        if (item.parentId && updatedItems[item.parentId]) {
          updatedItems[item.parentId] = { ...updatedItems[item.parentId], childrenIds: updatedItems[item.parentId].childrenIds.filter(id => id !== workItemId) };
        }
        toDelete.forEach(id => delete updatedItems[id]);
        const selectedWorkItemIds = state.selectedWorkItemIds.filter(id => !toDelete.has(id));

        deleteWorkItems([...toDelete]);
        return { ...undo, workItems: updatedItems, selectedWorkItemIds };
      });
    },

    removeWorkItemFromTree: (workItemId, treeId) => {
      set(state => {
        const orgId = getOrgId(state);
        const item = state.workItems[workItemId];
        if (!item) return state;

        const undo = pushUndo(state);
        const updatedItems = { ...state.workItems };
        const changedItems: WorkItem[] = [];

        const removeRecursive = (id: string) => {
          const wi = updatedItems[id];
          if (!wi) return;
          const newAssignments = { ...wi.backlogAssignments };
          delete newAssignments[treeId];
          const updated = { ...wi, backlogAssignments: newAssignments };
          updatedItems[id] = updated;
          changedItems.push(updated);
          wi.childrenIds.forEach(removeRecursive);
        };
        removeRecursive(workItemId);

        logChange({ action: 'Remove from tree', entityType: 'work_item', entityId: workItemId, entityName: item.title, details: `Removed from tree ${treeId}` });
        upsertWorkItems(changedItems, orgId);
        return { ...undo, workItems: updatedItems };
      });
    },

    setWorkItemStatus: (workItemId, status) => {
      set(state => {
        const orgId = getOrgId(state);
        const item = state.workItems[workItemId];
        if (!item) return state;
        const updated = { ...item, status };
        logChange({ action: 'Set status', entityType: 'work_item', entityId: workItemId, entityName: item.title, details: `Status → ${status}` });
        upsertWorkItem(updated, orgId);
        return { ...pushUndo(state), workItems: { ...state.workItems, [workItemId]: updated } };
      });
    },

    renameBacklog: (backlogId, name) => {
      set(state => {
        const orgId = getOrgId(state);
        const backlog = state.backlogs[backlogId];
        if (!backlog || !name.trim()) return state;
        const updated = { ...backlog, name: name.trim() };
        logChange({ action: 'Rename backlog', entityType: 'backlog', entityId: backlogId, entityName: name.trim(), details: `From "${backlog.name}"` });
        upsertBacklog(updated, orgId);
        return { ...pushUndo(state), backlogs: { ...state.backlogs, [backlogId]: updated } };
      });
    },

    renameWorkItem: (workItemId, title) => {
      set(state => {
        const orgId = getOrgId(state);
        const item = state.workItems[workItemId];
        if (!item || !title.trim()) return state;
        const updated = { ...item, title: title.trim() };
        logChange({ action: 'Rename work item', entityType: 'work_item', entityId: workItemId, entityName: title.trim(), details: `From "${item.title}"` });
        upsertWorkItem(updated, orgId);
        return { ...pushUndo(state), workItems: { ...state.workItems, [workItemId]: updated } };
      });
    },

    setWorkItemPoints: (workItemId, points) => {
      set(state => {
        const orgId = getOrgId(state);
        const item = state.workItems[workItemId];
        if (!item) return state;
        const updated = { ...item, points };
        logChange({ action: 'Set points', entityType: 'work_item', entityId: workItemId, entityName: item.title, details: `Points → ${points ?? 'none'}` });
        upsertWorkItem(updated, orgId);
        return { ...pushUndo(state), workItems: { ...state.workItems, [workItemId]: updated } };
      });
    },

    renameBacklogTree: (treeId, name) => {
      set(state => {
        const orgId = getOrgId(state);
        const tree = state.backlogTrees[treeId];
        if (!tree || !name.trim()) return state;
        const updated = { ...tree, name: name.trim() };
        upsertBacklogTree(updated, orgId);
        return { ...pushUndo(state), backlogTrees: { ...state.backlogTrees, [treeId]: updated } };
      });
    },

    addBacklogTree: (name) => {
      set(state => {
        const orgId = getOrgId(state);
        const id = `tree-${crypto.randomUUID().slice(0, 8)}`;
        const maxRank = Math.max(-1, ...Object.values(state.backlogTrees).map(t => t.rank ?? 0));
        const newTree: BacklogTree = { id, name: name.trim(), rootBacklogIds: [], rank: maxRank + 1 };
        upsertBacklogTree(newTree, orgId);
        return { ...pushUndo(state), backlogTrees: { ...state.backlogTrees, [id]: newTree } };
      });
    },

    deleteBacklogTree: (treeId) => {
      set(state => {
        const orgId = getOrgId(state);
        const tree = state.backlogTrees[treeId];
        if (!tree) return state;

        const undo = pushUndo(state);
        const updatedBacklogs = { ...state.backlogs };
        const updatedTrees = { ...state.backlogTrees };
        const updatedItems = { ...state.workItems };

        const toDeleteBacklogs = new Set<string>();
        const collect = (id: string) => { toDeleteBacklogs.add(id); state.backlogs[id]?.childrenIds.forEach(collect); };
        tree.rootBacklogIds.forEach(collect);

        const deletedWorkItemIds: string[] = [];
        const changedWorkItems: WorkItem[] = [];

        const deleteWorkItemRecursive = (wiId: string) => {
          const wi = updatedItems[wiId];
          if (!wi) return;
          [...wi.childrenIds].forEach(deleteWorkItemRecursive);
          if (wi.backlogAssignments[treeId]) {
            const otherAssignments = Object.keys(wi.backlogAssignments).filter(t => t !== treeId);
            if (otherAssignments.length > 0) {
              const newAssignments = { ...wi.backlogAssignments };
              delete newAssignments[treeId];
              const updated = { ...wi, backlogAssignments: newAssignments };
              updatedItems[wiId] = updated;
              changedWorkItems.push(updated);
            } else {
              if (wi.parentId && updatedItems[wi.parentId]) {
                updatedItems[wi.parentId] = { ...updatedItems[wi.parentId], childrenIds: updatedItems[wi.parentId].childrenIds.filter(id => id !== wiId) };
              }
              delete updatedItems[wiId];
              deletedWorkItemIds.push(wiId);
            }
          }
        };
        Object.keys(updatedItems).forEach(wiId => {
          if (updatedItems[wiId]?.backlogAssignments[treeId]) deleteWorkItemRecursive(wiId);
        });

        toDeleteBacklogs.forEach(id => delete updatedBacklogs[id]);
        delete updatedTrees[treeId];

        const selectedBacklogIds = state.selectedBacklogIds.filter(id => !toDeleteBacklogs.has(id));
        const selectedTreeId = state.selectedTreeId === treeId ? null : state.selectedTreeId;

        deleteWorkItems(deletedWorkItemIds);
        if (changedWorkItems.length) upsertWorkItems(changedWorkItems, orgId);
        deleteBacklogTreeFromDb(treeId);

        return { ...undo, backlogs: updatedBacklogs, backlogTrees: updatedTrees, workItems: updatedItems, selectedBacklogIds, selectedTreeId };
      });
    },

    reorderBacklogTree: (treeId, targetIndex) => {
      set(state => {
        const orgId = getOrgId(state);
        const sorted = Object.values(state.backlogTrees).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
        const currentIdx = sorted.findIndex(t => t.id === treeId);
        if (currentIdx === -1 || currentIdx === targetIndex) return state;

        const reordered = sorted.filter(t => t.id !== treeId);
        const clamped = Math.max(0, Math.min(targetIndex, reordered.length));
        reordered.splice(clamped, 0, sorted[currentIdx]);

        const updatedTrees = { ...state.backlogTrees };
        const changedTrees: BacklogTree[] = [];
        reordered.forEach((t, i) => {
          const updated = { ...t, rank: i };
          updatedTrees[t.id] = updated;
          changedTrees.push(updated);
        });

        upsertBacklogTrees(changedTrees, orgId);
        return { ...pushUndo(state), backlogTrees: updatedTrees };
      });
    },
  };
});
