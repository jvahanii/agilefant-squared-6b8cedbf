/**
 * List-view rows follow each item's effective parent in the tree on screen.
 *
 * The fixture is the MWBs backlog as it was reported: "Skate" has global parent
 * "Fat" but, in this tree, a per-tree override placing it under "Vo2max". It is
 * also in another tree where it stays under Fat, so both Fat and Vo2max list it
 * in childrenIds. Walking childrenIds and indenting by global parent put Skate
 * at depth 0 — and every row after it too.
 */
import { describe, it, expect } from "vitest";
import { buildVisibleRows, effectiveAncestors, effectiveChildren } from "@/lib/workItemRows";
import type { WorkItem } from "@/types/models";

const T = "tree";
const OTHER = "other-tree";
const BL = "bl";

function wi(id: string, parentId: string | null, rank: number, extra: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    title: id,
    status: "not_started",
    parentId,
    childrenIds: [],
    backlogAssignments: { [T]: BL },
    ranks: { [BL]: rank },
    ...extra,
  } as WorkItem;
}

function fixture() {
  const items: Record<string, WorkItem> = {
    stronger: wi("stronger", null, 0),
    q34: wi("q34", "stronger", 0),
    vo2: wi("vo2", "q34", 0),
    // Global parent Fat; in this tree, Vo2max. Also in another tree.
    skate: wi("skate", "fat", 0, {
      parentIds: { [T]: "vo2" },
      backlogAssignments: { [T]: BL, [OTHER]: "other-bl" },
    }),
    bike: wi("bike", "vo2", 1),
    stairs: wi("stairs", "vo2", 2),
    muscle: wi("muscle", "q34", 1),
    fat: wi("fat", "q34", 2),
    actions: wi("actions", "fat", 0),
    q2: wi("q2", "stronger", 1),
    theme: wi("theme", null, 1),
  };
  // childrenIds as supabaseSync builds them: global children, then override children.
  for (const item of Object.values(items)) {
    if (item.parentId && items[item.parentId]) items[item.parentId].childrenIds.push(item.id);
  }
  items.vo2.childrenIds.push("skate");
  return items;
}

const inView = new Set([BL]);
const everything = (items: Record<string, WorkItem>) => new Set(Object.keys(items));

describe("list view rows", () => {
  it("indents every row under its effective parent, however the tree is expanded", () => {
    const items = fixture();
    const { ids, depths } = buildVisibleRows(["stronger", "theme"], everything(items), items, T, inView);

    expect(ids).toEqual([
      "stronger", "q34", "vo2", "skate", "bike", "stairs", "muscle", "fat", "actions", "q2", "theme",
    ]);
    expect(ids.map((id) => depths.get(id))).toEqual([0, 1, 2, 3, 3, 3, 2, 2, 3, 1, 0]);
  });

  it("lists an item only under its effective parent, never also under its global one", () => {
    const items = fixture();
    const { ids } = buildVisibleRows(["stronger"], everything(items), items, T, inView);
    expect(ids.filter((id) => id === "skate")).toHaveLength(1);
    expect(effectiveChildren("fat", items, T, inView).map((c) => c.id)).toEqual(["actions"]);
    expect(effectiveChildren("vo2", items, T, inView).map((c) => c.id)).toEqual(["skate", "bike", "stairs"]);
  });

  it("uses the global parent in a tree without an override", () => {
    const items = fixture();
    items.skate.backlogAssignments = { [OTHER]: BL };
    const { ids, depths } = buildVisibleRows(["fat"], everything(items), items, OTHER, inView);
    expect(ids).toEqual(["fat", "skate"]);
    expect(depths.get("skate")).toBe(1);
  });

  it("hides children in backlogs outside the view, and doesn't descend into collapsed items", () => {
    const items = fixture();
    items.bike.backlogAssignments = { [T]: "elsewhere" };
    const { ids } = buildVisibleRows(["stronger"], new Set(["stronger", "q34", "vo2"]), items, T, inView);
    expect(ids).toEqual(["stronger", "q34", "vo2", "skate", "stairs", "muscle", "fat", "q2"]);
  });

  it("survives a parent cycle in the data", () => {
    const items = fixture();
    items.stronger.parentId = "q2";
    items.q2.childrenIds.push("stronger");
    const { ids } = buildVisibleRows(["stronger"], everything(items), items, T, inView);
    expect(ids.filter((id) => id === "stronger")).toHaveLength(1);
  });

  it("builds breadcrumbs from effective parents", () => {
    const items = fixture();
    expect(effectiveAncestors("skate", items, T).map((a) => a.id)).toEqual(["stronger", "q34", "vo2"]);
    expect(effectiveAncestors("skate", items, OTHER).map((a) => a.id)).toEqual(["stronger", "q34", "fat"]);
  });
});
