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

/**
 * Compute total logged minutes for a backlog tree.
 * Includes:
 *  - time entries logged directly on the tree
 *  - time entries logged on any backlog in the tree
 *  - time entries logged on work items assigned to any backlog in the tree
 */
export function computeTreeTotalMinutes(
  treeId: string,
  backlogs: Record<string, Backlog>,
  workItems: Record<string, WorkItem>,
  timeEntries: Record<string, TimeEntry>,
): number {
  const backlogIdsInTree = new Set<string>();
  for (const b of Object.values(backlogs)) {
    if (b.treeId === treeId) backlogIdsInTree.add(b.id);
  }

  let total = 0;
  for (const entry of Object.values(timeEntries)) {
    if (entry.workItemId) {
      const wi = workItems[entry.workItemId];
      if (wi?.backlogAssignments?.[treeId]) total += entry.durationMinutes;
    } else if (entry.backlogId) {
      if (backlogIdsInTree.has(entry.backlogId)) total += entry.durationMinutes;
    } else if (entry.treeId === treeId) {
      total += entry.durationMinutes;
    }
  }
  return total;
}

export type DeleteTarget =
  | { kind: 'work_item'; id: string }
  | { kind: 'backlog'; id: string }
  | { kind: 'tree'; id: string };

/**
 * Collect IDs of time entries that would become orphaned when the given
 * target (work item, backlog, or entire backlog tree) is deleted.
 * Includes entries directly on the target and — for containers — on any
 * descendant backlogs and on any work items that will disappear as a result
 * (i.e. whose only backlog assignment lives inside the deleted subtree).
 */
export function collectAffectedTimeEntryIds(
  target: DeleteTarget,
  data: {
    workItems: Record<string, WorkItem>;
    backlogs: Record<string, Backlog>;
    timeEntries: Record<string, TimeEntry>;
  },
): string[] {
  const { workItems, backlogs, timeEntries } = data;
  const ids: string[] = [];

  if (target.kind === 'work_item') {
    const subtree = collectWorkItemSubtree(target.id, workItems);
    for (const e of Object.values(timeEntries)) {
      if (e.workItemId && subtree.has(e.workItemId)) ids.push(e.id);
    }
    return ids;
  }

  // Determine the set of backlogs whose contents will be deleted, and the
  // set of trees (only for the tree case).
  let doomedBacklogIds: Set<string>;
  let doomedTreeId: string | null = null;
  if (target.kind === 'backlog') {
    doomedBacklogIds = collectBacklogSubtree(target.id, backlogs);
  } else {
    doomedTreeId = target.id;
    doomedBacklogIds = new Set<string>();
    for (const b of Object.values(backlogs)) {
      if (b.treeId === target.id) doomedBacklogIds.add(b.id);
    }
  }

  // Work items that will actually disappear: those whose *every* backlog
  // assignment falls inside the doomed set (or, for tree deletes, whose only
  // remaining assignment is in the doomed tree).
  const doomedItemIds = new Set<string>();
  for (const wi of Object.values(workItems)) {
    const assignments = Object.entries(wi.backlogAssignments || {});
    if (assignments.length === 0) continue;
    const survives = assignments.some(([treeId, backlogId]) => {
      if (doomedTreeId && treeId === doomedTreeId) return false;
      return !doomedBacklogIds.has(backlogId);
    });
    if (!survives) doomedItemIds.add(wi.id);
  }

  for (const e of Object.values(timeEntries)) {
    if (e.workItemId) {
      if (doomedItemIds.has(e.workItemId)) ids.push(e.id);
    } else if (e.backlogId) {
      if (doomedBacklogIds.has(e.backlogId)) ids.push(e.id);
    } else if (e.treeId && doomedTreeId && e.treeId === doomedTreeId) {
      ids.push(e.id);
    }
  }
  return ids;
}


