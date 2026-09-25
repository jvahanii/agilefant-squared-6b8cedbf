import { childrenInTree } from "@/lib/backlogPoints";
import type { WorkItem } from "@/types/models";

/*
 * The arithmetic behind a burnup, apart from the chart so it can be tested.
 *
 * Every walk goes through childrenInTree: an item can have a different parent
 * in each tree, is listed under all of them, and was counted under each — a
 * backlog showed a scope of 283 points for items worth 232.
 */

/** Effective points of a (sub)branch: max(own points, sum of in-scope children). */
export function effectivePointsInScope(
  workItems: Record<string, WorkItem>,
  id: string,
  scopeSet: Set<string>,
  memo: Map<string, number>,
  treeId?: string,
): number {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  const wi = workItems[id];
  if (!wi) {
    memo.set(id, 0);
    return 0;
  }
  const own = wi.points ?? 0;
  let childSum = 0;
  for (const cid of childrenInTree(workItems, id, treeId)) {
    if (!scopeSet.has(cid)) continue;
    childSum += effectivePointsInScope(workItems, cid, scopeSet, memo, treeId);
  }
  const total = Math.max(own, childSum);
  memo.set(id, total);
  return total;
}

/**
 * Distributes a branch's effective points across status buckets for a single
 * day. A rolled-up parent (its own points >= children sum) contributes the
 * leftover to its own status; when the parent is "done", the whole branch is
 * credited as done. This mirrors the list-view effective/completed points so
 * parent points never double-count their children.
 */
export function statusBreakdown(
  workItems: Record<string, WorkItem>,
  id: string,
  scopeSet: Set<string>,
  dayState: Map<string, { status: string; points: number }>,
  statusKeys: string[],
  seen: Set<string>,
  treeId?: string,
): Record<string, number> {
  if (seen.has(id)) return {};
  seen.add(id);
  const wi = workItems[id];
  if (!wi) return {};

  const live = dayState.get(id);
  let status = live?.status ?? wi.status;
  if (!statusKeys.includes(status)) status = "not_started";
  const ownPoints = live ? (live.points ?? 0) : (wi.points ?? 0);

  const children = childrenInTree(workItems, id, treeId);
  if (children.length === 0) {
    return { [status]: ownPoints };
  }

  const childBreak: Record<string, number> = {};
  for (const cid of children) {
    if (!scopeSet.has(cid)) continue;
    const sub = statusBreakdown(workItems, cid, scopeSet, dayState, statusKeys, seen, treeId);
    for (const [k, v] of Object.entries(sub)) {
      childBreak[k] = (childBreak[k] ?? 0) + v;
    }
  }
  const childSum = Object.values(childBreak).reduce((a, b) => a + b, 0);

  if (status === "done") {
    return { done: Math.max(ownPoints, childSum) };
  }

  const leftover = Math.max(0, ownPoints - childSum);
  if (leftover > 0) {
    childBreak[status] = (childBreak[status] ?? 0) + leftover;
  }
  return childBreak;
}

/**
 * The chart's rows, carried on to the day the projection ends so its dashed
 * line has somewhere to land. The added days carry their date and nothing else:
 * copying today's figures onto them drew history that had not happened, and the
 * tooltip read it back as if it had.
 */
export function extendToDate<Row extends Record<string, unknown>>(rows: Row[], endDate: string): (Row | { date: string })[] {
  if (rows.length === 0) return rows;
  const last = rows[rows.length - 1];
  const lastTime = new Date(`${last.date as string}T00:00:00Z`).getTime();
  const endTime = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!(endTime > lastTime)) return rows;
  const out: (Row | { date: string })[] = [...rows];
  const cursor = new Date(lastTime);
  for (;;) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (cursor.getTime() > endTime) break;
    out.push({ date: cursor.toISOString().slice(0, 10) });
  }
  return out;
}
