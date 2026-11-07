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

/**
 * The rows Tab and Shift+Tab go by: "the item above" is the row above on
 * screen, so it is the timeline's rows while the timeline is shown and the
 * list's otherwise.
 *
 * The two differ. The timeline opens every branch and can leave undated rows
 * out, so a row it shows may be folded away in the list, and the row above an
 * item there is often not the row above it here.
 */
export function rowsForReparenting(
  showingTimeline: boolean,
  listRows: readonly string[],
  timelineRows: readonly string[],
): readonly string[] {
  return showingTimeline ? timelineRows : listRows;
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

/**
 * Where Tab puts each selected row: under its previous sibling, at the end of
 * that sibling's children — as in any outliner.
 *
 * It used to be under whatever row was just above. Above an item, under an
 * open sibling, is that sibling's last child — or a grandchild — so the item
 * went a level or more too deep: indenting the next item of a list under the
 * one before it, to go on adding to it, was what failed.
 *
 * The previous sibling is the nearest row above at the same depth, passing
 * deeper rows (its children) and other selected rows (they are indented
 * alongside, under the same sibling). A shallower row first means there is
 * none: the item is its parent's first child and stays where it is. Depth is
 * counted among the rows shown, so an item whose parent is not shown counts as
 * a top row, as it is drawn.
 *
 * Only the topmost selected rows are planned; a selected row under another
 * selected row moves with it. Returns the new parent of each row that moves.
 */
export function indentTargets(
  rows: readonly string[],
  selected: ReadonlySet<string>,
  parentOf: (id: string) => string | null,
): Map<string, string> {
  const shown = new Set(rows);
  const depthOf = new Map<string, number>();
  const depth = (id: string): number => {
    const known = depthOf.get(id);
    if (known !== undefined) return known;
    let d = 0;
    for (let p = parentOf(id), guard = 0; p && shown.has(p) && guard < 100; p = parentOf(p), guard++) d++;
    depthOf.set(id, d);
    return d;
  };
  const underSelected = (id: string) => {
    for (let p = parentOf(id), guard = 0; p && guard < 100; p = parentOf(p), guard++) if (selected.has(p)) return true;
    return false;
  };
  const targets = new Map<string, string>();
  rows.forEach((id, idx) => {
    if (!selected.has(id) || underSelected(id)) return;
    const mine = depth(id);
    for (let i = idx - 1; i >= 0; i--) {
      const d = depth(rows[i]);
      if (d < mine) return;
      if (d === mine && !selected.has(rows[i])) {
        targets.set(id, rows[i]);
        return;
      }
    }
  });
  return targets;
}
