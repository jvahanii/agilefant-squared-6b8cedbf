/**
 * The rows of a backlog's list view: which items show, in what order, and how
 * deeply indented.
 *
 * An item's `childrenIds` is the union of its children in *every* tree — items
 * whose global parent it is, and items naming it as parent through a per-tree
 * override (see supabaseSync). That union is right for point and time
 * roll-ups, but not for display: in one tree an item belongs under exactly one
 * parent, its effective parent there (getEffectiveParentId). Walking the raw
 * union listed an item under a parent it has left in this tree — once per
 * parent, if both were expanded — and indenting by global parent then threw
 * away the depth of everything after it.
 */
import { getEffectiveParentId, type WorkItem } from "@/types/models";

/**
 * The items a backlog shows at its top level: those in view whose effective
 * parent in this tree is either none, or an item outside the backlogs in view.
 * Unordered — the caller decides the order.
 */
export function topLevelItems(
  workItems: Record<string, WorkItem>,
  treeId: string,
  backlogIdSet: ReadonlySet<string>,
): WorkItem[] {
  return Object.values(workItems).filter((wi) => {
    if (!backlogIdSet.has(wi.backlogAssignments[treeId])) return false;
    const parentId = getEffectiveParentId(wi, treeId);
    return parentId === null || !backlogIdSet.has(workItems[parentId]?.backlogAssignments[treeId]);
  });
}

/** Order within a sibling group: rank in the item's backlog, then id. */
export function byRank(treeId: string) {
  return (a: WorkItem, b: WorkItem) => {
    const diff = (a.ranks[a.backlogAssignments[treeId]] ?? 0) - (b.ranks[b.backlogAssignments[treeId]] ?? 0);
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  };
}

/** The children an item shows in this tree: those whose effective parent here
 *  is the item, and whose backlog is in view, in display order. */
export function effectiveChildren(
  itemId: string,
  workItems: Record<string, WorkItem>,
  treeId: string,
  backlogIdSet: ReadonlySet<string>,
): WorkItem[] {
  const item = workItems[itemId];
  if (!item) return [];
  const seen = new Set<string>();
  const children: WorkItem[] = [];
  for (const cid of item.childrenIds) {
    if (seen.has(cid)) continue;
    seen.add(cid);
    const child = workItems[cid];
    if (!child) continue;
    if (getEffectiveParentId(child, treeId) !== itemId) continue;
    const bl = child.backlogAssignments[treeId];
    if (!bl || !backlogIdSet.has(bl)) continue;
    children.push(child);
  }
  return children.sort(byRank(treeId));
}

export interface VisibleRows {
  /** Item ids top to bottom, each at most once. */
  ids: string[];
  /** Indentation of each row: 0 for the given roots, parent's + 1 below. */
  depths: Map<string, number>;
}

/** Depth-first rows under the given roots, descending into expanded items. */
export function buildVisibleRows(
  rootIds: readonly string[],
  expanded: ReadonlySet<string>,
  workItems: Record<string, WorkItem>,
  treeId: string,
  backlogIdSet: ReadonlySet<string>,
): VisibleRows {
  const ids: string[] = [];
  const depths = new Map<string, number>();
  // An item has one effective parent per tree, so it can only be reached once;
  // the check guards against a parent cycle in the data all the same.
  const visit = (id: string, depth: number) => {
    if (depths.has(id)) return;
    ids.push(id);
    depths.set(id, depth);
    if (!expanded.has(id)) return;
    for (const child of effectiveChildren(id, workItems, treeId, backlogIdSet)) visit(child.id, depth + 1);
  };
  for (const id of rootIds) visit(id, 0);
  return { ids, depths };
}

/** The ancestors of an item in this tree, root first, by effective parent. For
 *  the breadcrumb of an item whose parent lies outside the backlog in view. */
export function effectiveAncestors(
  itemId: string,
  workItems: Record<string, WorkItem>,
  treeId: string,
): WorkItem[] {
  const chain: WorkItem[] = [];
  const visited = new Set<string>([itemId]);
  const item = workItems[itemId];
  let pid = item ? getEffectiveParentId(item, treeId) : null;
  while (pid && !visited.has(pid)) {
    const cur = workItems[pid];
    if (!cur) break;
    visited.add(pid);
    chain.unshift(cur);
    pid = getEffectiveParentId(cur, treeId);
  }
  return chain;
}
