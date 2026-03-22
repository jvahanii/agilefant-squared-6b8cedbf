import { create } from 'zustand';
import { WorkItem, Backlog, BacklogTree } from '@/types/models';
import { generateMockData } from './mockData';

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

  selectBacklog: (backlogId: string, treeId: string, ctrlKey?: boolean) => void;
  selectWorkItem: (workItemId: string | null, ctrlKey?: boolean) => void;
  clearWorkItemSelection: () => void;
  moveWorkItemToBacklog: (workItemId: string, targetBacklogId: string, treeId: string) => void;
  reparentWorkItem: (workItemId: string, newParentId: string | null, treeId: string, backlogId: string) => void;
  reorderWorkItemAmongSiblings: (workItemId: string, targetIndex: number, treeId: string, backlogIds: string[]) => void;
  
  reorderWorkItem: (workItemId: string, newRank: number, backlogId: string) => void;
  moveBacklog: (backlogId: string, newParentId: string | null, treeId: string) => void;
  toggleWorkItemExpand: (workItemId: string) => void;
  toggleBacklogExpand: (backlogId: string) => void;
  addBacklog: (name: string, parentId: string | null, treeId: string) => void;
  deleteBacklog: (backlogId: string) => void;
  renameBacklog: (backlogId: string, name: string) => void;
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string) => void;
  deleteWorkItem: (workItemId: string) => void;
  renameWorkItem: (workItemId: string, title: string) => void;
  setWorkItemPoints: (workItemId: string, points: number | undefined) => void;
  removeWorkItemFromTree: (workItemId: string, treeId: string) => void;
  renameBacklogTree: (treeId: string, name: string) => void;
  undo: () => void;
  canUndo: () => boolean;
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

const MAX_UNDO = 50;

function pushUndo(state: AppState & { expandedWorkItems: Set<string>; expandedBacklogs: Set<string> }) {
  return { undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)] };
}

