import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
  removeWorkItemFromTree: (workItemId: string, treeId: string) => void;
  renameBacklogTree: (treeId: string, name: string) => void;
  addBacklogTree: (name: string) => void;
  deleteBacklogTree: (treeId: string) => void;
  reorderBacklogTree: (treeId: string, targetIndex: number) => void;
  resetToMockData: () => void;
  undo: () => void;
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

type StoreState = AppState & {
  expandedWorkItems: Set<string>;
  expandedBacklogs: Set<string>;
};

export const useAppStore = create<StoreState>()(persist<StoreState>((set, get) => {
  const savedState = localStorage.getItem('app-store');
  const mock = savedState ? null : generateMockData();
  const initial = mock ?? { backlogTrees: {}, backlogs: {}, workItems: {} };

  if (!savedState) {
    Object.values(initial.backlogs).forEach(b => {
      if (!b.parentId) expandedBacklogs.add(b.id);
    });
  }

  return {
    ...initial,
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

    resetToMockData: () => {
      const mock = generateMockData();
      const nextExpanded = new Set<string>();
      Object.values(mock.backlogs).forEach(b => {
        if (!b.parentId) nextExpanded.add(b.id);
      });
      set({
        ...mock,
        selectedBacklogIds: [],
        selectedTreeId: null,
        selectedWorkItemIds: [],
        expandedBacklogs: nextExpanded,
        expandedWorkItems: new Set<string>(),
        undoStack: [],
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

    reorderBacklogAmongSiblings: (backlogId, targetIndex, newParentId, treeId) => {
      set(state => {
        const backlog = state.backlogs[backlogId];
        if (!backlog || backlog.treeId !== treeId) return state;

        // If parent changed, do a move first conceptually
        const updatedBacklogs = { ...state.backlogs };
        const updatedTrees = { ...state.backlogTrees };

        // Remove from old parent/root
        if (backlog.parentId !== newParentId) {
          if (backlog.parentId) {
            const oldParent = updatedBacklogs[backlog.parentId];
            if (oldParent) {
              updatedBacklogs[backlog.parentId] = {
                ...oldParent,
                childrenIds: oldParent.childrenIds.filter(id => id !== backlogId),
              };
            }
          } else {
            const tree = updatedTrees[treeId];
            if (tree) {
              updatedTrees[treeId] = {
                ...tree,
                rootBacklogIds: tree.rootBacklogIds.filter(id => id !== backlogId),
              };
            }
          }
          updatedBacklogs[backlogId] = { ...backlog, parentId: newParentId };

          // Add to new parent/root (will be reordered below)
          if (newParentId) {
            const newParent = updatedBacklogs[newParentId];
            if (newParent) {
              updatedBacklogs[newParentId] = {
                ...newParent,
                childrenIds: [...newParent.childrenIds, backlogId],
              };
            }
          } else {
            const tree = updatedTrees[treeId];
            if (tree) {
              updatedTrees[treeId] = { ...tree, rootBacklogIds: [...tree.rootBacklogIds, backlogId] };
            }
          }
        }

        // Now reorder among siblings
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

        // Update ranks
        siblings.forEach((id, i) => {
          updatedBacklogs[id] = { ...updatedBacklogs[id], rank: i };
        });

        // Write back the ordered list
        if (newParentId) {
          updatedBacklogs[newParentId] = { ...updatedBacklogs[newParentId], childrenIds: siblings };
        } else {
          updatedTrees[treeId] = { ...updatedTrees[treeId], rootBacklogIds: siblings };
        }

        const nextExpanded = new Set(state.expandedBacklogs);
        if (newParentId) nextExpanded.add(newParentId);

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
          ...pushUndo(state),
          workItems: { ...state.workItems, [workItemId]: { ...item, title: title.trim() } },
        };
      });
    },

    setWorkItemPoints: (workItemId, points) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item) return state;
        return {
          ...pushUndo(state),
          workItems: { ...state.workItems, [workItemId]: { ...item, points } },
        };
      });
    },

    renameBacklogTree: (treeId, name) => {
      set(state => {
        const tree = state.backlogTrees[treeId];
        if (!tree || !name.trim()) return state;
        return {
          ...pushUndo(state),
          backlogTrees: { ...state.backlogTrees, [treeId]: { ...tree, name: name.trim() } },
        };
      });
    },

    addBacklogTree: (name) => {
      set(state => {
        const id = `tree-${crypto.randomUUID().slice(0, 8)}`;
        const maxRank = Math.max(-1, ...Object.values(state.backlogTrees).map(t => t.rank ?? 0));
        const newTree: BacklogTree = { id, name: name.trim(), rootBacklogIds: [], rank: maxRank + 1 };
        return {
          ...pushUndo(state),
          backlogTrees: { ...state.backlogTrees, [id]: newTree },
        };
      });
    },

    deleteBacklogTree: (treeId) => {
      set(state => {
        const tree = state.backlogTrees[treeId];
        if (!tree) return state;

        const undo = pushUndo(state);
        const updatedBacklogs = { ...state.backlogs };
        const updatedTrees = { ...state.backlogTrees };
        const updatedItems = { ...state.workItems };

        // Collect all backlogs in this tree
        const toDelete = new Set<string>();
        const collect = (id: string) => {
          toDelete.add(id);
          state.backlogs[id]?.childrenIds.forEach(collect);
        };
        tree.rootBacklogIds.forEach(collect);

        // Remove tree assignments from work items
        Object.keys(updatedItems).forEach(wiId => {
          const wi = updatedItems[wiId];
          if (wi.backlogAssignments[treeId]) {
            const newAssignments = { ...wi.backlogAssignments };
            delete newAssignments[treeId];
            updatedItems[wiId] = { ...wi, backlogAssignments: newAssignments };
          }
        });

        // Delete backlogs
        toDelete.forEach(id => delete updatedBacklogs[id]);

        // Delete tree
        delete updatedTrees[treeId];

        const selectedBacklogIds = state.selectedBacklogIds.filter(id => !toDelete.has(id));
        const selectedTreeId = state.selectedTreeId === treeId ? null : state.selectedTreeId;

        return { ...undo, backlogs: updatedBacklogs, backlogTrees: updatedTrees, workItems: updatedItems, selectedBacklogIds, selectedTreeId };
      });
    },

    reorderBacklogTree: (treeId, targetIndex) => {
      set(state => {
        const sorted = Object.values(state.backlogTrees).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
        const currentIdx = sorted.findIndex(t => t.id === treeId);
        if (currentIdx === -1 || currentIdx === targetIndex) return state;

        const reordered = sorted.filter(t => t.id !== treeId);
        const clamped = Math.max(0, Math.min(targetIndex, reordered.length));
        reordered.splice(clamped, 0, sorted[currentIdx]);

        const updatedTrees = { ...state.backlogTrees };
        reordered.forEach((t, i) => {
          updatedTrees[t.id] = { ...t, rank: i };
        });

        return { ...pushUndo(state), backlogTrees: updatedTrees };
      });
    },
  };
}, {
  name: 'app-store',
  partialize: (state: StoreState) => ({
    workItems: state.workItems,
    backlogs: state.backlogs,
    backlogTrees: state.backlogTrees,
  } as unknown as StoreState),
}));
