/**
 * The public page has to show a backlog exactly as the app does, or a published
 * link quietly misrepresents someone's work. These pin the rules that
 * WorkItemTreePanel uses: descendant backlogs roll up into their parent, an item
 * whose parent lies outside the shown scope becomes a root, and siblings order
 * by rank with the id as tie-break.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import {
  backlogScope,
  buildBacklogTree,
  buildItemTree,
  statusFor,
  totalPoints,
  type PublishedBacklog,
  type PublishedItem,
  type PublishedPayload,
} from "@/lib/publicBacklog";

const bl = (id: string, parentId: string | null, rank = 0): PublishedBacklog => ({ id, name: id, parentId, rank });

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
  ...extra,
});

const payload = (over: Partial<PublishedPayload>): PublishedPayload => ({
  kind: "tree",
  tree: { id: "t", name: "Tree" },
  rootBacklogId: null,
  pointsVisible: false,
  backlogs: [],
  statusesByBacklog: {},
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
