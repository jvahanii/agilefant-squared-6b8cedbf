/**
 * A tree whose name carries, in parentheses, how many items some of its lists
 * hold — kept up to date by the job import, which is when those lists change.
 *
 * Asked for on 2026-11-26 for the job hunt: the tree "MWB uuden työn
 * saaminen" shows the applications made so far, the top-level items of four of
 * its lists added up. Each list's own name carries a count typed by hand, as
 * "Lanka vetämässä (55)", so lists are found by their name without it.
 */
import { topLevelItems } from "@/lib/workItemRows";
import type { BacklogTree, Backlog, WorkItem } from "@/types/models";

export interface TreeNameCount {
  /** The tree's name, without the count. */
  tree: string;
  /** The lists whose top-level items are counted, by name without any count. */
  lists: string[];
}

export const TREE_NAME_COUNTS: TreeNameCount[] = [
  {
    tree: "MWB uuden työn saaminen",
    lists: ['"Ei" papereiden perusteella', "Päättyneet prosessit", "Lanka vetämässä", "Prosessit"],
  },
];

/** A name without the parenthesised note at its end: "Prosessit (5)" → "Prosessit". */
export function nameWithoutCount(name: string): string {
  return name.replace(/\s*\([^()]*\)\s*$/, "").trim();
}

/**
 * The names the rules give the trees, where one differs from what the tree is
 * called now. A tree is not renamed when none of its counted lists is found:
 * a count of nothing would only be wrong.
 */
export function treeNameUpdates(
  state: {
    backlogTrees: Record<string, Pick<BacklogTree, "id" | "name">>;
    backlogs: Record<string, Pick<Backlog, "id" | "name" | "treeId">>;
    workItems: Record<string, WorkItem>;
  },
  rules: TreeNameCount[] = TREE_NAME_COUNTS,
): Array<{ treeId: string; name: string }> {
  const out: Array<{ treeId: string; name: string }> = [];
  for (const rule of rules) {
    for (const tree of Object.values(state.backlogTrees ?? {})) {
      if (nameWithoutCount(tree.name) !== rule.tree) continue;
      const wanted = new Set(rule.lists);
      const lists = Object.values(state.backlogs ?? {}).filter(
        (b) => b.treeId === tree.id && wanted.has(nameWithoutCount(b.name)),
      );
      if (lists.length === 0) continue;
      // Each list on its own: an item under a parent in another of these lists
      // is still a top-level item where it is shown.
      const count = lists.reduce((n, list) => n + topLevelItems(state.workItems ?? {}, tree.id, new Set([list.id])).length, 0);
      const name = `${rule.tree} (${count})`;
      if (name !== tree.name) out.push({ treeId: tree.id, name });
    }
  }
  return out;
}
