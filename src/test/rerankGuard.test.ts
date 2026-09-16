/**
 * The view sort, saving it as rank, and the question asked before a top-level
 * move while a list is sorted by something other than rank.
 *
 * What matters: a sort changes nothing stored until saved; saving writes the
 * order shown and undoes in one step; a top-level move in a sorted list asks
 * first, and yes both saves and moves as one undo step and returns the list to
 * rank; cancel changes nothing; moves among children never ask.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/store/supabaseSync", () => ({
  loadFromSupabase: vi.fn().mockResolvedValue({ workItems: {}, backlogs: {}, backlogTrees: {} }),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn().mockResolvedValue(true),
  upsertWorkItemBacklogRankRows: vi.fn().mockResolvedValue(true),
  upsertWorkItemBacklogRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
  upsertWorkItemBoardRankRows: vi.fn().mockResolvedValue(true),
  upsertWorkItemBoardRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
  deleteWorkItemBoardRanks: vi.fn().mockResolvedValue(undefined),
  deleteWorkItems: vi.fn(),
  deleteWorkItemBacklogRanks: vi.fn(),
  upsertBacklog: vi.fn(),
  upsertBacklogs: vi.fn(),
  deleteBacklogs: vi.fn(),
  upsertBacklogTree: vi.fn(),
  deleteBacklogTree: vi.fn(),
  upsertBacklogTrees: vi.fn(),
  resetOrgData: vi.fn(),
  loadHyperlinksForWorkItems: vi.fn().mockResolvedValue({}),
  upsertHyperlink: vi.fn(),
  deleteHyperlink: vi.fn(),
  registerWorkItemRenameCallback: vi.fn(),
}));

vi.mock("@/store/mockData", () => ({
  generateMockData: vi.fn(() => ({ workItems: {}, backlogs: {}, backlogTrees: {} })),
}));

import { useAppStore } from "@/store/appStore";
import { useListSortStore, saveTopLevelOrderAsRank, listSortModeFor } from "@/store/listSortStore";
import { requestTopLevelRerank, useRerankGuardStore } from "@/store/rerankGuardStore";

const ORG = "org";
const TREE = `${ORG}::bt-1`;
const BL = `${ORG}::bl-1`;

/** Ranked Charlie, Alpha, Bravo; Alpha has a child that is ranked on its own. */
function seed() {
  const wi = (n: string, title: string, rank: number, parentId: string | null = null) => ({
    id: `${ORG}::${n}`, title, status: "not_started" as const, parentId, childrenIds: [] as string[],
    backlogAssignments: { [TREE]: BL }, ranks: { [BL]: rank }, organizationId: ORG,
  });
  const items = {
    [`${ORG}::c`]: wi("c", "Charlie", 0),
    [`${ORG}::a`]: { ...wi("a", "Alpha", 1), childrenIds: [`${ORG}::child`] },
    [`${ORG}::b`]: wi("b", "Bravo", 2),
    [`${ORG}::child`]: wi("child", "Zed child", 0, `${ORG}::a`),
  };
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
    backlogs: { [BL]: { id: BL, name: "Backlog", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
    workItems: items,
    selectedBacklogIds: [BL],
    selectedTreeId: TREE,
    selectedWorkItemIds: [],
    undoStack: [],
    redoStack: [],
    isLoading: false,
  });
}

const topLevelByRank = () =>
  Object.values(useAppStore.getState().workItems)
    .filter((w) => w.parentId === null)
    .sort((x, y) => x.ranks[BL] - y.ranks[BL])
    .map((w) => w.title);

beforeEach(() => {
  localStorage.clear();
  useListSortStore.setState({ modeByBacklog: {} });
  useRerankGuardStore.setState({ pending: null });
  seed();
});

describe("list sort choice", () => {
  it("is rank until one is chosen, and is kept per backlog", () => {
    expect(listSortModeFor(BL)).toBe("rank");
    useListSortStore.getState().setMode(BL, "name-asc");
    useListSortStore.getState().setMode("other-backlog", "team");
    expect(listSortModeFor(BL)).toBe("name-asc");
    expect(listSortModeFor("other-backlog")).toBe("team");
  });

  it("is stored in this browser, and a choice of rank is stored as no choice", () => {
    useListSortStore.getState().setMode(BL, "status");
    expect(JSON.parse(localStorage.getItem("list-sort-v1")!)).toEqual({ [BL]: "status" });
    useListSortStore.getState().setMode(BL, "rank");
    expect(JSON.parse(localStorage.getItem("list-sort-v1")!)).toEqual({});
  });

  it("changes nothing stored about the items", () => {
    const before = useAppStore.getState().workItems;
    useListSortStore.getState().setMode(BL, "name-asc");
    expect(useAppStore.getState().workItems).toBe(before);
  });
});

