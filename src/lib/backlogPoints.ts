import { getEffectiveParentId, type Backlog, type WorkItem } from "@/types/models";

/**
 * Points, as the app adds them up.
 *
 * An item counts as the larger of its own estimate and its children's sum. A
 * backlog does the same since it can carry an estimate of its own: the larger of
 * that and what its contents add up to.
 *
 * Items may cross backlogs — a story in "Release 4.2", its tasks in "Sprint 18"
 * — so adding each backlog's total into its parent would count those tasks
 * twice. Instead the item total over a whole subtree is taken as it always was,
 * and a sub-backlog's estimate adds only its excess over its own items: its
 * uplift. With no estimates anywhere every uplift is 0 and every total is what
 * it was before backlogs had points.
 */

type Items = Record<string, WorkItem>;
type Backlogs = Record<string, Backlog>;

/** `max(own, children)`, all the way down. Pass one memo across many calls. */
export function itemEffectivePoints(workItems: Items, id: string, memo: Map<string, number> = new Map()): number {
  const known = memo.get(id);
  if (known !== undefined) return known;
  const wi = workItems[id];
  if (!wi) return 0;
  // Held at 0 while its children are summed, so a cycle in bad data ends.
  memo.set(id, 0);
  const children = wi.childrenIds.reduce((sum, cid) => sum + itemEffectivePoints(workItems, cid, memo), 0);
  const total = Math.max(wi.points ?? 0, children);
  memo.set(id, total);
  return total;
}

/** A backlog and every backlog under it. */
function subtree(backlogId: string, backlogs: Backlogs): Set<string> {
  const ids = new Set<string>();
  const walk = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    backlogs[id]?.childrenIds.forEach(walk);
  };
  walk(backlogId);
  return ids;
}

/**
 * The items' total over a backlog's whole subtree: each item whose parent is not
 * also in the subtree, at its effective points. What a backlog's total always was.
 */
export function backlogItemsTotal(
  backlogId: string,
  treeId: string,
  workItems: Items,
  backlogs: Backlogs,
  memo: Map<string, number> = new Map(),
): number {
  const ids = subtree(backlogId, backlogs);
  let total = 0;
  for (const wi of Object.values(workItems)) {
    const at = wi.backlogAssignments[treeId];
    if (!at || !ids.has(at)) continue;
    const parentId = getEffectiveParentId(wi, treeId);
    const parent = parentId ? workItems[parentId] : undefined;
    if (parent && ids.has(parent.backlogAssignments[treeId])) continue;
    total += itemEffectivePoints(workItems, wi.id, memo);
  }
  return total;
}

export interface BacklogPoints {
  /** The backlog's own estimate, if it has one. */
  own: number | undefined;
  /** Its items over the whole subtree, as before backlogs had points. */
  itemsTotal: number;
  /** The items plus whatever sub-backlog estimates add beyond their own items. */
  contents: number;
  /** What the backlog counts as: the larger of `own` and `contents`. */
  effective: number;
}

function estimateBelow(backlogId: string, backlogs: Backlogs): boolean {
  for (const id of subtree(backlogId, backlogs)) {
    if (id !== backlogId && backlogs[id]?.points != null) return true;
  }
  return false;
}

export function backlogPoints(
  backlogId: string,
  treeId: string,
  workItems: Items,
  backlogs: Backlogs,
  memo: Map<string, number> = new Map(),
): BacklogPoints {
  const own = backlogs[backlogId]?.points ?? undefined;
  const itemsTotal = backlogItemsTotal(backlogId, treeId, workItems, backlogs, memo);
  let uplift = 0;
  // Only a subtree with an estimate somewhere below needs the walk; the rest
  // costs exactly what it did.
  if (estimateBelow(backlogId, backlogs)) {
    for (const childId of backlogs[backlogId]?.childrenIds ?? []) {
      const child = backlogPoints(childId, treeId, workItems, backlogs, memo);
      uplift += child.effective - child.itemsTotal;
    }
  }
  const contents = itemsTotal + uplift;
  return { own, itemsTotal, contents, effective: Math.max(own ?? 0, contents) };
}

/** A tree's total: its root backlogs, each at its effective points. */
export function treePoints(treeId: string, rootBacklogIds: string[], workItems: Items, backlogs: Backlogs): number {
  const memo = new Map<string, number>();
  return rootBacklogIds.reduce((sum, id) => sum + backlogPoints(id, treeId, workItems, backlogs, memo).effective, 0);
}

/** Only a whole number of zero or more is an estimate; anything else clears it. */
export function wellFormedPoints(value: number | null | undefined): number | undefined {
  return value != null && Number.isInteger(value) && value >= 0 ? value : undefined;
}

export interface BurnupTargets {
  /** Where the target line is drawn. */
  target: number;
  /** A second, dashed line where there is a second number worth seeing. */
  scopeLine: { value: number; label: string } | null;
  /** What the projected finish aims at: the work that will have to be done. */
  projectTo: number;
}

/**
 * The lines a burnup draws, given the items' total in its scope and any
 * estimate on or below the backlog it is for.
 *
 * - A backlog with its own points: the target is that estimate, and a scope
 *   line shows what its contents add up to, so overrun and unplanned work read
 *   separately. The projection aims at the higher of the two.
 * - Estimates only further down: the target includes them — work not yet broken
 *   into items — and the scope line shows the items that already exist.
 * - No estimates, a work item, or counting items: as it always was.
 */
export function burnupTargets(input: {
  metric: "points" | "count";
  itemsTotal: number;
  own?: number;
  upliftBelow?: number;
}): BurnupTargets {
  const { metric, itemsTotal } = input;
  if (metric === "count") return { target: itemsTotal, scopeLine: null, projectTo: itemsTotal };
  const contents = itemsTotal + Math.max(0, input.upliftBelow ?? 0);
  if (input.own != null) {
    return {
      target: input.own,
      scopeLine: { value: contents, label: `Scope ${contents}` },
      projectTo: Math.max(input.own, contents),
    };
  }
  if (contents !== itemsTotal) {
    return { target: contents, scopeLine: { value: itemsTotal, label: `Items ${itemsTotal}` }, projectTo: contents };
  }
  return { target: itemsTotal, scopeLine: null, projectTo: itemsTotal };
}
