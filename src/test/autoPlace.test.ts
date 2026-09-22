/**
 * "Import & auto-place": postings with a closing date go to one list, the rest
 * to another — both chosen on the saved search.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_MIRROR_BACKLOG_ID, countOpenAds, findAutoPlaceTargets, findMirrorTarget, splitByDeadline } from "@/lib/autoPlace";
import type { Backlog } from "@/types/models";

const backlog = (id: string, name: string, treeId: string): Backlog => ({
  id, name, parentId: null, childrenIds: [], treeId, rank: 0,
});

const TREE = "org::bt-1";
const OTHER = "org::bt-2";

const search = (dated: string | null, undated: string | null, tree_id = TREE) => ({
  tree_id,
  auto_place_dated_backlog_id: dated,
  auto_place_undated_backlog_id: undated,
});

describe("findAutoPlaceTargets", () => {
  it("uses the lists the saved search names, by id", () => {
    const backlogs = {
      a: backlog("a", "Jobs with deadline", TREE),
      b: backlog("b", "Jobs with no deadline", TREE),
      c: backlog("c", "Inbox", TREE),
    };
    expect(findAutoPlaceTargets(backlogs, search("a", "b"))).toEqual({ withDeadline: "a", withoutDeadline: "b" });
  });

  it("does not care what the lists are called", () => {
    const backlogs = { a: backlog("a", "Deadlinella", TREE), b: backlog("b", "Renamed again", TREE) };
    expect(findAutoPlaceTargets(backlogs, search("a", "b"))).toEqual({ withDeadline: "a", withoutDeadline: "b" });
  });

  it("offers nothing when not set up, or a list is gone or in another tree", () => {
    const backlogs = { a: backlog("a", "x", TREE), b: backlog("b", "y", OTHER) };
    expect(findAutoPlaceTargets(backlogs, search(null, null))).toBeNull();
    expect(findAutoPlaceTargets(backlogs, search("a", null))).toBeNull();
    expect(findAutoPlaceTargets(backlogs, search("a", "deleted"))).toBeNull();
    expect(findAutoPlaceTargets(backlogs, search("a", "b"))).toBeNull();
    expect(findAutoPlaceTargets(backlogs, { tree_id: TREE })).toBeNull();
    expect(findAutoPlaceTargets(backlogs, null)).toBeNull();
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

describe("findMirrorTarget", () => {
  const NEXT_TREE = "org::bt-next";

  it("uses the list the search chose, found by id", () => {
    const backlogs = { chosen: backlog("chosen", "Applied", NEXT_TREE) };
    expect(findMirrorTarget(backlogs, TREE, "chosen")).toEqual({ backlogId: "chosen", treeId: NEXT_TREE });
  });

  it("falls back to the shortlist it used before, until the search chooses", () => {
    const backlogs = { [DEFAULT_MIRROR_BACKLOG_ID]: backlog(DEFAULT_MIRROR_BACKLOG_ID, "Renamed shortlist", NEXT_TREE) };
    expect(findMirrorTarget(backlogs, TREE, null)).toEqual({ backlogId: DEFAULT_MIRROR_BACKLOG_ID, treeId: NEXT_TREE });
    expect(findMirrorTarget(backlogs, TREE)).toEqual({ backlogId: DEFAULT_MIRROR_BACKLOG_ID, treeId: NEXT_TREE });
  });

  it("does not fall back to a list that only has the default's name", () => {
    const backlogs = { other: backlog("other", "Hae näitä seuraavaksi", NEXT_TREE) };
    expect(findMirrorTarget(backlogs, TREE, null)).toBeNull();
  });

  it("gives nothing for a chosen list that has since been deleted", () => {
    expect(findMirrorTarget({}, TREE, "gone")).toBeNull();
  });

  it("gives nothing for a list in the tree being imported into", () => {
    // An item holds one list per tree: "mirroring" there would move it.
    const backlogs = { same: backlog("same", "Inbox", TREE) };
    expect(findMirrorTarget(backlogs, TREE, "same")).toBeNull();
  });
});

describe("countOpenAds", () => {
  const NOW = "2026-09-21T12:00:00Z";
  const ad = (id: string, title: string) => ({ id, title });

  it("leaves out an ad whose closing date has gone by", () => {
    const ads = [ad("a", "0915 Fennia — Product owner"), ad("b", "0930 Metsä Group — Business AI")];
    expect(countOpenAds(ads, new Set(), NOW)).toBe(1);
  });

  it("counts an ad that closes today as open", () => {
    expect(countOpenAds([ad("a", "0921 Elisa — AI lead")], new Set(), NOW)).toBe(1);
  });

  it("leaves out an ad a posting check marked closed, dated or not", () => {
    const ads = [ad("a", "1011 Alma Media — AI"), ad("b", "Nordea — AI Platform Engineer"), ad("c", "Wärtsilä — Agile Coach")];
    expect(countOpenAds(ads, new Set(["a", "b"]), NOW)).toBe(1);
  });

  it("counts an ad with no date in its title as open unless marked closed", () => {
    expect(countOpenAds([ad("a", "Nordea — AI Platform Engineer")], new Set(), NOW)).toBe(1);
  });
});
