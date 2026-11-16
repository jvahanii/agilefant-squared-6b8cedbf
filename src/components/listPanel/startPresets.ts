import type { Backlog, BacklogTree } from "@/types/models";
import { useAppStore } from "@/store/appStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

/**
 * Who a new organisation is for, asked under the first-item box (2026-11-16).
 * The landing page speaks to one person and to teams, but every account
 * started as "My work › Now / Later", and none of the 34 people who signed up
 * from August to mid-November shared their organisation with anyone. The
 * answer sets up a fitting start, and is written to the change history
 * ("Start chosen", details "own" or "team") so the sign-up re-check can count
 * the answers without a new table.
 */
export type StartKind = "own" | "team";

export const STARTS: Record<StartKind, { tree: string; lists: [string, string]; extras: boolean }> = {
  // What starterContent.ts creates.
  own: { tree: "My work", lists: ["Now", "Later"], extras: false },
  // The second list opens as a board, with boards and story points on.
  team: { tree: "Team", lists: ["Backlog", "This sprint"], extras: true },
};

export interface StarterShape {
  kind: StartKind;
  treeId: string;
  listIds: [string, string];
}

/**
 * Which start the organisation still has, or null once it has been changed
 * in any other way (renamed, more lists, another tree): then the question is
 * not asked, so nothing the person made is renamed.
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

/** Sets up the chosen start in place of the current one. */
export async function applyStart(kind: StartKind, shape: StarterShape, orgId: string): Promise<void> {
  if (kind === shape.kind) return;
  const app = useAppStore.getState();
  const settings = useOrgSettingsStore.getState();
  const start = STARTS[kind];
  app.renameBacklogTree(shape.treeId, start.tree);
  app.renameBacklog(shape.listIds[0], start.lists[0]);
  app.renameBacklog(shape.listIds[1], start.lists[1]);
  app.logChange({ action: "Start chosen", entityType: "organization", entityId: orgId, details: kind });
  await Promise.all([settings.setBoardsEnabled(orgId, start.extras), settings.setPointsEnabled(orgId, start.extras)]);
  app.setBacklogViewMode(shape.listIds[1], start.extras ? "board" : "list");
}
