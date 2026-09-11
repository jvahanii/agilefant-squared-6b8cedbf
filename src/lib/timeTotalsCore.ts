/**
 * The time-totals rules, as a pure function.
 *
 * lib/timeTotals caches these per store snapshot for the app. They live here,
 * free of any store, so the same rules can be checked against the totals a
 * public link shows — get_published_backlog() computes those in SQL, and the two
 * must never disagree.
 *
 * - An item's total is its own entries plus the totals of everything in its
 *   `childrenIds`, which holds both its global children and any item naming it
 *   as parent through a per-tree override.
 * - A backlog's total, per tree, is time logged on the backlog itself plus the
 *   *own* time of each item assigned to it in that tree, through every backlog
 *   beneath it.
 * - A tree's total is every entry on an item assigned to it, plus time logged on
 *   its backlogs and on the tree itself.
 */
import type { TimeEntry } from '@/store/timeEntryStore';
import type { Backlog, WorkItem } from '@/types/models';

export interface TimeTotals {
  wi: Map<string, number>;
  bl: Map<string, number>; // key = `${treeId}::${backlogId}`
  tree: Map<string, number>;
}

export function computeTimeTotals(
  entries: Record<string, TimeEntry>,
  workItems: Record<string, WorkItem>,
  backlogs: Record<string, Backlog>,
): TimeTotals {
  const selfWi = new Map<string, number>();
  const selfBl = new Map<string, number>(); // key = backlogId
  const treeTotals = new Map<string, number>();

  // Group backlogs by tree once.
  const backlogsByTree = new Map<string, string[]>();
  for (const b of Object.values(backlogs)) {
    let arr = backlogsByTree.get(b.treeId);
    if (!arr) { arr = []; backlogsByTree.set(b.treeId, arr); }
    arr.push(b.id);
  }

  for (const e of Object.values(entries)) {
    const dur = e.durationMinutes;
    if (e.workItemId) {
      selfWi.set(e.workItemId, (selfWi.get(e.workItemId) ?? 0) + dur);
      // Roll up to work item's tree assignment(s).
      const wi = workItems[e.workItemId];
      if (wi?.backlogAssignments) {
        for (const treeId of Object.keys(wi.backlogAssignments)) {
          treeTotals.set(treeId, (treeTotals.get(treeId) ?? 0) + dur);
        }
      }
    } else if (e.backlogId) {
      selfBl.set(e.backlogId, (selfBl.get(e.backlogId) ?? 0) + dur);
      const bl = backlogs[e.backlogId];
      if (bl) treeTotals.set(bl.treeId, (treeTotals.get(bl.treeId) ?? 0) + dur);
    } else if (e.treeId) {
      treeTotals.set(e.treeId, (treeTotals.get(e.treeId) ?? 0) + dur);
    }
  }

  // Work-item subtree totals via memoized DFS.
  const wiTotals = new Map<string, number>();
  const visiting = new Set<string>();
  const wiSubtree = (id: string): number => {
    const cached = wiTotals.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // guard against pathological cycles
    visiting.add(id);
    const item = workItems[id];
    let sum = selfWi.get(id) ?? 0;
    if (item?.childrenIds) {
      for (const cid of item.childrenIds) sum += wiSubtree(cid);
    }
    visiting.delete(id);
    wiTotals.set(id, sum);
    return sum;
  };
  for (const id of Object.keys(workItems)) wiSubtree(id);

  // Backlog subtree totals via memoized DFS, keyed by `${treeId}::${backlogId}`.
  // "Self" for a backlog = direct backlog entries + workItem-subtree totals for
  // work items whose backlogAssignments[treeId] === this backlog.
  const wiByBacklog = new Map<string, string[]>(); // key = `${treeId}::${backlogId}` → root work items assigned there
  for (const wi of Object.values(workItems)) {
    if (!wi.backlogAssignments) continue;
    for (const [treeId, bId] of Object.entries(wi.backlogAssignments)) {
      const k = `${treeId}::${bId}`;
      let arr = wiByBacklog.get(k);
      if (!arr) { arr = []; wiByBacklog.set(k, arr); }
      arr.push(wi.id);
    }
  }

  const blTotals = new Map<string, number>();
  const blVisiting = new Set<string>();
  const blSubtree = (backlogId: string, treeId: string): number => {
    const key = `${treeId}::${backlogId}`;
    const cached = blTotals.get(key);
    if (cached !== undefined) return cached;
    if (blVisiting.has(key)) return 0;
    blVisiting.add(key);
    const bl = backlogs[backlogId];
    let sum = selfBl.get(backlogId) ?? 0;
    // Include work items directly assigned to this backlog in this tree.
    // Note: only count each work-item entry once per tree — we sum entry
    // durations directly to avoid double-counting nested assignments.
    const assigned = wiByBacklog.get(key);
    if (assigned) {
      for (const wid of assigned) {
        // Sum entries for the item's subtree, but restrict to entries where the
        // owner item's assignment (in this tree) is still under this backlog's
        // subtree. Simplification: use direct self totals of the item; nested
        // items are visited by their own backlog assignments.
        sum += selfWi.get(wid) ?? 0;
      }
    }
    if (bl?.childrenIds) {
      for (const cid of bl.childrenIds) sum += blSubtree(cid, treeId);
    }
    blVisiting.delete(key);
    blTotals.set(key, sum);
    return sum;
  };
  for (const b of Object.values(backlogs)) blSubtree(b.id, b.treeId);

  return { wi: wiTotals, bl: blTotals, tree: treeTotals };
}
