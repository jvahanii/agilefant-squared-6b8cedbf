import { describe, it, expect } from "vitest";
import { redistributeRanksByStatus, boardRankFromListPosition, listRanksFollowingColumn } from "@/lib/rankSync";

describe("listRanksFollowingColumn", () => {
  const sibs = (...pairs: [string, number][]) => pairs.map(([id, rank]) => ({ id, rank }));

  it("hands round the column's own positions when ranks are distinct", () => {
    // a, c in the column; b (another status) keeps 1.
    expect(listRanksFollowingColumn(sibs(["a", 0], ["b", 1], ["c", 2]), ["c", "a"])).toEqual({ c: 0, a: 2 });
  });

  it("matches redistributeRanksByStatus on distinct ranks", () => {
    const members = [
      { id: "a", status: "g", rank: 1 },
      { id: "b", status: "g", rank: 4 },
      { id: "c", status: "g", rank: 6 },
    ];
    const order = ["c", "a", "b"];
    expect(listRanksFollowingColumn(sibs(["a", 1], ["x", 3], ["b", 4], ["c", 6]), order))
      .toEqual(redistributeRanksByStatus(members, order));
  });

  it("splits shared ranks, raising later items only as far as needed", () => {
    // b and c share 2; d at 3 must then move up, e at 9 need not.
    expect(listRanksFollowingColumn(sibs(["a", 1], ["b", 2], ["c", 2], ["d", 3], ["e", 9]), ["c", "a", "b"]))
      .toEqual({ c: 1, a: 2, b: 3, d: 4 });
  });

  it("leaves a lone card alone", () => {
    expect(listRanksFollowingColumn(sibs(["a", 2], ["b", 2]), ["a"])).toEqual({});
  });
});

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
