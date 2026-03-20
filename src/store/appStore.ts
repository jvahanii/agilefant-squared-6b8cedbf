import { create } from 'zustand';
import { WorkItem, Backlog, BacklogTree } from '@/types/models';
import { generateMockData } from './mockData';

interface AppState {
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
  selectedBacklogId: string | null;
  selectedTreeId: string | null;

  selectBacklog: (backlogId: string, treeId: string) => void;
  moveWorkItemToBacklog: (workItemId: string, targetBacklogId: string, treeId: string) => void;
  reorderWorkItem: (workItemId: string, newRank: number, backlogId: string) => void;
  moveBacklog: (backlogId: string, newParentId: string | null, treeId: string) => void;
  toggleWorkItemExpand: (workItemId: string) => void;
  toggleBacklogExpand: (backlogId: string) => void;
  addBacklog: (name: string, parentId: string | null, treeId: string) => void;
  deleteBacklog: (backlogId: string) => void;
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string) => void;
  deleteWorkItem: (workItemId: string) => void;
}

// Track expanded state separately so it doesn't clutter the model
const expandedWorkItems = new Set<string>();
const expandedBacklogs = new Set<string>();

export const useAppStore = create<AppState & {
  expandedWorkItems: Set<string>;
  expandedBacklogs: Set<string>;
}>((set, get) => {
  const mock = generateMockData();
  
  // Expand root backlogs by default
  Object.values(mock.backlogs).forEach(b => {
    if (!b.parentId) expandedBacklogs.add(b.id);
  });

  return {
    ...mock,
    selectedBacklogId: null,
    selectedTreeId: null,
    expandedWorkItems,
    expandedBacklogs,

    selectBacklog: (backlogId, treeId) => set({ selectedBacklogId: backlogId, selectedTreeId: treeId }),

    moveWorkItemToBacklog: (workItemId, targetBacklogId, treeId) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item) return state;

        const updatedItems = { ...state.workItems };
        
        // Move item and all descendants
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

        return { workItems: updatedItems };
      });
    },

    reorderWorkItem: (workItemId, newRank) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item) return state;
        return {
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
        
        const updatedBacklogs = { ...state.backlogs };
        const updatedTrees = { ...state.backlogTrees };

        // Remove from old parent
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

        // Add to new parent
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

        return { backlogs: updatedBacklogs, backlogTrees: updatedTrees };
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

        return { backlogs: updatedBacklogs, backlogTrees: updatedTrees, expandedBacklogs: next };
      });
    },

    deleteBacklog: (backlogId) => {
      set(state => {
        const backlog = state.backlogs[backlogId];
        if (!backlog) return state;

        // Collect all descendant backlog IDs
        const toDelete = new Set<string>();
        const collect = (id: string) => {
          toDelete.add(id);
          state.backlogs[id]?.childrenIds.forEach(collect);
        };
        collect(backlogId);

        const updatedBacklogs = { ...state.backlogs };
        const updatedTrees = { ...state.backlogTrees };
        const updatedItems = { ...state.workItems };

        // Remove backlog assignments from work items
        Object.keys(updatedItems).forEach(wiId => {
          const wi = updatedItems[wiId];
          if (wi.backlogAssignments[backlog.treeId] && toDelete.has(wi.backlogAssignments[backlog.treeId])) {
            const newAssignments = { ...wi.backlogAssignments };
            delete newAssignments[backlog.treeId];
            updatedItems[wiId] = { ...wi, backlogAssignments: newAssignments };
          }
        });

        // Remove from parent
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

        return { backlogs: updatedBacklogs, backlogTrees: updatedTrees, workItems: updatedItems, selectedBacklogId };
      });
    },

    addWorkItem: (title, parentId, backlogId, treeId) => {
      set(state => {
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
          return { workItems: updatedItems, expandedWorkItems: next };
        }

        return { workItems: updatedItems };
      });
    },

    deleteWorkItem: (workItemId) => {
      set(state => {
        const item = state.workItems[workItemId];
        if (!item) return state;

        // Collect all descendants
        const toDelete = new Set<string>();
        const collect = (id: string) => {
          toDelete.add(id);
          state.workItems[id]?.childrenIds.forEach(collect);
        };
        collect(workItemId);

        const updatedItems = { ...state.workItems };

        // Remove from parent's children
        if (item.parentId && updatedItems[item.parentId]) {
          updatedItems[item.parentId] = {
            ...updatedItems[item.parentId],
            childrenIds: updatedItems[item.parentId].childrenIds.filter(id => id !== workItemId),
          };
        }

        toDelete.forEach(id => delete updatedItems[id]);

        return { workItems: updatedItems };
      });
    },
  };
});
