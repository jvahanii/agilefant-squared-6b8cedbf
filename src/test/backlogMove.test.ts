/**
 * Which backlogs a backlog drag carries. Dragging one of several selected
 * backlogs used to move only the one under the pointer.
 */
import { describe, it, expect } from "vitest";
import { backlogsToMove } from "@/lib/backlogMove";
import type { Backlog, BacklogTree } from "@/types/models";

//   T1: root1 ─┬─ child1 ── grandchild
//              └─ child2
//       root2
//       root3
function fixture() {
  const bl = (id: string, parentId: string | null, childrenIds: string[] = []): Backlog => ({
    id, name: id, parentId, childrenIds, treeId: "t1", rank: 0,
  });
  const backlogs: Record<string, Backlog> = {
    root1: bl("root1", null, ["child1", "child2"]),
    child1: bl("child1", "root1", ["grandchild"]),
    grandchild: bl("grandchild", "child1"),
    child2: bl("child2", "root1"),
    root2: bl("root2", null),
    root3: bl("root3", null),
  };
  const trees: Record<string, BacklogTree> = {
    t1: { id: "t1", name: "T1", rootBacklogIds: ["root1", "root2", "root3"], rank: 0 },
  };
  return { backlogs, trees };
}

describe("backlogsToMove", () => {
  it("carries the whole selection when the dragged backlog is in it, in tree order", () => {
    const { backlogs, trees } = fixture();
    expect(backlogsToMove("root2", ["root3", "child2", "root2"], backlogs, trees, null)).toEqual([
      "child2",
      "root2",
      "root3",
    ]);
  });

  it("carries only the dragged backlog when it is not selected", () => {
    const { backlogs, trees } = fixture();
    expect(backlogsToMove("root3", ["root2", "child2"], backlogs, trees, null)).toEqual(["root3"]);
  });

  it("leaves out a selected backlog whose ancestor is selected too — it moves inside that ancestor", () => {
    const { backlogs, trees } = fixture();
    expect(backlogsToMove("root1", ["root1", "grandchild", "root2"], backlogs, trees, null)).toEqual([
      "root1",
      "root2",
    ]);
  });

  it("never moves a backlog into itself or its own descendant", () => {
    const { backlogs, trees } = fixture();
    // Dropping onto grandchild: root1 and child1 contain it, so they stay put.
    expect(backlogsToMove("root2", ["child1", "root2", "root3"], backlogs, trees, "grandchild")).toEqual([
      "root2",
      "root3",
    ]);
    expect(backlogsToMove("root2", ["root2", "root3"], backlogs, trees, "root2")).toEqual(["root3"]);
  });

  it("ignores selected ids that no longer exist", () => {
    const { backlogs, trees } = fixture();
    expect(backlogsToMove("root2", ["gone", "root2"], backlogs, trees, null)).toEqual(["root2"]);
  });
});
