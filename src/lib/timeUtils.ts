import { Backlog, WorkItem } from "@/types/models";
import { TimeEntry } from "@/store/timeEntryStore";

/**
 * Iteratively collect the given backlog and all its descendants into a Set of IDs.
 */
export function collectBacklogSubtree(
  backlogId: string,
  backlogs: Record<string, Backlog>,
): Set<string> {
  const ids = new Set<string>();
  const queue: string[] = [backlogId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (ids.has(id)) continue;
    ids.add(id);
    backlogs[id]?.childrenIds.forEach((cid) => queue.push(cid));
  }
  return ids;
}

/**
 * Iteratively collect the given work item and all its descendants into a Set of IDs.
 */
export function collectWorkItemSubtree(
  workItemId: string,
  workItems: Record<string, WorkItem>,
): Set<string> {
  const ids = new Set<string>();
  const queue: string[] = [workItemId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (ids.has(id)) continue;
    ids.add(id);
    workItems[id]?.childrenIds.forEach((cid) => queue.push(cid));
  }
  return ids;
}

/**
 * Compute total logged minutes for a work item and all its descendants.
 */
export function computeWorkItemTotalMinutes(
  workItemId: string,
  workItems: Record<string, WorkItem>,
  timeEntries: Record<string, TimeEntry>,
): number {
  const itemIds = collectWorkItemSubtree(workItemId, workItems);
  let total = 0;
  for (const entry of Object.values(timeEntries)) {
    if (entry.workItemId && itemIds.has(entry.workItemId)) {
      total += entry.durationMinutes;
    }
  }
  return total;
}

/**
 * Compute total logged minutes for a backlog subtree.
 * Includes:
 *  - time entries logged directly on any backlog in the subtree
 *  - time entries logged on work items assigned (via treeId) to any backlog in the subtree
 */
export function computeBacklogTotalMinutes(
  backlogId: string,
  treeId: string,
  backlogs: Record<string, Backlog>,
  workItems: Record<string, WorkItem>,
  timeEntries: Record<string, TimeEntry>,
): number {
  const backlogIds = collectBacklogSubtree(backlogId, backlogs);

  let total = 0;
  for (const entry of Object.values(timeEntries)) {
    if (entry.workItemId === null) {
      if (entry.backlogId && backlogIds.has(entry.backlogId)) {
        total += entry.durationMinutes;
      }
    } else {
      const wi = workItems[entry.workItemId];
      if (wi && wi.backlogAssignments && backlogIds.has(wi.backlogAssignments[treeId])) {
        total += entry.durationMinutes;
      }
    }
  }
  return total;
}
