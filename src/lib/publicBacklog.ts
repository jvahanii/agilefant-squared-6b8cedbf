/**
 * The read-only view behind a public link to a backlog tree or a backlog.
 *
 * The payload comes from get_published_backlog(), which decides what a public
 * page may show. Everything here is pure so the rules can be tested without a
 * database, and so they visibly match the ones the app itself uses:
 *
 * - Selecting a backlog shows its items *and* those of every backlog beneath it
 *   (WorkItemTreePanel's `backlogIdSet`).
 * - An item is a root when its effective parent is null or lies outside that
 *   set; otherwise it nests under its parent.
 * - Siblings are ordered by rank within their backlog, missing ranks as 0, with
 *   the id as a tie-break.
 * - Time totals are identical to the app's (lib/timeTotalsCore). An item's
 *   total arrives precomputed as `totalMinutes`, because the app counts every
 *   child — including children a link does not show, whose time must count
 *   without the children themselves ever being sent. Backlog and tree totals
 *   are sums of what the payload does carry, by the same rules.
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
  labelIds: string[];
  /** Time logged against the backlog itself, not an item in it. */
  minutes: number;
}

export interface PublishedLink {
  url: string;
  altText: string | null;
}

export interface PublishedItem {
  id: string;
  title: string;
  description: string | null;
  points: number | null;
  /** One to five stars, or null: unrated, or not published. */
  rating: number | null;
  /** Null when the link hides statuses. */
  status: string | null;
  /** Effective parent within the published tree (per-tree override applied). */
  parentId: string | null;
  backlogId: string;
  rank: number | null;
  teamIds: string[];
  labelIds: string[];
  links: PublishedLink[];
  /** The item's own logged time, excluding children — what backlog and tree
   *  totals are summed from. */
  minutes: number;
  /** The item's total including everything beneath it, exactly as the app
   *  shows it on the item's row. */
  totalMinutes: number;
}

export interface PublishedPayload {
  kind: "tree" | "backlog";
  tree: { id: string; name: string };
  /** The published backlog, or null when the whole tree is published. */
  rootBacklogId: string | null;
  // Whether each attribute is shown. The server leaves a hidden attribute out
  // of the payload altogether; these say not to render its empty remains.
  pointsVisible: boolean;
  timeVisible: boolean;
  labelsVisible: boolean;
  descriptionVisible: boolean;
  statusVisible: boolean;
  teamsVisible: boolean;
  linksVisible: boolean;
  /** Stars. False unless the organization rates its items, the link keeps
   *  ratings, and at least one backlog in view has its own switch on. */
  ratingsVisible: boolean;
  backlogs: PublishedBacklog[];
  /** Time logged against the tree itself; only a whole-tree link has any. */
  treeMinutes: number;
  /** Effective statuses per in-scope backlog, already resolved up the parent
   *  chain server-side. A missing entry means the defaults apply. */
  statusesByBacklog: Record<string, PublishedStatus[]>;
  teams: { id: string; name: string }[];
  labels: { id: string; name: string; color: string }[];
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
  return { label: item.status ?? "", color: "#94a3b8" };
}

/** The item attributes a public link can hide, in the order the link dialog
 *  offers them. Titles and structure are always shown. Keep in step with
 *  published_link_settings' CHECK constraint. */
export const PUBLISHABLE_ATTRIBUTES = [
  { key: "status", label: "Statuses" },
  { key: "description", label: "Descriptions" },
  { key: "points", label: "Points" },
  { key: "teams", label: "Teams" },
  { key: "labels", label: "Labels" },
  { key: "links", label: "Links" },
  { key: "rating", label: "Ratings" },
  { key: "time", label: "Logged time" },
] as const;

export type PublishableAttribute = (typeof PUBLISHABLE_ATTRIBUTES)[number]["key"];

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

/** Logged time for a backlog scope: time on the backlogs themselves plus each
 *  of their items' own time — the app's backlog total (lib/timeTotalsCore). */
export function scopeMinutes(payload: PublishedPayload, scope: Set<string>): number {
  let sum = 0;
  for (const b of payload.backlogs) if (scope.has(b.id)) sum += b.minutes;
  for (const i of payload.items) if (scope.has(i.backlogId)) sum += i.minutes;
  return sum;
}

/** Logged time for the whole tree: every item's own time, time on its
 *  backlogs, and time on the tree itself — the app's tree total. */
export function treeMinutes(payload: PublishedPayload): number {
  let sum = payload.treeMinutes;
  for (const b of payload.backlogs) sum += b.minutes;
  for (const i of payload.items) sum += i.minutes;
  return sum;
}

/** A run of description text: either plain, or an address worth linking. */
export interface TextSegment {
  text: string;
  /** Null for plain text, and for anything safeLinkHref() rejects. */
  href: string | null;
}

/**
 * Split text into plain runs and the addresses inside it.
 *
 * Descriptions are written by the integrations — a merged PR, a pushed commit,
 * an imported email — and are mostly a URL with a line of context. Nobody can
 * type one in the app, so this is about making what the robots wrote useful.
 *
 * Only http(s) and bare www. addresses are recognised, and each still goes
 * through safeLinkHref(), so nothing here can turn into a javascript: link.
 */
export function linkifySegments(text: string): TextSegment[] {
  // Trailing punctuation is left out of the address: sentences end in periods,
  // and a URL in parentheses should not swallow the closing one.
  const pattern = /(?:https?:\/\/|www\.)[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/gi;
  const segments: TextSegment[] = [];
  let at = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > at) segments.push({ text: text.slice(at, start), href: null });
    segments.push({ text: match[0], href: safeLinkHref(match[0]) });
    at = start + match[0].length;
  }
  if (at < text.length) segments.push({ text: text.slice(at), href: null });
  return segments;
}

/**
 * An href that is safe to put on a page anyone can open, or null.
 *
 * Hyperlinks come straight from the database, so a stored `javascript:` or
 * `data:` URL would run in a visitor's browser the moment they clicked it. Only
 * http(s) and mailto survive; a bare "www.example.com" — which people do type —
 * is treated as https. Anything else is shown as text rather than as a link.
 */
export function safeLinkHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return null;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    // A scheme-less value that doesn't parse as a real host ("not a url") is
    // not a link; require at least one dot in the hostname.
    return parsed.hostname.includes(".") ? parsed.href : null;
  }
  if (parsed.protocol === "mailto:") return parsed.href;
  return null;
}
