/**
 * The count the header's job search button carries: how many work items the
 * job hunt's tree holds. Kept by tree id, so a rename cannot silence it.
 */
import { describe, it, expect } from "vitest";
import { JOB_ADS_TREE_ID, countItemsInTree } from "@/lib/jobAdsTree";

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
