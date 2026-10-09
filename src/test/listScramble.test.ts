/**
 * What scrambling a list takes in.
 *
 * A list's name over a column of scrambled items gives the items away, and a
 * scrambled name over readable items hides nothing. So a list goes with the
 * lists under it, every item in any of them, and what is beneath those items.
 */
import { describe, it, expect } from "vitest";
import {
  inChunks,
  itemsInLists,
  listsUnder,
  namesSummary,
  planListScramble,
  planListUnscramble,
  SCRAMBLE_CHUNK,
} from "@/lib/listScramble";
import { scrambleName } from "@/lib/scramble";

const TREE = "t1";
const OTHER_TREE = "t2";

const list = (id: string, name: string, childrenIds: string[] = []) => ({ id, name, childrenIds });
const item = (
  id: string,
  title: string,
  inList: string | null,
  parentId: string | null = null,
  extra: { parentIds?: Record<string, string | null>; backlogAssignments?: Record<string, string> } = {},
) => ({
  id,
  title,
  parentId,
  parentIds: extra.parentIds,
  backlogAssignments: extra.backlogAssignments ?? (inList ? { [TREE]: inList } : {}),
});

const backlogs = {
  offers: list("offers", "Offers to answer", ["urgent"]),
  urgent: list("urgent", "By Friday", ["today"]),
  today: list("today", "Today"),
  elsewhere: list("elsewhere", "Somewhere else"),
};

const workItems = Object.fromEntries(
  [
    item("a", "Call the lawyer", "offers"),
    item("a1", "Find the contract", null, "a"),
    item("b", "Answer Nordea", "urgent"),
    item("c", "Sign", "today"),
    item("d", "Unrelated", "elsewhere"),
    // In this list in another tree only.
    item("e", "Mirrored in", null, null, { backlogAssignments: { [OTHER_TREE]: "offers" } }),
    // A child of an item in the list, by another tree's parent only.
    item("f", "Child elsewhere", "elsewhere", null, { parentIds: { [OTHER_TREE]: "b" } }),
  ].map((wi) => [wi.id, wi]),
);

const none = new Map<string, string | null>();

describe("the lists a list takes with it", () => {
  it("are the list and every list under it, the list first", () => {
    expect(listsUnder("offers", backlogs)).toEqual(["offers", "urgent", "today"]);
    expect(listsUnder("today", backlogs)).toEqual(["today"]);
  });

  it("leave out a list that is gone, and survive a loop", () => {
    const looped = { a: list("a", "A", ["b", "gone"]), b: list("b", "B", ["a"]) };
    expect(listsUnder("a", looped)).toEqual(["a", "b"]);
    expect(listsUnder("gone", looped)).toEqual([]);
  });
});

describe("the items in a list", () => {
  it("are those in it or in a list under it, in whichever tree, and everything beneath them", () => {
    const ids = itemsInLists(listsUnder("offers", backlogs), workItems);
    expect([...ids].sort()).toEqual(["a", "a1", "b", "c", "e", "f"]);
  });

  it("do not reach into a list beside it", () => {
    expect(itemsInLists(["today"], workItems)).toEqual(["c"]);
  });
});

describe("scrambling a list", () => {
  it("scrambles its name, the names of the lists under it, and every item, with the app's own words", () => {
    const plan = planListScramble("offers", backlogs, workItems, none, none);
    expect(plan.lists).toEqual([
      { id: "offers", name: scrambleName("Offers to answer") },
      { id: "urgent", name: scrambleName("By Friday") },
      { id: "today", name: scrambleName("Today") },
    ]);
    expect(plan.lists[0].name).not.toBe("Offers to answer");
    expect(plan.items.map((i) => i.id).sort()).toEqual(["a", "a1", "b", "c", "e", "f"]);
    expect(plan.items.find((i) => i.id === "a")!.title).toBe(scrambleName("Call the lawyer"));
  });

  it("passes over what is already scrambled, whoever did it — so a second time takes what was added", () => {
    const lists = new Map<string, string | null>([["offers", "me"], ["urgent", "someone"]]);
    const items = new Map<string, string | null>([["a", "me"], ["b", "someone"], ["c", null]]);
    const plan = planListScramble("offers", backlogs, workItems, lists, items);
    expect(plan.lists.map((l) => l.id)).toEqual(["today"]);
    expect(plan.items.map((i) => i.id).sort()).toEqual(["a1", "e", "f"]);
  });

  it("has nothing to do once everything is scrambled", () => {
    const lists = new Map<string, string | null>(["offers", "urgent", "today"].map((id) => [id, "me"]));
    const items = new Map<string, string | null>(["a", "a1", "b", "c", "e", "f"].map((id) => [id, "me"]));
    expect(planListScramble("offers", backlogs, workItems, lists, items)).toEqual({ lists: [], items: [] });
  });
});

describe("unscrambling a list", () => {
  it("puts back what this person scrambled, and leaves the rest", () => {
    const lists = new Map<string, string | null>([["offers", "me"], ["urgent", "someone"], ["elsewhere", "me"]]);
    const items = new Map<string, string | null>([["a", "me"], ["b", "someone"], ["c", null], ["d", "me"], ["f", "me"]]);
    const plan = planListUnscramble("offers", backlogs, workItems, lists, items, "me");
    expect(plan.listIds).toEqual(["offers"]);
    expect([...plan.itemIds].sort()).toEqual(["a", "f"]);
  });

  it("brings back what was scrambled with the list and has since been moved out of it", () => {
    // "d" was scrambled with Offers and then carried off to another list,
    // still scrambled; "elsewhere" was a list under it, moved out.
    const lists = new Map<string, string | null>([["offers", "me"], ["elsewhere", "me"]]);
    const items = new Map<string, string | null>([["a", "me"], ["d", "me"], ["z", "me"]]);
    const listsWith = new Map([["elsewhere", "offers"]]);
    const itemsWith = new Map([["a", "offers"], ["d", "offers"], ["z", "some other list"]]);
    const plan = planListUnscramble("offers", backlogs, workItems, lists, items, "me", listsWith, itemsWith);
    expect(plan.listIds).toEqual(["offers", "elsewhere"]);
    expect([...plan.itemIds].sort()).toEqual(["a", "d"]);
  });

  it("does not bring back someone else's, moved or not", () => {
    const items = new Map<string, string | null>([["d", "someone"]]);
    const plan = planListUnscramble("offers", backlogs, workItems, none, items, "me", new Map(), new Map([["d", "offers"]]));
    expect(plan).toEqual({ listIds: [], itemIds: [] });
  });

  it("claims nothing for someone who is not signed in — a scramble whose owner is gone stays", () => {
    const items = new Map<string, string | null>([["c", null]]);
    expect(planListUnscramble("offers", backlogs, workItems, none, items, null)).toEqual({ listIds: [], itemIds: [] });
  });
});

describe("saying what was done", () => {
  it("counts list names and item names", () => {
    expect(namesSummary(1, 0)).toBe("1 list name");
    expect(namesSummary(0, 1)).toBe("1 item name");
    expect(namesSummary(3, 12)).toBe("3 list names and 12 item names");
    expect(namesSummary(0, 0)).toBe("No names");
  });
});

describe("sending many items", () => {
  it("goes in runs, and a list with no items still makes its one call", () => {
    expect(inChunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(inChunks([], 2)).toEqual([[]]);
    expect(inChunks(Array.from({ length: SCRAMBLE_CHUNK }, (_, i) => i))).toHaveLength(1);
    expect(inChunks(Array.from({ length: SCRAMBLE_CHUNK + 1 }, (_, i) => i))).toHaveLength(2);
  });
});
