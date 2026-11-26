import type { Backlog, BacklogTree } from "@/types/models";

/**
 * The two starts a new organisation may have. "Who is it for? Just me / A
 * team" was asked under the first-item box from 2026-11-16 and set up one or
 * the other; it was dropped on 2026-11-26 as a question nobody needed, and
 * every account now starts as "own" (starterContent.ts). Organisations that
 * chose "team" meanwhile keep it, so both are still recognised: an untouched
 * start is where a public list copied at sign-up replaces it
 * (hooks/usePublishedListCopies.ts).
 */
export type StartKind = "own" | "team";

export const STARTS: Record<StartKind, { tree: string; lists: [string, string] }> = {
  // What starterContent.ts creates.
  own: { tree: "My work", lists: ["Now", "Later"] },
  // What choosing "A team" made of it.
  team: { tree: "Team", lists: ["Backlog", "This sprint"] },
};

export interface StarterShape {
  kind: StartKind;
  treeId: string;
  listIds: [string, string];
}

/**
 * Which start the organisation still has, or null once it has been changed
 * in any other way (renamed, more lists, another tree), so nothing the person
 * made is replaced.
 */
export function starterShape(trees: Record<string, BacklogTree>, backlogs: Record<string, Backlog>): StarterShape | null {
  const all = Object.values(trees);
  if (all.length !== 1 || Object.keys(backlogs).length !== 2) return null;
  const [tree] = all;
  if (tree.rootBacklogIds.length !== 2) return null;
  const lists = tree.rootBacklogIds.map((id) => backlogs[id]);
  if (lists.some((b) => !b || b.childrenIds.length > 0)) return null;
  for (const kind of ["own", "team"] as const) {
    const start = STARTS[kind];
    if (tree.name === start.tree && lists[0].name === start.lists[0] && lists[1].name === start.lists[1]) {
      return { kind, treeId: tree.id, listIds: [lists[0].id, lists[1].id] };
    }
  }
  return null;
}
