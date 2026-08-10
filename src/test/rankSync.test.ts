import { describe, it, expect } from "vitest";
import { redistributeRanksByStatus, boardRankFromListPosition } from "@/lib/rankSync";

describe("redistributeRanksByStatus", () => {
  it("reorders same-status members into the slots they already own", () => {
    const members = [
      { id: "a", status: "not_started", rank: 0 },
      { id: "b", status: "in_progress", rank: 1 },
      { id: "c", status: "not_started", rank: 2 },
    ];
    // Desired order puts C before A.
    const out = redistributeRanksByStatus(members, ["c", "b", "a"]);
    expect(out).toEqual({ c: 0, a: 2 });
  });

  it("never moves items of other statuses", () => {
    const members = [
      { id: "a", status: "done", rank: 5 },
      { id: "b", status: "not_started", rank: 6 },
    ];
    expect(redistributeRanksByStatus(members, ["b", "a"])).toEqual({});
  });

  it("keeps fractional slot values intact", () => {
    const members = [
      { id: "a", status: "s", rank: 1.5 },
      { id: "b", status: "s", rank: 4 },
    ];
    expect(redistributeRanksByStatus(members, ["b", "a"])).toEqual({ b: 1.5, a: 4 });
  });
});

describe("boardRankFromListPosition", () => {
  it("inserts before the first sibling that comes later in the list", () => {
    const column = [
      { id: "x", boardRank: 0, listRank: 0 },
      { id: "y", boardRank: 1, listRank: 10 },
    ];
    expect(boardRankFromListPosition("m", 5, column)).toBe(0.5);
  });

  it("returns null when the item belongs at the end", () => {
    const column = [{ id: "x", boardRank: 0, listRank: 0 }];
    expect(boardRankFromListPosition("m", 5, column)).toBeNull();
  });

  it("returns null when no column card shares a list context", () => {
    const column = [{ id: "x", boardRank: 0, listRank: null }];
    expect(boardRankFromListPosition("m", 5, column)).toBeNull();
  });

  it("places before the head when the first card comes later", () => {
    const column = [{ id: "x", boardRank: 3, listRank: 9 }];
    expect(boardRankFromListPosition("m", 5, column)).toBe(2);
  });
});
