import { create } from "zustand";
import { WorkItem, WorkItemStatus, Backlog, BacklogTree } from "@/types/models";
import { loadFromSupabase, upsertWorkItems } from "./supabaseSync";

// ... [Keep existing ChangeLogEntry, DataSnapshot, etc.]

export const useAppStore = create<AppState>()((set, get) => {
  const internalLog = (entry: Omit<ChangeLogEntry, "timestamp">) => {
    set((state) => ({
      changeLog: [...state.changeLog, { ...entry, timestamp: new Date().toISOString() }],
    }));
  };

  return {
    // ... [Keep initial state: workItems, backlogs, etc.]

    addWorkItem: (title, parentId, backlogId, treeId, requestedRank) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;

      const updatedItems = { ...state.workItems };

      // Filter siblings to handle ranking correctly
      const siblings = Object.values(updatedItems)
        .filter((wi) => wi.parentId === parentId && wi.backlogAssignments[treeId] === backlogId)
        .sort((a, b) => (a.rank || 0) - (b.rank || 0));

      // Determine the actual target rank
      let targetRank = requestedRank ?? siblings.length;

      // Shift all siblings that are at or below the target rank
      const itemsToUpdateInDB: WorkItem[] = [];
      Object.values(updatedItems).forEach((wi) => {
        if (wi.parentId === parentId && wi.backlogAssignments[treeId] === backlogId && wi.rank >= targetRank) {
          updatedItems[wi.id] = { ...wi, rank: wi.rank + 1 };
          itemsToUpdateInDB.push(updatedItems[wi.id]);
        }
      });

      const id = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const newItem: WorkItem = {
        id,
        title,
        parentId,
        rank: targetRank,
        backlogAssignments: { [treeId]: backlogId },
        status: "To Do" as WorkItemStatus,
        childrenIds: [],
      };

      updatedItems[id] = newItem;
      itemsToUpdateInDB.push(newItem);

      // Persist changes
      upsertWorkItems(itemsToUpdateInDB, orgId);

      set({
        workItems: updatedItems,
        selectedWorkItemIds: [id], // Auto-focus the new item
        undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)],
        redoStack: [],
      });

      internalLog({ action: "Add", entityType: "work_item", entityId: id, entityName: title });
    },

    // ... [Rest of the store methods]
  };
});
