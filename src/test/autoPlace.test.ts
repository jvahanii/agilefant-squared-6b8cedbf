/**
 * "Import & auto-place": postings with a closing date go to Deadlinella, the
 * rest to Toistaiseksi avoimet.
 */
import { describe, it, expect } from "vitest";
import { findAutoPlaceTargets, splitByDeadline } from "@/lib/autoPlace";
import type { Backlog } from "@/types/models";

const backlog = (id: string, name: string, treeId: string): Backlog => ({
  id, name, parentId: null, childrenIds: [], treeId, rank: 0,
});

const TREE = "org::bt-1";
const OTHER = "org::bt-2";

describe("findAutoPlaceTargets", () => {
  it("finds both lists in the tree being imported into", () => {
    const backlogs = {
      a: backlog("a", "Deadlinella", TREE),
      b: backlog("b", " toistaiseksi AVOIMET ", TREE),
      c: backlog("c", "Ei ehtinyt hakea", TREE),
    };
    expect(findAutoPlaceTargets(backlogs, TREE)).toEqual({ withDeadline: "a", withoutDeadline: "b" });
  });

  it("offers nothing when either list is missing, or lives in another tree", () => {
    expect(findAutoPlaceTargets({ a: backlog("a", "Deadlinella", TREE) }, TREE)).toBeNull();
    const split = {
      a: backlog("a", "Deadlinella", TREE),
      b: backlog("b", "Toistaiseksi avoimet", OTHER),
    };
    expect(findAutoPlaceTargets(split, TREE)).toBeNull();
    expect(findAutoPlaceTargets(split, null)).toBeNull();
  });
});

describe("splitByDeadline", () => {
  it("counts only a stated date as a deadline", () => {
    const links = [
      { url: "a", deadline: "2026-10-11" },
      { url: "b" },
      // Open-ended is an answer, but it is not a date.
      { url: "c", deadlineOpen: true },
    ];
    const { dated, undated } = splitByDeadline(links);
    expect(dated.map((l) => l.url)).toEqual(["a"]);
    expect(undated.map((l) => l.url)).toEqual(["b", "c"]);
  });
});
