import type { Backlog, BacklogTree } from "@/types/models";

/** The list a first item goes into when none is selected: the first list of the first tree. */
export function firstList(
  backlogTrees: Record<string, BacklogTree>,
  backlogs: Record<string, Backlog>,
): { treeId: string; backlogId: string } | null {
  const trees = Object.values(backlogTrees).sort((a, b) => a.rank - b.rank);
  for (const tree of trees) {
    const roots = tree.rootBacklogIds
      .map((id) => backlogs[id])
      .filter((b): b is Backlog => !!b)
      .sort((a, b) => a.rank - b.rank);
    if (roots.length > 0) return { treeId: tree.id, backlogId: roots[0].id };
  }
  return null;
}
