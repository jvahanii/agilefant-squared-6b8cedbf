import { create } from 'zustand';
import { WorkItem, Backlog, BacklogTree } from '@/types/models';
import { generateMockData } from './mockData';

interface DataSnapshot {
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
  treeOrder: string[];
  selectedBacklogId: string | null;
  selectedTreeId: string | null;
  selectedWorkItemId: string | null;
}

interface AppState extends DataSnapshot {
  undoStack: DataSnapshot[];

  selectBacklog: (backlogId: string, treeId: string) => void;
  selectWorkItem: (workItemId: string | null) => void;
  moveWorkItemToBacklog: (workItemId: string, targetBacklogId: string, treeId: string) => void;
  reparentWorkItem: (workItemId: string, newParentId: string | null, treeId: string, backlogId: string) => void;
  reorderWorkItem: (workItemId: string, newRank: number, backlogId: string) => void;
  moveBacklog: (backlogId: string, newParentId: string | null, treeId: string) => void;
  toggleWorkItemExpand: (workItemId: string) => void;
  toggleBacklogExpand: (backlogId: string) => void;
  addBacklog: (name: string, parentId: string | null, treeId: string) => void;
  deleteBacklog: (backlogId: string) => void;
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string) => void;
  deleteWorkItem: (workItemId: string) => void;
  removeWorkItemFromTree: (workItemId: string, treeId: string) => void;
  renameBacklog: (backlogId: string, name: string) => void;
  renameWorkItem: (workItemId: string, title: string) => void;
  updateWorkItemPoints: (workItemId: string, points: number | undefined) => void;
  addBacklogTree: (name: string) => void;
  deleteBacklogTree: (treeId: string) => void;
  renameBacklogTree: (treeId: string, name: string) => void;
  reorderBacklogInList: (backlogId: string, targetBacklogId: string, position: 'before' | 'after') => void;
  moveBacklogToTree: (backlogId: string, targetTreeId: string, targetBacklogId: string | null) => void;
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
    selectedBacklogId: state.selectedBacklogId,
    selectedTreeId: state.selectedTreeId,
    selectedWorkItemId: state.selectedWorkItemId,
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
    selectedBacklogId: null,
    selectedTreeId: null,
    selectedWorkItemId: null,
    expandedWorkItems,
    expandedBacklogs,
    undoStack: [],

    selectBacklog: (backlogId, treeId) => set({ selectedBacklogId: backlogId, selectedTreeId: treeId, selectedWorkItemId: null }),

    selectWorkItem: (workItemId) => set({ selectedWorkItemId: workItemId }),

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

    moveBacklog: (backlogId, newParentId, treeId) => {
      set(state => {
        const backlog = state.backlogs[backlogId];
        if (!backlog) return state;
        if (backlog.parentId === newParentId) return state;
        // Cycle check: ensure newParentId is not a descendant of backlogId
        if (newParentId) {
          let check: string | null = newParentId;
          while (check) {
            if (check === backlogId) return state;
            check = state.backlogs[check]?.parentId ?? null;
          }
        }

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

        let { selectedBacklogId } = state;
        if (selectedBacklogId && toDelete.has(selectedBacklogId)) {
          selectedBacklogId = null;
        }

        return { ...undo, backlogs: updatedBacklogs, backlogTrees: updatedTrees, workItems: updatedItems, selectedBacklogId };
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

        let { selectedWorkItemId } = state;
        if (selectedWorkItemId && toDelete.has(selectedWorkItemId)) {
          selectedWorkItemId = null;
        }

        return { ...undo, workItems: updatedItems, selectedWorkItemId };
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
        if (!backlog || backlog.name === name) return state;
        const undo = pushUndo(state);
        return { ...undo, backlogs: { ...state.backlogs, [backlogId]: { ...backlog, name } } };
      });
    },

    renameWorkItem: (workItemId, title) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item || item.title === title) return state;
        const undo = pushUndo(state);
        return { ...undo, workItems: { ...state.workItems, [workItemId]: { ...item, title } } };
      });
    },

    updateWorkItemPoints: (workItemId, points) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item) return state;
        const undo = pushUndo(state);
        return { ...undo, workItems: { ...state.workItems, [workItemId]: { ...item, points } } };
      });
    },

    addBacklogTree: (name) => {
      set(state => {
        const undo = pushUndo(state);
        const id = `bt-${crypto.randomUUID().slice(0, 8)}`;
        return {
          ...undo,
          backlogTrees: { ...state.backlogTrees, [id]: { id, name, rootBacklogIds: [] } },
        };
      });
    },

    deleteBacklogTree: (treeId) => {
      set(state => {
        const tree = state.backlogTrees[treeId];
        if (!tree) return state;
        const undo = pushUndo(state);

        // Collect all backlogs in this tree
        const toDeleteBacklogs = new Set<string>();
        Object.values(state.backlogs).forEach(b => {
          if (b.treeId === treeId) toDeleteBacklogs.add(b.id);
        });

        const updatedBacklogs = { ...state.backlogs };
        toDeleteBacklogs.forEach(id => delete updatedBacklogs[id]);

        const updatedTrees = { ...state.backlogTrees };
        delete updatedTrees[treeId];

        // Remove tree assignments from work items
        const updatedItems = { ...state.workItems };
        Object.keys(updatedItems).forEach(wiId => {
          const wi = updatedItems[wiId];
          if (wi.backlogAssignments[treeId]) {
            const newAssignments = { ...wi.backlogAssignments };
            delete newAssignments[treeId];
            updatedItems[wiId] = { ...wi, backlogAssignments: newAssignments };
          }
        });

        let { selectedBacklogId, selectedTreeId } = state;
        if (selectedTreeId === treeId) {
          selectedBacklogId = null;
          selectedTreeId = null;
        }

        return { ...undo, backlogTrees: updatedTrees, backlogs: updatedBacklogs, workItems: updatedItems, selectedBacklogId, selectedTreeId };
      });
    },

    renameBacklogTree: (treeId, name) => {
      set(state => {
        const tree = state.backlogTrees[treeId];
        if (!tree || tree.name === name) return state;
        const undo = pushUndo(state);
        return { ...undo, backlogTrees: { ...state.backlogTrees, [treeId]: { ...tree, name } } };
      });
    },

    reorderBacklogInList: (backlogId, targetBacklogId, position) => {
      set(state => {
        if (backlogId === targetBacklogId) return state;
        const backlog = state.backlogs[backlogId];
        const target = state.backlogs[targetBacklogId];
        if (!backlog || !target) return state;
        if (backlog.treeId !== target.treeId) return state;

        const undo = pushUndo(state);
        const updatedBacklogs = { ...state.backlogs };
        const updatedTrees = { ...state.backlogTrees };
        const treeId = backlog.treeId;

        // Remove from old parent
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

        // Insert into target's parent at the right position
        const newParentId = target.parentId;
        updatedBacklogs[backlogId] = { ...backlog, parentId: newParentId };

        if (newParentId) {
          const newParent = updatedBacklogs[newParentId];
          if (newParent) {
            const list = newParent.childrenIds.filter(id => id !== backlogId);
            const idx = list.indexOf(targetBacklogId);
            const insertAt = position === 'after' ? idx + 1 : idx;
            list.splice(insertAt, 0, backlogId);
            updatedBacklogs[newParentId] = { ...newParent, childrenIds: list };
          }
        } else {
          const tree = updatedTrees[treeId];
          if (tree) {
            const list = tree.rootBacklogIds.filter(id => id !== backlogId);
            const idx = list.indexOf(targetBacklogId);
            const insertAt = position === 'after' ? idx + 1 : idx;
            list.splice(insertAt, 0, backlogId);
            updatedTrees[treeId] = { ...tree, rootBacklogIds: list };
          }
        }

        return { ...undo, backlogs: updatedBacklogs, backlogTrees: updatedTrees };
      });
    },

    moveBacklogToTree: (backlogId, targetTreeId, targetBacklogId) => {
      set(state => {
        const backlog = state.backlogs[backlogId];
        if (!backlog) return state;
        if (backlog.treeId === targetTreeId) return state;

        const undo = pushUndo(state);
        const updatedBacklogs = { ...state.backlogs };
        const updatedTrees = { ...state.backlogTrees };
        const updatedItems = { ...state.workItems };
        const sourceTreeId = backlog.treeId;

        // Collect this backlog and all descendants
        const allBacklogIds = new Set<string>();
        const collectBacklogs = (id: string) => {
          allBacklogIds.add(id);
          state.backlogs[id]?.childrenIds.forEach(collectBacklogs);
        };
        collectBacklogs(backlogId);

        // Remove from old parent/tree root
        if (backlog.parentId) {
          const oldParent = updatedBacklogs[backlog.parentId];
          if (oldParent) {
            updatedBacklogs[backlog.parentId] = {
              ...oldParent,
              childrenIds: oldParent.childrenIds.filter(id => id !== backlogId),
            };
          }
        } else {
          const srcTree = updatedTrees[sourceTreeId];
          if (srcTree) {
            updatedTrees[sourceTreeId] = {
              ...srcTree,
              rootBacklogIds: srcTree.rootBacklogIds.filter(id => id !== backlogId),
            };
          }
        }

        // Update treeId for all descendant backlogs
        allBacklogIds.forEach(id => {
          updatedBacklogs[id] = { ...updatedBacklogs[id], treeId: targetTreeId };
        });

        // Set new parent
        updatedBacklogs[backlogId] = { ...updatedBacklogs[backlogId], parentId: targetBacklogId };

        // Add to target
        if (targetBacklogId) {
          const targetParent = updatedBacklogs[targetBacklogId];
          if (targetParent) {
            updatedBacklogs[targetBacklogId] = {
              ...targetParent,
              childrenIds: [...targetParent.childrenIds, backlogId],
            };
          }
        } else {
          const targetTree = updatedTrees[targetTreeId];
          if (targetTree) {
            updatedTrees[targetTreeId] = {
              ...targetTree,
              rootBacklogIds: [...targetTree.rootBacklogIds, backlogId],
            };
          }
        }

        // Re-assign work items from source tree backlogs to target tree
        Object.keys(updatedItems).forEach(wiId => {
          const wi = updatedItems[wiId];
          const assignedBacklogId = wi.backlogAssignments[sourceTreeId];
          if (assignedBacklogId && allBacklogIds.has(assignedBacklogId)) {
            const newAssignments = { ...wi.backlogAssignments };
            delete newAssignments[sourceTreeId];
            newAssignments[targetTreeId] = assignedBacklogId;
            updatedItems[wiId] = { ...wi, backlogAssignments: newAssignments };
          }
        });

        return { ...undo, backlogs: updatedBacklogs, backlogTrees: updatedTrees, workItems: updatedItems };
      });
    },
  };
});
