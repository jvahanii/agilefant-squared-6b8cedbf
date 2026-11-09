import type { AppState, DataSnapshot } from "./types";

/**
 * Rows that arrived from somewhere else — another person, another device, a
 * background import — rather than from an edit made on this page.
 *
 * Undo writes the difference between the screen and its snapshot, and an undo
 * snapshot only ever records this page's own edits. Without this set, anything
 * that appeared after the last local edit counts as "removed by undo" and is
 * deleted in the database. Undo leaves these alone and keeps them on screen.
 */
export const remotelyAddedWorkItemIds = new Set<string>();
export const remotelyAddedBacklogIds = new Set<string>();
export const remotelyAddedTreeIds = new Set<string>();

export function noteRemoteArrival(set: Set<string>, id: string) {
  set.add(id);
  // Bounded so a long session can't grow it without limit.
  if (set.size > 5000) {
    const first = set.values().next().value as string | undefined;
    if (first !== undefined) set.delete(first);
  }
}

/**
 * Carry entities that arrived from elsewhere across an undo or redo: they stay
 * on screen, and the snapshot switch no longer treats them as deletions.
 */
export function keepRemoteAdditions(from: AppState, to: DataSnapshot): DataSnapshot {
  let workItems = to.workItems;
  let backlogs = to.backlogs;
  let backlogTrees = to.backlogTrees;
  for (const id of remotelyAddedWorkItemIds) {
    if (from.workItems[id] && !workItems[id]) {
      if (workItems === to.workItems) workItems = { ...workItems };
      workItems[id] = from.workItems[id];
    }
  }
  for (const id of remotelyAddedBacklogIds) {
    if (from.backlogs[id] && !backlogs[id]) {
      if (backlogs === to.backlogs) backlogs = { ...backlogs };
      backlogs[id] = from.backlogs[id];
    }
  }
  for (const id of remotelyAddedTreeIds) {
    if (from.backlogTrees[id] && !backlogTrees[id]) {
      if (backlogTrees === to.backlogTrees) backlogTrees = { ...backlogTrees };
      backlogTrees[id] = from.backlogTrees[id];
    }
  }
  if (workItems === to.workItems && backlogs === to.backlogs && backlogTrees === to.backlogTrees) return to;
  return { ...to, workItems, backlogs, backlogTrees };
}
