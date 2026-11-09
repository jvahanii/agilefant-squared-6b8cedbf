/**
 * What is selected — a tree, its lists, their items — and which items and
 * lists are open. The selection is kept in this browser, per organization, and
 * put back on the next load (storedSelection).
 */
import type { WorkItem, Backlog, BacklogTree } from "@/types/models";
import type { AppState, GetState, SetState } from "./types";

/** Where this browser keeps a part of an organization's selection. */
function keptAs(orgId: string, part: "treeId" | "backlogIds" | "workItemIds"): string {
  return `selection_${orgId}_${part}`;
}

/** Ids saved as a JSON array in this browser; none if missing or unreadable. */
function readStoredIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The selection saved for the organisation in this browser, kept to what `data` still has. */
export function storedSelection(
  orgId: string,
  data: { workItems: Record<string, WorkItem>; backlogs: Record<string, Backlog>; backlogTrees: Record<string, BacklogTree> },
) {
  const treeId = localStorage.getItem(keptAs(orgId, "treeId"));
  return {
    backlogIds: readStoredIds(keptAs(orgId, "backlogIds")).filter((id) => data.backlogs[id]),
    treeId: treeId && data.backlogTrees[treeId] ? treeId : null,
    workItemIds: readStoredIds(keptAs(orgId, "workItemIds")).filter((id) => data.workItems[id]),
  };
}

export type SelectionActions = Pick<
  AppState,
  | "toggleWorkItemExpand"
  | "toggleBacklogExpand"
  | "expandWorkItemsRecursive"
  | "collapseWorkItemsRecursive"
  | "expandBacklogsRecursive"
  | "collapseBacklogsRecursive"
  | "selectTree"
  | "selectBacklog"
  | "selectWorkItem"
  | "clearWorkItemSelection"
  | "selectWorkItemRange"
>;

export function selectionActions(set: SetState, get: GetState): SelectionActions {
  return {
    toggleWorkItemExpand: (id) =>
      set((s) => {
        const next = new Set(s.expandedWorkItems);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return { expandedWorkItems: next };
      }),

    toggleBacklogExpand: (id) =>
      set((s) => {
        const next = new Set(s.expandedBacklogs);
        if (next.has(id)) next.delete(id);
        else next.add(id);
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

    selectTree: (treeId) =>
      set(() => {
        const orgId = get().organizationId;
        if (orgId) {
          localStorage.setItem(keptAs(orgId, "treeId"), treeId);
          localStorage.removeItem(keptAs(orgId, "backlogIds"));
          localStorage.removeItem(keptAs(orgId, "workItemIds"));
        }
        return { selectedTreeId: treeId, selectedBacklogIds: [], selectedWorkItemIds: [] };
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
          localStorage.setItem(keptAs(orgId, "backlogIds"), JSON.stringify(ids));
          localStorage.setItem(keptAs(orgId, "treeId"), treeId);
          localStorage.removeItem(keptAs(orgId, "workItemIds"));
        }
        return { selectedBacklogIds: ids, selectedTreeId: treeId, selectedWorkItemIds: [] };
      }),

    selectWorkItem: (workItemId, ctrlKey) =>
      set((state) => {
        const orgId = get().organizationId;
        if (!workItemId) {
          if (orgId) localStorage.removeItem(keptAs(orgId, "workItemIds"));
          return { selectedWorkItemIds: [] };
        }
        const ids = ctrlKey
          ? state.selectedWorkItemIds.includes(workItemId)
            ? state.selectedWorkItemIds.filter((id) => id !== workItemId)
            : [...state.selectedWorkItemIds, workItemId]
          : [workItemId];
        if (orgId) {
          localStorage.setItem(keptAs(orgId, "workItemIds"), JSON.stringify(ids));
        }
        return { selectedWorkItemIds: ids };
      }),

    clearWorkItemSelection: () => {
      const orgId = get().organizationId;
      if (orgId) localStorage.removeItem(keptAs(orgId, "workItemIds"));
      set({ selectedWorkItemIds: [] });
    },

    // One update and one save for the whole range. Item by item, a range of
    // hundreds woke every view of the selection hundreds of times and saved
    // the growing selection to local storage as often.
    selectWorkItemRange: (ids, add) =>
      set((state) => {
        const selected = add ? [...state.selectedWorkItemIds] : [];
        const already = new Set(selected);
        for (const id of ids) {
          if (already.has(id)) continue;
          already.add(id);
          selected.push(id);
        }
        const orgId = get().organizationId;
        if (orgId) localStorage.setItem(keptAs(orgId, "workItemIds"), JSON.stringify(selected));
        return { selectedWorkItemIds: selected };
      }),
  };
}
