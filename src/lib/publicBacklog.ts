/**
 * The read-only view behind a public link to a backlog tree or a backlog.
 *
 * The payload comes from get_published_backlog(), which returns only what a
 * public page may show — no people, time, labels, links or money. Everything
 * here is pure so the hierarchy rules can be tested without a database, and so
 * they visibly match the ones the app itself uses in WorkItemTreePanel:
 *
 * - Selecting a backlog shows its items *and* those of every backlog beneath it
 *   (the app's `backlogIdSet`).
 * - An item is a root when its effective parent is null or lies outside that
 *   set; otherwise it nests under its parent.
 * - Siblings are ordered by rank within their backlog, missing ranks as 0, with
 *   the id as a tie-break.
 */
import { DEFAULT_STATUSES } from "@/store/backlogStatusesStore";

export interface PublishedStatus {
  key: string;
  label: string;
  color: string;
  rank: number;
}

export interface PublishedBacklog {
  id: string;
  name: string;
  parentId: string | null;
  rank: number;
}

export interface PublishedItem {
  id: string;
  title: string;
  description: string | null;
  points: number | null;
  status: string;
  /** Effective parent within the published tree (per-tree override applied). */
  parentId: string | null;
  backlogId: string;
  rank: number | null;
}

export interface PublishedPayload {
  kind: "tree" | "backlog";
  tree: { id: string; name: string };
  /** The published backlog, or null when the whole tree is published. */
  rootBacklogId: string | null;
  pointsVisible: boolean;
  backlogs: PublishedBacklog[];
  /** Effective statuses per in-scope backlog, already resolved up the parent
   *  chain server-side. A missing entry means the defaults apply. */
  statusesByBacklog: Record<string, PublishedStatus[]>;
  items: PublishedItem[];
}

export interface BacklogNode {
  backlog: PublishedBacklog;
  children: BacklogNode[];
}

export interface ItemNode {
  item: PublishedItem;
  children: ItemNode[];
}

const byRankThenId = <T extends { id: string }>(rankOf: (x: T) => number) => (a: T, b: T) => {
  const diff = rankOf(a) - rankOf(b);
  return diff !== 0 ? diff : a.id.localeCompare(b.id);
};

/** The backlog hierarchy to navigate. For a tree link that is every root
 *  backlog; for a backlog link, the published backlog alone at the top. */
export function buildBacklogTree(payload: PublishedPayload): BacklogNode[] {
  const byParent = new Map<string | null, PublishedBacklog[]>();
  const ids = new Set(payload.backlogs.map((b) => b.id));
  for (const b of payload.backlogs) {
    // A parent outside the payload makes this a root of what is visible.
    const parent = b.parentId && ids.has(b.parentId) ? b.parentId : null;
    const list = byParent.get(parent) ?? [];
    list.push(b);
    byParent.set(parent, list);
  }

  const build = (b: PublishedBacklog, seen: Set<string>): BacklogNode => {
    seen.add(b.id);
    const children = (byParent.get(b.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort(byRankThenId((c) => c.rank))
      .map((c) => build(c, seen));
    return { backlog: b, children };
  };

  const seen = new Set<string>();
  if (payload.rootBacklogId) {
    const root = payload.backlogs.find((b) => b.id === payload.rootBacklogId);
    return root ? [build(root, seen)] : [];
  }
  return (byParent.get(null) ?? []).sort(byRankThenId((b) => b.rank)).map((b) => build(b, seen));
}

/** A backlog plus every backlog beneath it — what selecting it shows. */
export function backlogScope(backlogId: string, backlogs: PublishedBacklog[]): Set<string> {
  const children = new Map<string, string[]>();
  for (const b of backlogs) {
    if (!b.parentId) continue;
    const list = children.get(b.parentId) ?? [];
    list.push(b.id);
    children.set(b.parentId, list);
  }
  const scope = new Set<string>();
  const collect = (id: string) => {
    if (scope.has(id)) return;
    scope.add(id);
    (children.get(id) ?? []).forEach(collect);
  };
  collect(backlogId);
  return scope;
}

/** The items shown for a backlog scope, nested the way the app nests them. */
export function buildItemTree(items: PublishedItem[], scope: Set<string>): ItemNode[] {
  const inScope = items.filter((i) => scope.has(i.backlogId));
  const ids = new Set(inScope.map((i) => i.id));
  const byParent = new Map<string, PublishedItem[]>();
  const roots: PublishedItem[] = [];
  for (const item of inScope) {
    if (item.parentId && ids.has(item.parentId)) {
      const list = byParent.get(item.parentId) ?? [];
      list.push(item);
      byParent.set(item.parentId, list);
    } else {
      roots.push(item);
    }
  }

  const order = byRankThenId<PublishedItem>((i) => i.rank ?? 0);
  // `seen` guards against a parent cycle in the data turning into infinite
  // recursion on a page anyone on the internet can open.
  const build = (item: PublishedItem, seen: Set<string>): ItemNode => {
    seen.add(item.id);
    const children = (byParent.get(item.id) ?? [])
      .filter((c) => !seen.has(c.id))
      .sort(order)
      .map((c) => build(c, seen));
    return { item, children };
  };

  const seen = new Set<string>();
  return roots.sort(order).map((r) => build(r, seen));
}

/** The label and colour for an item's status, resolved the way the app does. */
export function statusFor(
  item: PublishedItem,
  statusesByBacklog: Record<string, PublishedStatus[]>,
): { label: string; color: string } {
  const own = statusesByBacklog[item.backlogId]?.find((s) => s.key === item.status);
  if (own) return { label: own.label, color: own.color };
  const fallback = DEFAULT_STATUSES.find((s) => s.key === item.status);
  if (fallback) return { label: fallback.label, color: fallback.color };
  // A custom key whose status set has since changed: show the key rather than
  // nothing, in a neutral colour.
  return { label: item.status, color: "#94a3b8" };
}

/** Sum of points over an item forest, for backlog totals. */
export function totalPoints(nodes: ItemNode[]): number {
  let sum = 0;
  const walk = (n: ItemNode) => {
    sum += n.item.points ?? 0;
    n.children.forEach(walk);
  };
  nodes.forEach(walk);
  return sum;
}
