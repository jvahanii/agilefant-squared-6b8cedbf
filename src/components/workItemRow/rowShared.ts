/**
 * What a work item's row shares with the list that draws it: the contexts the
 * list provides, the helpers every part of the row uses to act on "this item,
 * or the selection it is part of", and the bookkeeping of which rows are drawn.
 */
import { createContext } from "react";
import { useAppStore } from "@/store/appStore";
import type { useTeamStore } from "@/store/teamStore";
import type { Label, useLabelsStore } from "@/store/labelsStore";

/**
 * When a label filter is active, this context holds the Set of work item IDs
 * that should be visible (matching items + their ancestors).  Null means "show
 * all" (no filter active).
 */
export const LabelFilterContext = createContext<Set<string> | null>(null);

/**
 * Maps each visible work item ID to its 1-based running number in the current
 * displayed list (depth-first, top-to-bottom).  Null when no backlog is selected.
 */
export const RunningNumberContext = createContext<Map<string, number> | null>(null);

/** Shared data computed once per panel — avoids per-row recomputation. */
export interface SharedData {
  orgLabels: Label[];
  teams: ReturnType<typeof useTeamStore.getState>["teams"];
  labelsVisible: boolean;
  labelsMap: ReturnType<typeof useLabelsStore.getState>["labels"];
  byEntity: ReturnType<typeof useLabelsStore.getState>["byEntity"];
  assignLabel: ReturnType<typeof useLabelsStore.getState>["assignLabel"];
  unassignLabel: ReturnType<typeof useLabelsStore.getState>["unassignLabel"];
  createLabel: ReturnType<typeof useLabelsStore.getState>["createLabel"];
  deleteLabel: ReturnType<typeof useLabelsStore.getState>["deleteLabel"];
  assignTeam: ReturnType<typeof useTeamStore.getState>["assignTeamToWorkItem"];
  unassignTeam: ReturnType<typeof useTeamStore.getState>["unassignTeamFromWorkItem"];
  activeOrgId: string | null;
  timeLoggingVisible: boolean;
  savingsIncomeVisible: boolean;
  burnupsVisible: boolean;
}
export const SharedDataContext = createContext<SharedData | null>(null);

// Minimum pointer movement (in px) required before treating an interaction as a
// drag rather than a click.  Matches PointerSensor's activationConstraint.distance.
const DRAG_THRESHOLD_PX = 8;
export const DRAG_THRESHOLD_PX_SQUARED = DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX;
export const EMPTY_ARRAY: string[] = [];

/**
 * The items an action on this row is for: the whole selection when the row is
 * part of a selection of several, otherwise the row's own item alone.
 */
export function selectionOrItem(workItemId: string): string[] {
  const selected = useAppStore.getState().selectedWorkItemIds;
  return selected.length > 1 && selected.includes(workItemId) ? selected : [workItemId];
}

/** Do `change` to each of those items, as one step to undo when there are several. */
export function changeSelectionOrItem(workItemId: string, change: (id: string) => void): void {
  const ids = selectionOrItem(workItemId);
  if (ids.length > 1) useAppStore.getState().runBulk(() => ids.forEach(change));
  else change(workItemId);
}

/** Whether this row is the one that answers for the selection: its first item's. */
export function isFirstSelected(workItemId: string): boolean {
  return useAppStore.getState().selectedWorkItemIds[0] === workItemId;
}

/**
 * The shortcuts that act on the selection — M moves it, R reparents it,
 * Delete deletes it — each answered by the row of its first item, which opens
 * the dialog or makes the change. A long list draws only the rows near the
 * view: select a range by scrolling down to shift-click its end, and the
 * first item's row is not there to answer, so M did nothing at all.
 */
export const SELECTION_SHORTCUTS = [
  "shortcut:add-child-workitem",
  "shortcut:add-sibling-workitem",
  "shortcut:delete-selected",
  "shortcut:duplicate-selected",
  "shortcut:edit-hyperlinks",
  "shortcut:log-time",
  "shortcut:move-to-parent",
  "shortcut:move-to-backlog",
  "shortcut:open-team-assign",
] as const;

/** The work items whose rows are drawn now, by how many lists draw each. */
const drawnRows = new Map<string, number>();

/** Count a row as drawn while it is; returns the undo, for an effect. */
export function noteRowDrawn(workItemId: string): () => void {
  drawnRows.set(workItemId, (drawnRows.get(workItemId) ?? 0) + 1);
  return () => {
    const left = (drawnRows.get(workItemId) ?? 1) - 1;
    if (left > 0) drawnRows.set(workItemId, left);
    else drawnRows.delete(workItemId);
  };
}

/** Whether the item's row is drawn, and so listening for the shortcuts. */
export function rowIsDrawn(workItemId: string): boolean {
  return (drawnRows.get(workItemId) ?? 0) > 0;
}

export function scrollWorkItemIntoView(itemId: string) {
  // Wait two animation frames so the parent virtualizer has measured and
  // positioned the (possibly newly added) row before we scroll to it.
  // Otherwise scrollIntoView can target the row's stale/estimated position.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-work-item-id="${CSS.escape(itemId)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  });
}

/** Every list from `backlogId` down: the lists a row's list shows as one. */
export function listAndSublists(backlogId: string): string[] {
  const backlogs = useAppStore.getState().backlogs;
  const ids: string[] = [];
  const collect = (id: string) => {
    ids.push(id);
    backlogs[id]?.childrenIds.forEach(collect);
  };
  collect(backlogId);
  return ids;
}
