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
  upsertBacklogTrees,
  deleteBacklogTree as deleteBacklogTreeFromDb,
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
}

interface AppState extends DataSnapshot {
  undoStack: DataSnapshot[];
  redoStack: DataSnapshot[];
  isLoading: boolean;
  organizationId: string | null;
  setOrganizationId: (orgId: string) => void;
  loadData: () => Promise<void>; // Naming matched to Index.tsx expectations
  
  logChange: (entry: Omit<ChangeLogEntry, 'timestamp'>) => void;
  clearChangeLog: () => void;

  selectBacklog: (backlogId: string, treeId: string, ctrlKey?: boolean) => void;
  selectWorkItem: (workItemId: string | null, ctrlKey?: boolean) => void;
  clearWorkItemSelection: () => void;
  moveWorkItemToBacklog: (workItemId: string, targetBacklogId: string, treeId: string) => void;
  reparentWorkItem: (workItemId: string, newParentId: string | null, treeId: string, backlogId: string) => void;
  reorderWorkItemAmongSiblings: (workItemId: string, targetIndex: number, treeId: string, backlogIds: string[]) => void;
  reorderWorkItem: (workItemId: string, newRank: number, backlogId: string) => void;
  
  moveBacklog: (backlogId: string, newParentId: string | null, treeId: string) => void;
  reorderBacklogAmongSiblings: (
    backlogId: string,
    targetIndex: number,
    newParentId: string | null,
    treeId: string,
  ) => void;
  
  toggleWorkItemExpand: (workItemId: string) => void;
  toggleBacklogExpand: (backlogId: string) => void;
  addBacklog: (name: string, parentId: string | null, treeId: string) => void;
  deleteBacklog: (backlogId: string) => void;
  renameBacklog: (backlogId: string, name: string) => void;
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string, index?: number) => void;
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

const snapshot = (state: DataSnapshot): DataSnapshot => ({
  workItems: { ...state.workItems },
  backlogs: { ...state.backlogs },
  backlogTrees: { ...state