export const useAppStore = create<AppState & {
  expandedWorkItems: Set<string>;
  expandedBacklogs: Set<string>;
}>((set, get) => {
  const mock = generateMockData();

  Object.values(mock.backlogs).forEach(b => {
    if (!b.parentId) expandedBacklogs.add(b.id);
  });

  return {
    ...mock,
    selectedBacklogIds: [],
    selectedTreeId: null,
    selectedWorkItemIds: [],
    expandedWorkItems,
    expandedBacklogs,
    undoStack: [],

    selectBacklog: (backlogId, treeId, ctrlKey = false) => set(state => {
      if (ctrlKey) {
        // Only allow multi-select within same tree
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

    canUndo: () => get().undoStack.length > 0,

    undo: () => {
      set(state => {
        const stack = [...state.undoStack];
        const prev = stack.pop();
        if (!prev) return state;
        return { ...prev, undoStack: stack };
      });
    },

    moveWorkItemToBacklog: (workItemId, targetBacklogId, treeId) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item) return state;

        const undo = pushUndo(state);
        const updatedItems = { ...state.workItems };

        const moveRecursive = (id: string) => {
          const wi = updatedItems[id];
          if (!wi) return;
          updatedItems[id] = {
            ...wi,
            backlogAssignments: { ...wi.backlogAssignments, [treeId]: targetBacklogId }
          };
          wi.childrenIds.forEach(moveRecursive);
        };
        moveRecursive(workItemId);

        return { ...undo, workItems: updatedItems };
      });
    },

    reparentWorkItem: (workItemId, newParentId, treeId, backlogId) => {
      set(state => {
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

        if (item.parentId && updatedItems[item.parentId]) {
          updatedItems[item.parentId] = {
            ...updatedItems[item.parentId],
            childrenIds: updatedItems[item.parentId].childrenIds.filter(id => id !== workItemId),
          };
        }

        if (newParentId && updatedItems[newParentId]) {
          updatedItems[newParentId] = {
            ...updatedItems[newParentId],
            childrenIds: [...updatedItems[newParentId].childrenIds, workItemId],
          };
        }

        updatedItems[workItemId] = { ...item, parentId: newParentId };

        const nextExpanded = new Set(state.expandedWorkItems);
        if (newParentId) nextExpanded.add(newParentId);

        return { ...undo, workItems: updatedItems, expandedWorkItems: nextExpanded };
      });
    },

    reorderWorkItem: (workItemId, newRank) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item) return state;
        const undo = pushUndo(state);
        return {
          ...undo,
          workItems: {
            ...state.workItems,
            [workItemId]: { ...item, rank: newRank }
          }
        };
      });
    },

    reorderWorkItemAmongSiblings: (workItemId, targetIndex, treeId, backlogIds) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item) return state;

        const backlogIdSet = new Set(backlogIds);

        // Get siblings: items with same parent in the given set of backlogs
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
        reordered.forEach((s, i) => {
          updatedItems[s.id] = { ...updatedItems[s.id], rank: i };
        });

        return { ...undo, workItems: updatedItems };
      });
    },

    moveBacklog: (backlogId, newParentId, treeId) => {
      set(state => {
        const backlog = state.backlogs[backlogId];
        if (!backlog) return state;

        const undo = pushUndo(state);
        const updatedBacklogs = { ...state.backlogs };
        const updatedTrees = { ...state.backlogTrees };

        if (backlog.parentId) {
          const oldParent = updatedBacklogs[backlog.parentId];
          if (oldParent) {
            updatedBacklogs[backlog.parentId] = {
              ...oldParent,
              childrenIds: oldParent.childrenIds.filter(id => id !== backlogId)
            };
          }
        } else {
          const tree = updatedTrees[treeId];
          if (tree) {
            updatedTrees[treeId] = {
              ...tree,
              rootBacklogIds: tree.rootBacklogIds.filter(id => id !== backlogId)
            };
          }
        }

        if (newParentId) {
          const newParent = updatedBacklogs[newParentId];
          if (newParent) {
            updatedBacklogs[newParentId] = {
              ...newParent,
              childrenIds: [...newParent.childrenIds, backlogId]
            };
          }
        } else {
          const tree = updatedTrees[treeId];
          if (tree) {
            updatedTrees[treeId] = {
              ...tree,
              rootBacklogIds: [...tree.rootBacklogIds, backlogId]
            };
          }
        }

        updatedBacklogs[backlogId] = { ...backlog, parentId: newParentId };

        return { ...undo, backlogs: updatedBacklogs, backlogTrees: updatedTrees };
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
          if (parent) {
            updatedBacklogs[parentId] = { ...parent, childrenIds: [...parent.childrenIds, id] };
          }
        } else {
          const tree = updatedTrees[treeId];
          if (tree) {
            updatedTrees[treeId] = { ...tree, rootBacklogIds: [...tree.rootBacklogIds, id] };
          }
        }

        const next = new Set(state.expandedBacklogs);
        if (parentId) next.add(parentId);

        return { ...undo, backlogs: updatedBacklogs, backlogTrees: updatedTrees, expandedBacklogs: next };
      });
    },

    deleteBacklog: (backlogId) => {
      set(state => {
        const backlog = state.backlogs[backlogId];
        if (!backlog) return state;

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

        Object.keys(updatedItems).forEach(wiId => {
          const wi = updatedItems[wiId];
          if (wi.backlogAssignments[backlog.treeId] && toDelete.has(wi.backlogAssignments[backlog.treeId])) {
            const newAssignments = { ...wi.backlogAssignments };
            delete newAssignments[backlog.treeId];
            updatedItems[wiId] = { ...wi, backlogAssignments: newAssignments };
          }
        });

        if (backlog.parentId) {
          const parent = updatedBacklogs[backlog.parentId];
          if (parent) {
            updatedBacklogs[backlog.parentId] = {
              ...parent, childrenIds: parent.childrenIds.filter(id => id !== backlogId)
            };
          }
        } else {
          const tree = updatedTrees[backlog.treeId];
          if (tree) {
            updatedTrees[backlog.treeId] = {
              ...tree, rootBacklogIds: tree.rootBacklogIds.filter(id => id !== backlogId)
            };
          }
        }

        toDelete.forEach(id => delete updatedBacklogs[id]);

        const selectedBacklogIds = state.selectedBacklogIds.filter(id => !toDelete.has(id));

        return { ...undo, backlogs: updatedBacklogs, backlogTrees: updatedTrees, workItems: updatedItems, selectedBacklogIds };
      });
    },

    addWorkItem: (title, parentId, backlogId, treeId) => {
      set(state => {
        const undo = pushUndo(state);
        const id = `wi-${crypto.randomUUID().slice(0, 8)}`;
        const newItem: WorkItem = {
          id, title, parentId, childrenIds: [],
          backlogAssignments: { [treeId]: backlogId },
          rank: Object.values(state.workItems).length,
        };
        const updatedItems = { ...state.workItems, [id]: newItem };

        if (parentId && updatedItems[parentId]) {
          updatedItems[parentId] = {
            ...updatedItems[parentId],
            childrenIds: [...updatedItems[parentId].childrenIds, id],
          };
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

        const undo = pushUndo(state);
        const toDelete = new Set<string>();
        const collect = (id: string) => {
          toDelete.add(id);
          state.workItems[id]?.childrenIds.forEach(collect);
        };
        collect(workItemId);

        const updatedItems = { ...state.workItems };

        if (item.parentId && updatedItems[item.parentId]) {
          updatedItems[item.parentId] = {
            ...updatedItems[item.parentId],
            childrenIds: updatedItems[item.parentId].childrenIds.filter(id => id !== workItemId),
          };
        }

        toDelete.forEach(id => delete updatedItems[id]);

        const selectedWorkItemIds = state.selectedWorkItemIds.filter(id => !toDelete.has(id));

        return { ...undo, workItems: updatedItems, selectedWorkItemIds };
      });
    },

    removeWorkItemFromTree: (workItemId, treeId) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item) return state;

        const undo = pushUndo(state);
        const updatedItems = { ...state.workItems };

        const removeRecursive = (id: string) => {
          const wi = updatedItems[id];
          if (!wi) return;
          const newAssignments = { ...wi.backlogAssignments };
          delete newAssignments[treeId];
          updatedItems[id] = { ...wi, backlogAssignments: newAssignments };
          wi.childrenIds.forEach(removeRecursive);
        };
        removeRecursive(workItemId);

        return { ...undo, workItems: updatedItems };
      });
    },

    renameBacklog: (backlogId, name) => {
      set(state => {
        const backlog = state.backlogs[backlogId];
        if (!backlog || !name.trim()) return state;
        return {
          ...pushUndo(state),
          backlogs: { ...state.backlogs, [backlogId]: { ...backlog, name: name.trim() } },
        };
      });
    },

    renameWorkItem: (workItemId, title) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item || !title.trim()) return state;
        return {
          workItems: { ...state.workItems, [workItemId]: { ...item, title: title.trim() } },
        };
      });
    },

    setWorkItemPoints: (workItemId, points) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item) return state;
        return {
          workItems: { ...state.workItems, [workItemId]: { ...item, points } },
        };
      });
    },

    renameBacklogTree: (treeId, name) => {
      set(state => {
        const tree = state.backlogTrees[treeId];
        if (!tree || !name.trim()) return state;
        return {
          backlogTrees: { ...state.backlogTrees, [treeId]: { ...tree, name: name.trim() } },
        };
      });
    },
  };
});
