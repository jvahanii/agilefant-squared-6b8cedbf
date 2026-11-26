/**
 * The job hunt's tree carries in its name how many items four of its lists
 * hold at the top level, brought up to date after a job import.
 */
import { describe, it, expect } from "vitest";
import { listNameUpdates, nameWithoutCount, treeNameUpdates } from "@/lib/treeNameCount";
import type { WorkItem } from "@/types/models";

const T = "org::bt-1";
const OTHER = "org::bt-2";
const list = (id: string, name: string, treeId = T) => ({ id, name, treeId });
const item = (id: string, listId: string, parentId: string | null = null, treeId = T): WorkItem =>
  ({ id, title: id, parentId, childrenIds: [], backlogAssignments: { [treeId]: listId }, ranks: {} }) as unknown as WorkItem;

function state(treeName = "MWB uuden työn saaminen") {
  return {
    backlogTrees: { [T]: { id: T, name: treeName }, [OTHER]: { id: OTHER, name: "Open jobs" } },
    backlogs: Object.fromEntries(
      [
        list("ei", '"Ei" papereiden perusteella (174, total 263)'),
        list("paat", "Päättyneet prosessit (27)"),
        list("lanka", "Lanka vetämässä (55)"),
        list("pros", "Prosessit (5)"),
        list("hae", "Hae näitä seuraavaksi (52)"),
        list("open", "Prosessit", OTHER),
      ].map((b) => [b.id, b]),
    ),
    workItems: Object.fromEntries(
      [
        item("e1", "ei"),
        item("e2", "ei"),
        item("e2a", "ei", "e2"), // a child: not top level
        item("p1", "paat"),
        item("l1", "lanka"),
        item("l2", "lanka", "h1"), // under an item in another list: top level here
        item("s1", "pros"),
        item("h1", "hae"), // a list not counted
        item("o1", "open", null, OTHER), // a same-named list in another tree
      ].map((w) => [w.id, w]),
    ),
  };
}

describe("the tree's count of its lists", () => {
  it("adds up the top-level items of the four lists, found by name without their counts", () => {
    expect(treeNameUpdates(state())).toEqual([{ treeId: T, name: "MWB uuden työn saaminen (6)" }]);
  });

  it("replaces a count the name already has", () => {
    expect(treeNameUpdates(state("MWB uuden työn saaminen (250)"))).toEqual([{ treeId: T, name: "MWB uuden työn saaminen (6)" }]);
  });

  it("leaves a name that is already right", () => {
    expect(treeNameUpdates(state("MWB uuden työn saaminen (6)"))).toEqual([]);
  });

  it("renames nothing where the tree or its lists are not found", () => {
    expect(treeNameUpdates(state("Something else"))).toEqual([]);
    expect(treeNameUpdates({ ...state(), backlogs: {} })).toEqual([]);
    expect(treeNameUpdates({} as never)).toEqual([]);
  });

  it("takes off only the parenthesised note at the end", () => {
    expect(nameWithoutCount('"Ei" papereiden perusteella (174, total 263)')).toBe('"Ei" papereiden perusteella');
    expect(nameWithoutCount("Prosessit")).toBe("Prosessit");
    expect(nameWithoutCount("A (b) c")).toBe("A (b) c");
  });
});

describe("the lists' own counts", () => {
  it("replaces the count of each list in the tree that has one with its top-level items", () => {
    const s = state();
    s.backlogs.skip = list("skip", "Skipattu");
    s.workItems.k1 = item("k1", "skip");
    expect(listNameUpdates(s)).toEqual([
      { backlogId: "paat", name: "Päättyneet prosessit (1)" },
      { backlogId: "lanka", name: "Lanka vetämässä (2)" },
      { backlogId: "pros", name: "Prosessit (1)" },
      { backlogId: "hae", name: "Hae näitä seuraavaksi (1)" },
    ]);
  });

  it("leaves a list without a count, another note in parentheses, and other trees", () => {
    const names = listNameUpdates(state()).map((u) => u.backlogId);
    expect(names).not.toContain("ei"); // "(174, total 263)" is not a count
    expect(names).not.toContain("open");
  });

  it("leaves a count that is already right, and the tree's count still finds the renamed lists", () => {
    const s = state();
    for (const { backlogId, name } of listNameUpdates(s)) s.backlogs[backlogId] = { ...s.backlogs[backlogId], name };
    expect(listNameUpdates(s)).toEqual([]);
    expect(treeNameUpdates(s)).toEqual([{ treeId: T, name: "MWB uuden työn saaminen (6)" }]);
  });

  it("does nothing without its tree", () => {
    expect(listNameUpdates(state("Something else"))).toEqual([]);
    expect(listNameUpdates({} as never)).toEqual([]);
  });
});