describe("saveTopLevelOrderAsRank", () => {
  it("ranks the top level in the order shown, leaving children alone", () => {
    useListSortStore.getState().setMode(BL, "name-asc");
    saveTopLevelOrderAsRank(TREE, BL, [BL]);
    expect(topLevelByRank()).toEqual(["Alpha", "Bravo", "Charlie"]);
    expect(useAppStore.getState().workItems[`${ORG}::child`].ranks[BL]).toBe(0);
  });

  it("is undone in one step", () => {
    useListSortStore.getState().setMode(BL, "name-desc");
    saveTopLevelOrderAsRank(TREE, BL, [BL]);
    useAppStore.getState().undo();
    expect(topLevelByRank()).toEqual(["Charlie", "Alpha", "Bravo"]);
  });
});

describe("requestTopLevelRerank", () => {
  it("moves at once when the list is in rank order", () => {
    const proceed = vi.fn();
    requestTopLevelRerank({ treeId: TREE, backlogId: BL, backlogIds: [BL], touchesTopLevel: true, proceed });
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(useRerankGuardStore.getState().pending).toBeNull();
  });

  it("never asks about a move among children", () => {
    useListSortStore.getState().setMode(BL, "name-asc");
    const proceed = vi.fn();
    requestTopLevelRerank({ treeId: TREE, backlogId: BL, backlogIds: [BL], touchesTopLevel: false, proceed });
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("does not ask on a board, where the list sort is not showing", () => {
    useListSortStore.getState().setMode(BL, "name-asc");
    useAppStore.setState({
      backlogs: { [BL]: { ...useAppStore.getState().backlogs[BL], viewMode: "board" } },
    });
    const proceed = vi.fn();
    requestTopLevelRerank({ treeId: TREE, backlogId: BL, backlogIds: [BL], touchesTopLevel: true, proceed });
    expect(proceed).toHaveBeenCalledTimes(1);
  });

  it("asks before a top-level move in a sorted list, and cancel changes nothing", () => {
    useListSortStore.getState().setMode(BL, "name-asc");
    const before = useAppStore.getState().workItems;
    const proceed = vi.fn();

    requestTopLevelRerank({ treeId: TREE, backlogId: BL, backlogIds: [BL], touchesTopLevel: true, proceed });
    expect(proceed).not.toHaveBeenCalled();
    expect(useRerankGuardStore.getState().pending).not.toBeNull();

    useRerankGuardStore.getState().cancel();
    expect(proceed).not.toHaveBeenCalled();
    expect(useAppStore.getState().workItems).toBe(before);
    expect(listSortModeFor(BL)).toBe("name-asc");
  });

  it("on yes saves the shown order, makes the move, returns to rank — all one undo", () => {
    useListSortStore.getState().setMode(BL, "name-asc");
    // Shown order is Alpha, Bravo, Charlie. Move Charlie (shown last) to the top.
    useAppStore.setState({ selectedWorkItemIds: [`${ORG}::c`] });

    requestTopLevelRerank({
      treeId: TREE,
      backlogId: BL,
      backlogIds: [BL],
      touchesTopLevel: true,
      proceed: () => useAppStore.getState().reorderWorkItemAmongSiblings(`${ORG}::c`, 0, TREE, [BL]),
    });
    useRerankGuardStore.getState().confirm();

    // Charlie went to the top of the order that was on screen, not of the old rank.
    expect(topLevelByRank()).toEqual(["Charlie", "Alpha", "Bravo"]);
    expect(listSortModeFor(BL)).toBe("rank");

    // Back to the ranks from before the save as well as before the move.
    useAppStore.getState().undo();
    const ranks = useAppStore.getState().workItems;
    expect([ranks[`${ORG}::c`].ranks[BL], ranks[`${ORG}::a`].ranks[BL], ranks[`${ORG}::b`].ranks[BL]]).toEqual([0, 1, 2]);
    expect(useAppStore.getState().undoStack).toHaveLength(0);
  });
});

describe("sortChildrenAlphabetically", () => {
  it("still sorts an item's children A→Z, as the context menu has always done", () => {
    const state = useAppStore.getState();
    useAppStore.setState({
      workItems: {
        ...state.workItems,
        [`${ORG}::a`]: { ...state.workItems[`${ORG}::a`], childrenIds: [`${ORG}::k2`, `${ORG}::k1`] },
        [`${ORG}::k2`]: { ...state.workItems[`${ORG}::child`], id: `${ORG}::k2`, title: "Zulu", ranks: { [BL]: 0 } },
        [`${ORG}::k1`]: { ...state.workItems[`${ORG}::child`], id: `${ORG}::k1`, title: "Echo", ranks: { [BL]: 1 } },
      },
    });
    const { [`${ORG}::child`]: _removed, ...withoutOldChild } = useAppStore.getState().workItems;
    useAppStore.setState({ workItems: withoutOldChild });

    useAppStore.getState().sortChildrenAlphabetically(`${ORG}::a`, TREE, [BL]);

    const after = useAppStore.getState().workItems;
    expect(after[`${ORG}::k1`].ranks[BL]).toBe(0);
    expect(after[`${ORG}::k2`].ranks[BL]).toBe(1);
    expect(after[`${ORG}::a`].childrenIds).toEqual([`${ORG}::k1`, `${ORG}::k2`]);
  });
});
