/**
 * A backlog's points: the larger of its own estimate and its contents.
 *
 * What matters most is what does not change — with no estimates, every total is
 * the one the app showed before — and that an item crossing backlogs (a story in
 * the release, its tasks in a sprint) is counted once however estimates stack.
 */
import { describe, it, expect } from "vitest";
import { backlogItemsTotal, backlogPoints, burnupTargets, itemEffectivePoints, treePoints, wellFormedPoints } from "@/lib/backlogPoints";
import type { Backlog, WorkItem } from "@/types/models";

const T = "t";

const bl = (id: string, childrenIds: string[] = [], points?: number, parentId: string | null = null): Backlog => ({
  id, name: id, parentId, childrenIds, treeId: T, rank: 0, points,
});

const wi = (id: string, backlog: string, points?: number, childrenIds: string[] = [], parentId: string | null = null): WorkItem => ({
  id, title: id, status: "not_started", parentId, childrenIds, backlogAssignments: { [T]: backlog }, ranks: {}, points,
});

const byId = <X extends { id: string }>(xs: X[]) => Object.fromEntries(xs.map((x) => [x.id, x]));

// A release with one sprint under it. A story in the release has two tasks in the sprint.
const backlogs = (release?: number, sprint?: number) =>
  byId([bl("release", ["sprint"], release), bl("sprint", [], sprint, "release")]);
const items = byId([
  wi("story", "release", 5, ["task-a", "task-b"]),
  wi("task-a", "sprint", 3, [], "story"),
  wi("task-b", "sprint", 4, [], "story"),
  wi("other", "release", 2),
]);

describe("items", () => {
  it("count as the larger of their own points and their children's", () => {
    expect(itemEffectivePoints(items, "story")).toBe(7); // max(5, 3 + 4)
    expect(itemEffectivePoints(items, "other")).toBe(2);
  });
});

describe("a backlog without an estimate", () => {
  it("adds up exactly as it always did", () => {
    expect(backlogItemsTotal("release", T, items, backlogs())).toBe(9); // story 7 + other 2
    expect(backlogPoints("release", T, items, backlogs())).toEqual({ own: undefined, itemsTotal: 9, contents: 9, effective: 9 });
    expect(backlogPoints("sprint", T, items, backlogs()).effective).toBe(7); // the tasks, 3 + 4
  });
});

describe("a backlog with an estimate", () => {
  it("counts the estimate while its contents are smaller", () => {
    expect(backlogPoints("release", T, items, backlogs(20)).effective).toBe(20);
  });

  it("counts its contents once they outgrow it", () => {
    expect(backlogPoints("release", T, items, backlogs(5)).effective).toBe(9);
  });

  it("passes up only what a sub-backlog's estimate adds beyond its own items", () => {
    // The sprint is estimated at 10; its tasks add up to 7, so 3 more is
    // expected there. The release has no estimate: 9 from items, plus 3.
    const p = backlogPoints("release", T, items, backlogs(undefined, 10));
    expect(p).toEqual({ own: undefined, itemsTotal: 9, contents: 12, effective: 12 });
  });

  it("never counts a task twice when its story is in the parent backlog", () => {
    // Both estimated below their items: nothing is added, and the tasks — in
    // the sprint, under a story in the release — are counted once, in the story.
    expect(backlogPoints("release", T, items, backlogs(1, 1)).effective).toBe(9);
  });

  it("adds a tree up from its root backlogs", () => {
    expect(treePoints(T, ["release"], items, backlogs(undefined, 10))).toBe(12);
    expect(treePoints(T, ["release"], items, backlogs())).toBe(9);
  });
});

describe("wellFormedPoints", () => {
  it("takes only whole numbers of zero or more", () => {
    expect(wellFormedPoints(0)).toBe(0);
    expect(wellFormedPoints(40)).toBe(40);
    expect(wellFormedPoints(-1)).toBeUndefined();
    expect(wellFormedPoints(2.5)).toBeUndefined();
    expect(wellFormedPoints(undefined)).toBeUndefined();
  });
});

describe("the burnup's lines", () => {
  it("are what they always were without an estimate, and when counting items", () => {
    expect(burnupTargets({ metric: "points", itemsTotal: 60 })).toEqual({ target: 60, scopeLine: null, projectTo: 60 });
    expect(burnupTargets({ metric: "count", itemsTotal: 12, own: 100 })).toEqual({ target: 12, scopeLine: null, projectTo: 12 });
  });

  it("aim at the estimate, with the contents as a scope line, when the backlog has one", () => {
    // 60 done of a 100 estimate: 40 still to come, not yet broken into items.
    expect(burnupTargets({ metric: "points", itemsTotal: 60, own: 100 })).toEqual({
      target: 100,
      scopeLine: { value: 60, label: "Scope 60" },
      projectTo: 100,
    });
  });

  it("project to the contents once they overrun the estimate", () => {
    expect(burnupTargets({ metric: "points", itemsTotal: 120, own: 100 })).toMatchObject({
      target: 100,
      scopeLine: { value: 120 },
      projectTo: 120,
    });
  });

  it("include estimates further down in the target, with the items as the scope line", () => {
    expect(burnupTargets({ metric: "points", itemsTotal: 9, upliftBelow: 3 })).toEqual({
      target: 12,
      scopeLine: { value: 9, label: "Items 9" },
      projectTo: 12,
    });
  });
});
