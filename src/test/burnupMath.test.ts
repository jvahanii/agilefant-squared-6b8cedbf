/**
 * A burnup's numbers.
 *
 * On "Stronger faster fitter healthier @ 50" the scope read 283 points for items
 * worth 232: "Skate / BMX / MTB" (45) and "Bike" (6) have "Fat 28%=>20%" as
 * their default parent and "Actions" in that tree, are listed under both, and
 * were counted under each. And the days after today, added so the projection
 * had somewhere to land, carried today's figures as if they were history.
 */
import { describe, it, expect } from "vitest";
import { effectivePointsInScope, extendToDate, statusBreakdown } from "@/lib/burnupMath";
import type { WorkItem } from "@/types/models";

const T = "tree";

const item = (id: string, over: Partial<WorkItem> = {}): WorkItem => ({
  id, title: id, status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { [T]: "bl" }, ranks: {}, ...over,
});

// A goal with two branches; "bike" hangs under "fat" by default, "actions" here.
const items: Record<string, WorkItem> = {
  goal: item("goal", { childrenIds: ["fat", "actions"] }),
  fat: item("fat", { parentId: "goal", childrenIds: ["bike", "diet"] }),
  diet: item("diet", { parentId: "fat", points: 4, status: "done" }),
  actions: item("actions", { parentId: "goal", childrenIds: ["bike"] }),
  bike: item("bike", { parentId: "fat", parentIds: { [T]: "actions" }, points: 6, status: "in_progress" }),
};
const scope = new Set(Object.keys(items));
const keys = ["not_started", "in_progress", "done"];

describe("a burnup's scope", () => {
  it("counts an item with a different parent in this tree once", () => {
    expect(effectivePointsInScope(items, "goal", scope, new Map(), T)).toBe(10); // diet 4 + bike 6
  });

  it("follows the default parent where no tree is given", () => {
    // "bike" then belongs to "fat" alone: still once.
    expect(effectivePointsInScope(items, "goal", scope, new Map())).toBe(10);
  });
});

describe("a burnup's status bands", () => {
  it("put each item's points in its own status, once", () => {
    const breakdown = statusBreakdown(items, "goal", scope, new Map(), keys, new Set(), T);
    expect(breakdown).toEqual({ done: 4, in_progress: 6 });
  });
});

describe("the days after today", () => {
  const rows = [
    { date: "2026-09-24", done: 200 },
    { date: "2026-09-25", done: 232 },
  ];

  it("carry their date and nothing else", () => {
    const out = extendToDate(rows, "2026-09-28");
    expect(out.slice(2)).toEqual([{ date: "2026-09-26" }, { date: "2026-09-27" }, { date: "2026-09-28" }]);
    expect(out.slice(0, 2)).toEqual(rows);
  });

  it("are not added when the projection ends by today", () => {
    expect(extendToDate(rows, "2026-09-25")).toEqual(rows);
  });
});
