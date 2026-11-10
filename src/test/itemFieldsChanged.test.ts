/**
 * itemFieldsChanged: whether a change to the items touched any of the fields a
 * total is worked out from. The totals skip their work when it says no, so a
 * "no" that should have been a "yes" would leave a stale number on screen.
 */
import { describe, it, expect } from "vitest";
import { itemFieldsChanged } from "@/lib/itemFieldsChanged";
import type { WorkItem } from "@/types/models";

const item = (id: string, over: Partial<WorkItem> = {}): WorkItem =>
  ({
    id, title: id, status: "not_started", parentId: null, childrenIds: [],
    backlogAssignments: { t1: "b1" }, ranks: { b1: 0 }, ...over,
  }) as WorkItem;

const FIELDS = ["points", "parentId", "parentIds", "childrenIds", "backlogAssignments"] as const;
const before = { a: item("a", { childrenIds: ["b"], points: 3 }), b: item("b", { parentId: "a" }), c: item("c") };
const withItem = (id: keyof typeof before, over: Partial<WorkItem>) => ({ ...before, [id]: { ...before[id], ...over } });

describe("itemFieldsChanged", () => {
  it("says no for the same map, and for a new map of the same items", () => {
    expect(itemFieldsChanged(before, before, FIELDS)).toBe(false);
    expect(itemFieldsChanged(before, { ...before }, FIELDS)).toBe(false);
  });

  it("says no when only fields it was not asked about changed", () => {
    for (const over of [{ title: "x" }, { status: "done" as const }, { rating: 4 }, { deadline: "2026-12-01" }, { ranks: { b1: 9 } }]) {
      expect(itemFieldsChanged(before, withItem("c", over), FIELDS), JSON.stringify(over)).toBe(false);
    }
  });

  it("says yes for each field it was asked about", () => {
    expect(itemFieldsChanged(before, withItem("a", { points: 5 }), FIELDS)).toBe(true);
    expect(itemFieldsChanged(before, withItem("a", { points: undefined }), FIELDS)).toBe(true);
    expect(itemFieldsChanged(before, withItem("c", { parentId: "a" }), FIELDS)).toBe(true);
    expect(itemFieldsChanged(before, withItem("c", { parentIds: { t1: "a" } }), FIELDS)).toBe(true);
    expect(itemFieldsChanged(before, withItem("a", { childrenIds: [] }), FIELDS)).toBe(true);
    expect(itemFieldsChanged(before, withItem("a", { childrenIds: ["c"] }), FIELDS)).toBe(true);
    expect(itemFieldsChanged(before, withItem("c", { backlogAssignments: { t1: "b2" } }), FIELDS)).toBe(true);
    expect(itemFieldsChanged(before, withItem("c", { backlogAssignments: { t1: "b1", t2: "b9" } }), FIELDS)).toBe(true);
    expect(itemFieldsChanged(before, withItem("c", { backlogAssignments: {} }), FIELDS)).toBe(true);
  });

  it("tells a per-tree parent of null from none at all", () => {
    // getEffectiveParentId reads { t1: null } as "no parent in t1", whatever parentId says.
    const nested = { ...before, b: item("b", { parentId: "a", parentIds: { t1: null } }) };
    expect(itemFieldsChanged(before, nested, FIELDS)).toBe(true);
    expect(itemFieldsChanged(nested, before, FIELDS)).toBe(true);
    // Another tree with the same value is another entry too.
    const other = { ...before, b: item("b", { parentId: "a", parentIds: { t2: null } }) };
    expect(itemFieldsChanged(nested, other, FIELDS)).toBe(true);
  });

  it("says no for an item rebuilt with the same contents", () => {
    const rebuilt = withItem("a", { childrenIds: ["b"], backlogAssignments: { t1: "b1" }, parentIds: {} });
    expect(itemFieldsChanged(before, rebuilt, FIELDS)).toBe(false);
  });

  it("says yes when an item came or went, even with as many as before", () => {
    const { c: _gone, ...without } = before;
    expect(itemFieldsChanged(before, without, FIELDS)).toBe(true);
    expect(itemFieldsChanged(before, { ...before, d: item("d") }, FIELDS)).toBe(true);
    expect(itemFieldsChanged(before, { ...without, d: item("d") }, FIELDS)).toBe(true);
  });

  it("answers from where each cache last was, not from where another was", () => {
    // A cache not asked for a while asks from an older map than the others:
    // what changed since then is more than what changed since theirs.
    const older = before;
    const newer = withItem("a", { points: 8 });
    const now = { ...newer, c: { ...newer.c, title: "renamed" } };
    expect(itemFieldsChanged(newer, now, ["points"])).toBe(false);
    expect(itemFieldsChanged(older, now, ["points"])).toBe(true);
  });

  it("answers each cache's own question about the same change", () => {
    // The ids that changed are worked out once per change and shared; the
    // fields asked about are still each cache's own.
    const after = withItem("a", { points: 8 });
    expect(itemFieldsChanged(before, after, ["backlogAssignments"])).toBe(false);
    expect(itemFieldsChanged(before, after, ["points"])).toBe(true);
    expect(itemFieldsChanged(before, after, ["childrenIds"])).toBe(false);
  });
});
