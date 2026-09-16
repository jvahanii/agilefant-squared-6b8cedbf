/**
 * The orders a backlog's top level can be shown in. Each mode has one job, and
 * every tie falls back on rank, so items that sort equal keep the order they
 * already had and the list does not shuffle between renders.
 */
import { describe, it, expect } from "vitest";
import type { WorkItem } from "@/types/models";
import { isListSortMode, sortTopLevel, type ListSortContext } from "@/lib/listSort";

const T = "tree";
const BL = "backlog";

const item = (id: string, title: string, rank: number, status = "not_started"): WorkItem =>
  ({
    id,
    title,
    status,
    parentId: null,
    childrenIds: [],
    backlogAssignments: { [T]: BL },
    ranks: { [BL]: rank },
  }) as WorkItem;

const STATUS_ORDER = ["not_started", "in_progress", "blocked", "done"];

const ctx = (over: Partial<ListSortContext> = {}): ListSortContext => ({
  teamsByItem: {},
  teamNames: {},
  statusPosition: (wi) => {
    const i = STATUS_ORDER.indexOf(wi.status);
    return i === -1 ? null : i;
  },
  ...over,
});

const ids = (items: WorkItem[]) => items.map((i) => i.id);

describe("sortTopLevel", () => {
  const items = [item("c", "Charlie", 0), item("a", "alpha", 1), item("b", "Bravo", 2)];

  it("leaves rank order alone in rank mode", () => {
    expect(ids(sortTopLevel(items, "rank", T, ctx()))).toEqual(["c", "a", "b"]);
  });

  it("sorts by name, ignoring case", () => {
    expect(ids(sortTopLevel(items, "name-asc", T, ctx()))).toEqual(["a", "b", "c"]);
    expect(ids(sortTopLevel(items, "name-desc", T, ctx()))).toEqual(["c", "b", "a"]);
  });

  it("sorts names naturally, so a number reads as a number", () => {
    const numbered = [item("10", "Item 10", 0), item("2", "Item 2", 1), item("1", "Item 1", 2)];
    expect(ids(sortTopLevel(numbered, "name-asc", T, ctx()))).toEqual(["1", "2", "10"]);
  });

  it("keeps rank order among items with the same name", () => {
    const twins = [item("second", "Same", 5), item("first", "Same", 1)];
    expect(ids(sortTopLevel(twins, "name-asc", T, ctx()))).toEqual(["first", "second"]);
    // Z→A reverses the name only, not the tie-break.
    expect(ids(sortTopLevel(twins, "name-desc", T, ctx()))).toEqual(["first", "second"]);
  });

  it("sorts by the status list's own order, with an unknown status last", () => {
    const mixed = [
      item("done", "D", 0, "done"),
      item("odd", "O", 1, "custom_retired"),
      item("new", "N", 2, "not_started"),
      item("wip", "W", 3, "in_progress"),
    ];
    expect(ids(sortTopLevel(mixed, "status", T, ctx()))).toEqual(["new", "wip", "done", "odd"]);
  });

  it("sorts by team name, by the first team alphabetically, with no team last", () => {
    const teamed = [item("none", "N", 0), item("zeta", "Z", 1), item("both", "B", 2), item("alpha", "A", 3)];
    const context = ctx({
      teamsByItem: { zeta: ["t-z"], both: ["t-z", "t-a"], alpha: ["t-a"] },
      teamNames: { "t-z": "Zulu", "t-a": "Apollo" },
    });
    // "both" belongs to Zulu and Apollo, so it sorts as Apollo; the tie with
    // "alpha" is settled by rank.
    expect(ids(sortTopLevel(teamed, "team", T, context))).toEqual(["both", "alpha", "zeta", "none"]);
  });

  it("does not change the array it was given", () => {
    const copy = [...items];
    sortTopLevel(items, "name-asc", T, ctx());
    expect(items).toEqual(copy);
  });
});

describe("isListSortMode", () => {
  it("accepts only the known modes", () => {
    expect(isListSortMode("team")).toBe(true);
    expect(isListSortMode("priority")).toBe(false);
    expect(isListSortMode(undefined)).toBe(false);
  });
});
