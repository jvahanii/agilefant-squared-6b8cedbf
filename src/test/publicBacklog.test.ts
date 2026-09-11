/**
 * The public page has to show a backlog exactly as the app does, or a published
 * link quietly misrepresents someone's work. These pin the rules that
 * WorkItemTreePanel and lib/timeTotals use: descendant backlogs roll up into
 * their parent, an item whose parent lies outside the shown scope becomes a
 * root, siblings order by rank with the id as tie-break, and time totals roll up
 * through children. They also pin the one security rule the page owns: a
 * stored hyperlink only becomes a clickable link if it is http(s) or mailto.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  backlogScope,
  buildBacklogTree,
  buildItemTree,
  safeLinkHref,
  scopeMinutes,
  statusFor,
  subtreeMinutes,
  totalPoints,
  type PublishedBacklog,
  type PublishedItem,
  type PublishedPayload,
} from "@/lib/publicBacklog";

const bl = (id: string, parentId: string | null, rank = 0, extra: Partial<PublishedBacklog> = {}): PublishedBacklog => ({
  id,
  name: id,
  parentId,
  rank,
  labelIds: [],
  minutes: 0,
  ...extra,
});

const item = (
  id: string,
  backlogId: string,
  parentId: string | null = null,
  rank: number | null = null,
  extra: Partial<PublishedItem> = {},
): PublishedItem => ({
  id,
  title: id,
  description: null,
  points: null,
  status: "not_started",
  parentId,
  backlogId,
  rank,
  teamIds: [],
  labelIds: [],
  links: [],
  minutes: 0,
  ...extra,
});

const payload = (over: Partial<PublishedPayload>): PublishedPayload => ({
  kind: "tree",
  tree: { id: "t", name: "Tree" },
  rootBacklogId: null,
  pointsVisible: false,
  timeVisible: false,
  labelsVisible: false,
  backlogs: [],
  treeMinutes: 0,
  statusesByBacklog: {},
  teams: [],
  labels: [],
  items: [],
  ...over,
});

const ids = (nodes: { item: PublishedItem; children: unknown[] }[]): string[] => nodes.map((n) => n.item.id);

describe("backlogScope", () => {
  it("includes every descendant backlog, as selecting a parent does in the app", () => {
    const backlogs = [bl("a", null), bl("b", "a"), bl("c", "b"), bl("d", null)];
    expect([...backlogScope("a", backlogs)].sort()).toEqual(["a", "b", "c"]);
    expect([...backlogScope("b", backlogs)].sort()).toEqual(["b", "c"]);
  });

  it("survives a parent cycle in the data", () => {
    const backlogs = [bl("a", "b"), bl("b", "a")];
    expect([...backlogScope("a", backlogs)].sort()).toEqual(["a", "b"]);
  });
});

describe("buildItemTree", () => {
  it("nests children under a parent in scope", () => {
    const tree = buildItemTree([item("p", "a"), item("c", "a", "p")], new Set(["a"]));
    expect(ids(tree)).toEqual(["p"]);
    expect(ids(tree[0].children as never)).toEqual(["c"]);
  });

  it("makes an item a root when its parent lies outside the scope", () => {
    // The parent sits in a sibling backlog that is not shown.
    const items = [item("p", "other"), item("c", "a", "p")];
    expect(ids(buildItemTree(items, new Set(["a"])))).toEqual(["c"]);
  });

  it("nests across backlogs that are both in scope", () => {
    const items = [item("p", "a"), item("c", "child-of-a", "p")];
    const tree = buildItemTree(items, new Set(["a", "child-of-a"]));
    expect(ids(tree)).toEqual(["p"]);
    expect(ids(tree[0].children as never)).toEqual(["c"]);
  });

  it("orders siblings by rank, missing ranks as 0, then by id", () => {
    const items = [item("z", "a", null, 2), item("y", "a", null, null), item("x", "a", null, 0), item("w", "a", null, 1)];
    expect(ids(buildItemTree(items, new Set(["a"])))).toEqual(["x", "y", "w", "z"]);
  });

  it("leaves out items assigned to backlogs outside the scope", () => {
    expect(ids(buildItemTree([item("in", "a"), item("out", "b")], new Set(["a"])))).toEqual(["in"]);
  });

  it("does not recurse forever on a parent cycle", () => {
    // Neither is a root by the parent rule, so nothing renders — rather than
    // hanging a page that anyone can open.
    const items = [item("a1", "a", "a2"), item("a2", "a", "a1")];
    expect(buildItemTree(items, new Set(["a"]))).toEqual([]);
  });
});

describe("buildBacklogTree", () => {
  it("returns every root backlog of a published tree, ordered by rank", () => {
    const tree = buildBacklogTree(payload({ backlogs: [bl("b2", null, 2), bl("b1", null, 1), bl("c", "b1")] }));
    expect(tree.map((n) => n.backlog.id)).toEqual(["b1", "b2"]);
    expect(tree[0].children.map((n) => n.backlog.id)).toEqual(["c"]);
  });

  it("puts only the published backlog at the top of a backlog link", () => {
    const tree = buildBacklogTree(
      payload({ kind: "backlog", rootBacklogId: "b", backlogs: [bl("b", "hidden-parent"), bl("c", "b")] }),
    );
    expect(tree.map((n) => n.backlog.id)).toEqual(["b"]);
    expect(tree[0].children.map((n) => n.backlog.id)).toEqual(["c"]);
  });
});

describe("statusFor", () => {
  it("uses the backlog's own status set", () => {
    const statuses = { a: [{ key: "review", label: "In review", color: "#abcdef", rank: 1 }] };
    expect(statusFor(item("i", "a", null, null, { status: "review" }), statuses)).toEqual({
      label: "In review",
      color: "#abcdef",
    });
  });

  it("falls back to the default statuses", () => {
    expect(statusFor(item("i", "a", null, null, { status: "done" }), {}).label).toBe("Done");
  });

  it("shows an unknown key rather than nothing", () => {
    expect(statusFor(item("i", "a", null, null, { status: "gone" }), {}).label).toBe("gone");
  });
});

describe("totalPoints", () => {
  it("sums nested items and treats missing points as zero", () => {
    const tree = buildItemTree(
      [item("p", "a", null, null, { points: 3 }), item("c", "a", "p", null, { points: 2 }), item("n", "a")],
      new Set(["a"]),
    );
    expect(totalPoints(tree)).toBe(5);
  });
});

describe("subtreeMinutes", () => {
  it("rolls each item's time up through its children, as the app does", () => {
    const tree = buildItemTree(
      [
        item("p", "a", null, null, { minutes: 30 }),
        item("c", "a", "p", null, { minutes: 15 }),
        item("g", "a", "c", null, { minutes: 5 }),
      ],
      new Set(["a"]),
    );
    const totals = subtreeMinutes(tree);
    expect(totals.get("p")).toBe(50);
    expect(totals.get("c")).toBe(20);
    expect(totals.get("g")).toBe(5);
  });

  it("does not count children the link does not show", () => {
    // The child sits in a backlog outside the scope, so it is not displayed
    // and must not inflate its parent's public total.
    const tree = buildItemTree(
      [item("p", "a", null, null, { minutes: 30 }), item("hidden", "b", "p", null, { minutes: 60 })],
      new Set(["a"]),
    );
    expect(subtreeMinutes(tree).get("p")).toBe(30);
  });
});

describe("scopeMinutes", () => {
  it("adds time on the backlogs themselves to their items' own time", () => {
    const p = payload({
      backlogs: [bl("a", null, 0, { minutes: 10 }), bl("b", "a", 0, { minutes: 5 }), bl("x", null, 0, { minutes: 99 })],
      items: [
        item("i1", "a", null, null, { minutes: 20 }),
        item("i2", "b", "i1", null, { minutes: 7 }),
        item("out", "x", null, null, { minutes: 99 }),
      ],
    });
    expect(scopeMinutes(p, backlogScope("a", p.backlogs))).toBe(42);
  });
});

describe("safeLinkHref", () => {
  it("allows http, https and mailto", () => {
    expect(safeLinkHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeLinkHref("http://example.com")).toBe("http://example.com/");
    expect(safeLinkHref("mailto:someone@example.com")).toBe("mailto:someone@example.com");
  });

  it("treats a bare domain as https, as people type them", () => {
    expect(safeLinkHref("www.example.com/page")).toBe("https://www.example.com/page");
    expect(safeLinkHref("  example.org  ")).toBe("https://example.org/");
  });

  it("refuses script and data URLs however they are written", () => {
    expect(safeLinkHref("javascript:alert(1)")).toBeNull();
    expect(safeLinkHref("  JaVaScRiPt:alert(1)")).toBeNull();
    expect(safeLinkHref("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeLinkHref("vbscript:msgbox(1)")).toBeNull();
  });

  it("refuses things that are not links at all", () => {
    expect(safeLinkHref("")).toBeNull();
    expect(safeLinkHref("not a url")).toBeNull();
    expect(safeLinkHref("see the doc")).toBeNull();
  });
});
