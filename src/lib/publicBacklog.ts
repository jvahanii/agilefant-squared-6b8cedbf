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
  /** yyyy-mm-dd, or null: none, or not published. */
  deadline?: string | null;
  /** The day it was made, yyyy-mm-dd, or null: never recorded, or not
   *  published. */
  createdOn?: string | null;
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
  /** Deadlines. False unless the organization uses them and the link keeps
   *  them. Absent from pages served before deadlines existed. */
  deadlinesVisible?: boolean;
  /** Created dates. False unless the organization shows them and the link
   *  keeps them. Absent from pages served before they existed. */
  createdDatesVisible?: boolean;
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

/**
 * How a visitor has asked for the list to be ordered, or null for the order
 * the list's owner gave it. A view of the page only: nothing is saved, and the
 * next visitor sees the owner's order again.
 */
export type PublicSort = { by: "deadline" | "created"; direction: "asc" | "desc" } | null;

/**
 * What a click on a column heading asks for next. The first click gives the
 * order most likely wanted — deadlines soonest first, created dates newest
 * first — the second reverses it, and the third goes back to the owner's
 * order. Clicking the other heading starts that one's cycle afresh.
 */
export function nextPublicSort(current: PublicSort, by: "deadline" | "created"): PublicSort {
  const first = by === "deadline" ? "asc" : "desc";
  if (!current || current.by !== by) return { by, direction: first };
  if (current.direction === first) return { by, direction: first === "asc" ? "desc" : "asc" };
  return null;
}

/**
 * The list in the order asked for. Only the top level is reordered — children
 * stay under their parent in the owner's order, as they do in the app's own
 * sorted lists. Items without the date come last in either direction: having
 * no deadline is not "latest", and having no recorded created date is not
 * "oldest". Ties keep the owner's order.
 */
export function sortItemNodes(nodes: ItemNode[], sort: PublicSort): ItemNode[] {
  if (!sort) return nodes;
  const dateOf = (n: ItemNode) => (sort.by === "deadline" ? n.item.deadline : n.item.createdOn) ?? null;
  const sign = sort.direction === "asc" ? 1 : -1;
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const x = dateOf(a.node);
      const y = dateOf(b.node);
      if (x === null || y === null) return x === y ? a.index - b.index : x === null ? 1 : -1;
      return x === y ? a.index - b.index : (x < y ? -1 : 1) * sign;
    })
    .map(({ node }) => node);
}

/** Whether a row must contain any one of the filter's strings, or every one. */
export type FilterMatch = "any" | "all";

/**
 * The strings a visitor typed into the filter box, ready to compare: split on
 * spaces and commas, lower-cased, empties dropped. Each is looked for on its
 * own, so "helsinki espoo" asks for rows mentioning either.
 */
export function filterTerms(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[\s,]+/).filter(Boolean))];
}

/**
 * Everything a row shows that a visitor could be looking for, per item, lower-
 * cased: its title, its description, the labels and addresses of its links,
 * and the names of its status, teams and labels. Only what the link publishes
 * is in the payload at all, so nothing hidden can be found by searching.
 */
export function buildSearchIndex(payload: PublishedPayload): Map<string, string> {
  const teams = new Map(payload.teams.map((t) => [t.id, t.name]));
  const labels = new Map(payload.labels.map((l) => [l.id, l.name]));
  const index = new Map<string, string>();
  for (const item of payload.items) {
    const parts = [
      item.title,
      item.description ?? "",
      ...item.links.flatMap((link) => [link.altText ?? "", link.url]),
      ...item.teamIds.map((id) => teams.get(id) ?? ""),
      ...item.labelIds.map((id) => labels.get(id) ?? ""),
      item.status != null ? statusFor(item, payload.statusesByBacklog).label : "",
    ];
    index.set(item.id, parts.join("\n").toLowerCase());
  }
  return index;
}

/**
 * The rows the filter keeps: those containing any one of the strings, or —
 * when the visitor asks for all — every one of them. Either way a string
 * counts wherever it appears, as part of a longer word too. A row that does
 * not qualify is dropped — unless something beneath it does, in which case it stays as
 * the way down to that match: a match shown without its parents would have
 * lost its place in the list. `matched` is how many rows matched in their
 * own right, which is what a "showing N of M" line should count.
 */
export function filterItemNodes(
  nodes: ItemNode[],
  terms: string[],
  index: Map<string, string>,
  match: FilterMatch = "any",
): { nodes: ItemNode[]; matched: number } {
  if (terms.length === 0) return { nodes, matched: countItemNodes(nodes) };
  let matched = 0;
  const keep = (list: ItemNode[]): ItemNode[] => {
    const out: ItemNode[] = [];
    for (const node of list) {
      const text = index.get(node.item.id) ?? node.item.title.toLowerCase();
      // "All" is asked of the row itself: its strings may not be shared out
      // between it and the rows above or below it.
      const own =
        match === "all" ? terms.every((term) => text.includes(term)) : terms.some((term) => text.includes(term));
      const children = keep(node.children);
      if (own) matched++;
      if (own || children.length > 0) out.push({ item: node.item, children });
    }
    return out;
  };
  return { nodes: keep(nodes), matched };
}

/**
 * A text cut into the stretches that match one of the filter's strings and the
 * stretches between them, in order, so the matches can be marked. Matching
 * ignores case; the pieces keep the text's own. Matches that touch or overlap
 * — "hel" and "sinki" in "Helsinki" — come out as one stretch.
 */
export function highlightSegments(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const active = terms.filter(Boolean);
  if (!text || active.length === 0) return text ? [{ text, hit: false }] : [];
  const lower = text.toLowerCase();
  const ranges: [number, number][] = [];
  for (const term of active) {
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + 1)) {
      ranges.push([at, at + term.length]);
    }
  }
  if (ranges.length === 0) return [{ text, hit: false }];
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([range[0], range[1]]);
  }
  const out: { text: string; hit: boolean }[] = [];
  let cursor = 0;
  for (const [from, to] of merged) {
    if (from > cursor) out.push({ text: text.slice(cursor, from), hit: false });
    out.push({ text: text.slice(from, to), hit: true });
    cursor = to;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), hit: false });
  return out;
}

/** Every row in a list, at every depth. */
export function countItemNodes(nodes: ItemNode[]): number {
  return nodes.reduce((sum, node) => sum + 1 + countItemNodes(node.children), 0);
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
  { key: "deadline", label: "Deadlines" },
  { key: "created", label: "Created dates" },
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
