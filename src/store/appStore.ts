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
  };
});
