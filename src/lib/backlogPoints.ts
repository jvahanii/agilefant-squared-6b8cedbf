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

/**
 * An item's children as one tree sees them.
 *
 * childrenIds lists an item under its default parent and under every parent it
 * has in a particular tree, so a walk over it counts such an item twice when
 * both parents are in view — which is how a burnup came to show 283 points for
 * items worth 232. In a tree, a child belongs to the parent getEffectiveParentId
 * names there; with no tree given, to its default parent.
 */
export function childrenInTree(workItems: Items, id: string, treeId?: string): string[] {
  const wi = workItems[id];
  if (!wi) return [];
  return wi.childrenIds.filter((cid) => {
    const child = workItems[cid];
    if (!child) return false;
    return (treeId ? getEffectiveParentId(child, treeId) : child.parentId) === id;
  });
}

/**
 * `max(own, children)`, all the way down, with the children the tree sees.
 * Pass one memo across many calls in the same tree.
 */
export function itemEffectivePoints(
  workItems: Items,
  id: string,
  memo: Map<string, number> = new Map(),
  treeId?: string,
): number {
  const known = memo.get(id);
  if (known !== undefined) return known;
  const wi = workItems[id];
  if (!wi) return 0;
  // Held at 0 while its children are summed, so a cycle in bad data ends.
  memo.set(id, 0);
  const children = childrenInTree(workItems, id, treeId).reduce(
    (sum, cid) => sum + itemEffectivePoints(workItems, cid, memo, treeId),
    0,
  );
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
    total += itemEffectivePoints(workItems, wi.id, memo, treeId);
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

/**
 * Every backlog's points at once, for a panel that shows them all: what
 * backlogPoints gives each, from one pass over the items rather than one per
 * backlog. The panel used to make 52 passes over 5 000 items after every
 * change, and a move out of a long list stalled on them.
 *
 * Same rules: an item counts in every backlog whose subtree holds its list in
 * the backlog's tree, unless its parent there sits inside that subtree too.
 * "Subtree" goes down childrenIds, as subtree() does, so the backlogs a list
 * is under are those it can be reached from.
 */
export function allBacklogPoints(workItems: Items, backlogs: Backlogs): Map<string, BacklogPoints> {
  // Who lists each backlog among its children.
  const parentsOf = new Map<string, string[]>();
  for (const b of Object.values(backlogs)) {
    for (const c of b.childrenIds) {
      const list = parentsOf.get(c);
      if (list) list.push(b.id);
      else parentsOf.set(c, [b.id]);
    }
  }
  // A backlog and every backlog whose subtree holds it.
  const above = new Map<string, Set<string>>();
  const aboveOf = (id: string): Set<string> => {
    const known = above.get(id);
    if (known) return known;
    const ids = new Set<string>();
    const walk = (x: string) => {
      if (ids.has(x)) return;
      ids.add(x);
      parentsOf.get(x)?.forEach(walk);
    };
    walk(id);
    above.set(id, ids);
    return ids;
  };

  const itemsTotal = new Map<string, number>();
  const memoByTree = new Map<string, Map<string, number>>();
  for (const wi of Object.values(workItems)) {
    for (const [treeId, at] of Object.entries(wi.backlogAssignments)) {
      if (!at) continue;
      const parentId = getEffectiveParentId(wi, treeId);
      const parentAt = parentId ? workItems[parentId]?.backlogAssignments[treeId] : undefined;
      const parentAbove = parentAt ? aboveOf(parentAt) : undefined;
      let points: number | undefined;
      for (const b of aboveOf(at)) {
        // Counted by a backlog only through its own tree's assignment.
        if (backlogs[b]?.treeId !== treeId) continue;
        if (parentAbove?.has(b)) continue;
        if (points === undefined) {
          let memo = memoByTree.get(treeId);
          if (!memo) memoByTree.set(treeId, (memo = new Map()));
          points = itemEffectivePoints(workItems, wi.id, memo, treeId);
        }
        itemsTotal.set(b, (itemsTotal.get(b) ?? 0) + points);
      }
    }
  }

  const result = new Map<string, BacklogPoints>();
  const pointsOf = (id: string): BacklogPoints => {
    const known = result.get(id);
    if (known) return known;
    const own = backlogs[id]?.points ?? undefined;
    const total = itemsTotal.get(id) ?? 0;
    let uplift = 0;
    if (estimateBelow(id, backlogs)) {
      for (const childId of backlogs[id]?.childrenIds ?? []) {
        const child = pointsOf(childId);
        uplift += child.effective - child.itemsTotal;
      }
    }
    const contents = total + uplift;
    const points = { own, itemsTotal: total, contents, effective: Math.max(own ?? 0, contents) };
    result.set(id, points);
    return points;
  };
  Object.keys(backlogs).forEach(pointsOf);
  return result;
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
