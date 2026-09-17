/**
 * After a status key, in a list sorted by status: the selected item jumps to
 * its new status group, and selection goes to the row below its old spot — not
 * along with the item, as in a rank-ordered list.
 */
import { describe, it, expect } from "vitest";
import { rowAfterStatusMove } from "@/lib/statusSelection";

const none = () => false;

describe("rowAfterStatusMove", () => {
  it("selects the row below when the change moved the item", () => {
    // B marked done: it moves from second place to the end.
    expect(
      rowAfterStatusMove({
        visibleBefore: ["a", "b", "c", "d"],
        selectedIds: ["b"],
        orderBefore: ["a", "b", "c", "d"],
        orderAfter: ["a", "c", "d", "b"],
        isInsideSelected: none,
      }),
    ).toBe("c");
  });

  it("selects the row above when the moved item was the last row", () => {
    expect(
      rowAfterStatusMove({
        visibleBefore: ["a", "b", "c"],
        selectedIds: ["c"],
        orderBefore: ["a", "b", "c"],
        orderAfter: ["c", "a", "b"],
        isInsideSelected: none,
      }),
    ).toBe("b");
  });

  it("leaves the selection alone when the item kept its place", () => {
    // The last in-progress item becoming the first done item stays where it is.
    expect(
      rowAfterStatusMove({
        visibleBefore: ["a", "b", "c"],
        selectedIds: ["b"],
        orderBefore: ["a", "b", "c"],
        orderAfter: ["a", "b", "c"],
        isInsideSelected: none,
      }),
    ).toBeNull();
  });

  it("leaves the selection alone for a child row, which the sort does not move", () => {
    expect(
      rowAfterStatusMove({
        visibleBefore: ["a", "a1", "b"],
        selectedIds: ["a1"],
        orderBefore: ["a", "b"],
        orderAfter: ["a", "b"],
        isInsideSelected: none,
      }),
    ).toBeNull();
  });

  it("skips the moved item's own children and other selected rows", () => {
    // A (expanded, with child a1) and B marked done together; both move down.
    expect(
      rowAfterStatusMove({
        visibleBefore: ["a", "a1", "b", "c"],
        selectedIds: ["a", "b"],
        orderBefore: ["a", "b", "c"],
        orderAfter: ["c", "a", "b"],
        isInsideSelected: (id) => id === "a1",
      }),
    ).toBe("c");
  });
});
