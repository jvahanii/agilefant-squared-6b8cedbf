/**
 * The count the header's job search button carries: how many work items the
 * job hunt's tree holds. Kept by tree id, so a rename cannot silence it.
 */
import { describe, it, expect } from "vitest";
import { JOB_ADS_TREE_ID, countItemsInTree, jobAdCount } from "@/lib/jobAdsTree";
import type { WorkItem } from "@/types/models";

const item = (id: string, assignments: Record<string, string>) => [
  id,
  { backlogAssignments: assignments },
];

describe("countItemsInTree", () => {
  const items = Object.fromEntries([
    item("a", { [JOB_ADS_TREE_ID]: "bl-1" }),
    item("b", { [JOB_ADS_TREE_ID]: "bl-2" }),
    // In the tree and in another one: still one item of this tree's.
    item("c", { [JOB_ADS_TREE_ID]: "bl-2", "other::bt-9": "bl-9" }),
    item("d", { "other::bt-9": "bl-9" }),
    item("e", {}),
  ]);

  it("counts every item in the tree, whichever list it sits in", () => {
    expect(countItemsInTree(items, JOB_ADS_TREE_ID)).toBe(3);
  });

  it("is zero for a tree this data does not have, and for no data at all", () => {
    expect(countItemsInTree(items, "nobody::bt-1")).toBe(0);
    expect(countItemsInTree({}, JOB_ADS_TREE_ID)).toBe(0);
    expect(countItemsInTree(undefined as unknown as Record<string, never>, JOB_ADS_TREE_ID)).toBe(0);
  });
});

describe("jobAdCount", () => {
  const job = (id: string, list = "bl-1") =>
    ({ id, title: id, status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { [JOB_ADS_TREE_ID]: list }, ranks: {} }) as WorkItem;
  const other = (id: string) =>
    ({ id, title: id, status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { "other::bt-9": "bl-9" }, ranks: {} }) as WorkItem;

  it("follows items coming, going and moving between trees, and not edits that leave them where they are", () => {
    let items: Record<string, WorkItem> = { a: job("a"), b: job("b"), d: other("d") };
    expect(jobAdCount(items)).toBe(2);
    items = { ...items, a: { ...items.a, title: "renamed", status: "done" } };
    expect(jobAdCount(items)).toBe(2);
    items = { ...items, c: job("c") };
    expect(jobAdCount(items)).toBe(3);
    items = { ...items, d: { ...items.d, backlogAssignments: { [JOB_ADS_TREE_ID]: "bl-2" } } };
    expect(jobAdCount(items)).toBe(4);
    items = { ...items, a: { ...items.a, backlogAssignments: { "other::bt-9": "bl-9" } } };
    expect(jobAdCount(items)).toBe(3);
    const { b: _gone, ...rest } = items;
    expect(jobAdCount(rest)).toBe(2);
  });
});
