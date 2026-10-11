/**
 * Where the job picker imports to — one list, chosen on the saved search and
 * kept by id — and the order the list is left in.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_MIRROR_BACKLOG_ID,
  countOpenAds,
  findImportList,
  findMirrorTarget,
  hasClosingDate,
  APPLIED_BACKLOG_ID,
  importListOrder,
  listsShownInPicker,
  postingUrlsIn,
} from "@/lib/autoPlace";
import type { Backlog } from "@/types/models";

const backlog = (id: string, name: string, treeId: string): Backlog => ({
  id, name, parentId: null, childrenIds: [], treeId, rank: 0,
});

const TREE = "org::bt-1";
const OTHER = "org::bt-2";

const search = (list: string | null, tree_id = TREE) => ({ tree_id, auto_place_backlog_id: list });

describe("findImportList", () => {
  it("is the list the saved search names, by id", () => {
    const backlogs = { a: backlog("a", "Open jobs", TREE), c: backlog("c", "Inbox", TREE) };
    expect(findImportList(backlogs, search("a"))).toBe("a");
  });

  it("does not care what the list is called", () => {
    expect(findImportList({ a: backlog("a", "Renamed again", TREE) }, search("a"))).toBe("a");
  });

  it("is nothing when none is chosen, or the list is gone or in another tree", () => {
    const backlogs = { a: backlog("a", "x", TREE), b: backlog("b", "y", OTHER) };
    expect(findImportList(backlogs, search(null))).toBeNull();
    expect(findImportList(backlogs, search("deleted"))).toBeNull();
    expect(findImportList(backlogs, search("b"))).toBeNull();
    expect(findImportList(backlogs, { tree_id: TREE })).toBeNull();
    expect(findImportList(backlogs, null)).toBeNull();
  });
});

describe("the order the list is left in", () => {
  const job = (title: string, deadline?: string) => ({ title, deadline });
  // Already by name, as the picker hands it over.
  const byName = [
    job("Alma Media - AI", "2026-10-11"),
    job("Basware - Portfolio Architect"),
    job("Fennia - Product owner", "2026-09-30"),
    job("Kesko - Manager", "2026-10-11"),
    job("Nordea - AI Platform Engineer"),
  ];

  it("puts the jobs with a deadline first, soonest at the top, then the rest by name", () => {
    expect(importListOrder(byName, true).map((j) => j.title)).toEqual([
      "Fennia - Product owner",
      // Closing the same day: by name.
      "Alma Media - AI",
      "Kesko - Manager",
      // No deadline: after every one that has, by name.
      "Basware - Portfolio Architect",
      "Nordea - AI Platform Engineer",
    ]);
  });

  it("leaves name order alone where the date is the start of the name", () => {
    // "0930 …" sorts ahead of "1011 …", and both ahead of any letter.
    const named = [job("0930 Fennia - Product owner"), job("1011 Alma Media - AI"), job("Nordea - AI Platform Engineer")];
    expect(importListOrder(named, false)).toEqual(named);
  });

  it("does not change the list it is given", () => {
    const before = [...byName];
    importListOrder(byName, true);
    expect(byName).toEqual(before);
  });
});

describe("hasClosingDate", () => {
  it("counts a deadline, or the date a name starts with", () => {
    const now = new Date("2026-09-21T12:00:00Z");
    expect(hasClosingDate({ title: "Fennia - Product owner", deadline: "2026-09-30" }, now)).toBe(true);
    expect(hasClosingDate({ title: "0930 Fennia - Product owner" }, now)).toBe(true);
    expect(hasClosingDate({ title: "Nordea - AI Platform Engineer" }, now)).toBe(false);
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

describe("the postings a list already holds", () => {
  const item = (id: string, assignments: Record<string, string>) => ({ id, backlogAssignments: assignments });
  const items = {
    a: item("a", { jobs: "open", next: "shortlist" }),
    b: item("b", { jobs: "open" }),
    c: item("c", { next: "skipped" }),
    d: item("d", { other: "shortlist" }),
  };
  const links = {
    a: [{ url: "https://x/a" }, { url: "https://x/a-second" }],
    b: [{ url: "https://x/b" }],
    c: [{ url: "https://x/c" }],
    d: [{ url: "https://x/d" }],
  };

  it("are the links of the items filed in it — every link of each", () => {
    expect([...postingUrlsIn(items, links, { backlogId: "shortlist", treeId: "next" })].sort()).toEqual([
      "https://x/a",
      "https://x/a-second",
    ]);
  });

  it("go by the list an item holds for that tree, not by the id turning up anywhere", () => {
    // "d" names "shortlist" for another tree altogether.
    expect(postingUrlsIn(items, links, { backlogId: "shortlist", treeId: "next" }).has("https://x/d")).toBe(false);
  });

  it("are none where there is no list, or nothing is loaded", () => {
    expect(postingUrlsIn(items, links, null).size).toBe(0);
    expect(postingUrlsIn(undefined, links, { backlogId: "shortlist", treeId: "next" }).size).toBe(0);
    expect(postingUrlsIn(items, undefined, { backlogId: "shortlist", treeId: "next" }).size).toBe(0);
  });
});

describe("the lists the picker says a posting is already in", () => {
  const NEXT = "org::bt-next";
  const mirror = { backlogId: "shortlist", treeId: NEXT };
  const lists = (over: Record<string, Backlog> = {}) => ({
    shortlist: backlog("shortlist", "Hae näitä seuraavaksi", NEXT),
    [APPLIED_BACKLOG_ID]: backlog(APPLIED_BACKLOG_ID, "Lanka vetämässä", NEXT),
    ...over,
  });

  it("are the list mirrored to, then the list of jobs applied for — each by its id", () => {
    expect(listsShownInPicker(lists(), TREE, mirror)).toEqual([mirror, { backlogId: APPLIED_BACKLOG_ID, treeId: NEXT }]);
    // Renamed, it is still the same list.
    const renamed = lists({ [APPLIED_BACKLOG_ID]: backlog(APPLIED_BACKLOG_ID, "Waiting to hear", NEXT) });
    expect(listsShownInPicker(renamed, TREE, mirror)[1]).toEqual({ backlogId: APPLIED_BACKLOG_ID, treeId: NEXT });
  });

  it("leave out the applied-for list where the organisation has no such list", () => {
    expect(listsShownInPicker({ shortlist: backlog("shortlist", "Shortlist", NEXT) }, TREE, mirror)).toEqual([mirror]);
  });

  it("leave it out when it sits in the tree imported into, where the search already says", () => {
    const inImportTree = lists({ [APPLIED_BACKLOG_ID]: backlog(APPLIED_BACKLOG_ID, "Lanka vetämässä", TREE) });
    expect(listsShownInPicker(inImportTree, TREE, mirror)).toEqual([mirror]);
  });

  it("name it once when it is itself the list mirrored to, and alone when nothing is mirrored", () => {
    const itself = { backlogId: APPLIED_BACKLOG_ID, treeId: NEXT };
    expect(listsShownInPicker(lists(), TREE, itself)).toEqual([itself]);
    expect(listsShownInPicker(lists(), TREE, null)).toEqual([itself]);
  });
});
