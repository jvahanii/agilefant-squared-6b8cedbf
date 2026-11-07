/**
 * Where a work item sits, as the search and filter results show it: in each
 * tree it is in, the list (with the lists above it) and the items above it.
 */
import { getEffectiveParentId, type Backlog, type BacklogTree, type WorkItem } from "@/types/models";

export interface ItemPlace {
  item: WorkItem;
  treeId: string;
  backlogId: string;
  treeName: string;
  backlogName: string;
  /** The list's names, from the top list down to its own. */
  backlogPath: string[];
  /** The titles of the items above it in this tree, top first. */
  workItemAncestors: string[];
}

/** A list's name and the names of the lists above it, top first. */
export function backlogPathNames(backlogs: Record<string, Backlog>, backlogId: string | null | undefined): string[] {
  const path: string[] = [];
  const visited = new Set<string>();
  let bl = backlogId ? backlogs[backlogId] : null;
  while (bl && !visited.has(bl.id)) {
    visited.add(bl.id);
    path.unshift(bl.name);
    bl = bl.parentId ? backlogs[bl.parentId] : null;
  }
  return path;
}

/** One place per tree the item is in: an item in several trees shows in each. */
export function placesOf(
  wi: WorkItem,
  workItems: Record<string, WorkItem>,
  backlogs: Record<string, Backlog>,
  backlogTrees: Record<string, BacklogTree>,
): ItemPlace[] {
  return Object.keys(wi.backlogAssignments)
    .filter((treeId) => treeId !== "")
    .map((treeId) => {
      const backlogId = wi.backlogAssignments[treeId];
      const backlog = backlogId ? backlogs[backlogId] : null;
      // The items above it, by its parent in this tree.
      const workItemAncestors: string[] = [];
      const visited = new Set<string>();
      let parentId = getEffectiveParentId(wi, treeId);
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = workItems[parentId];
        if (!parent) break;
        workItemAncestors.unshift(parent.title);
        parentId = getEffectiveParentId(parent, treeId);
      }
      return {
        item: wi,
        treeId,
        backlogId: backlogId ?? "",
        treeName: backlogTrees[treeId]?.name ?? "",
        backlogName: backlog?.name ?? "",
        backlogPath: backlogPathNames(backlogs, backlogId),
        workItemAncestors,
      };
    });
}
