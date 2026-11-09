/**
 * Outdenting an item puts it right below its old parent, and moves the items
 * below that down a place to make room. Those moves were made on the page and
 * not saved: in the database the outdented item shared a rank with the item
 * below it, and after a reload the two could swap. Seen live on 2026-11-09,
 * when an undo brought that unsaved rank back and two items ended up on rank 5.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore, resetRankEchoSuppression } from "@/store/appStore";
import * as sync from "@/store/supabaseSync";
import type { Backlog, BacklogTree, WorkItem } from "@/types/models";

vi.mock("@/store/supabaseSync", () => ({
  loadFromSupabase: vi.fn().mockResolvedValue({ workItems: {}, backlogs: {}, backlogTrees: {} }),
  upsertWorkItem: vi.fn().mockResolvedValue(true),
  upsertWorkItems: vi.fn().mockResolvedValue(true),
  upsertWorkItemBacklogRankRows: vi.fn().mockResolvedValue(true),
  upsertWorkItemBacklogRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
  upsertWorkItemBoardRankRows: vi.fn().mockResolvedValue(true),
  upsertWorkItemBoardRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
  deleteWorkItemBoardRanks: vi.fn().mockResolvedValue(undefined),
  deleteWorkItems: vi.fn().mockResolvedValue(undefined),
  restoreWorkItems: vi.fn().mockResolvedValue(true),
  deleteWorkItemBacklogRanks: vi.fn().mockResolvedValue(undefined),
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
  updateBacklogRatingsEnabled: vi.fn(),
  updateBacklogCreatedDatesEnabled: vi.fn(),
  updateBacklogStartEndDatesEnabled: vi.fn(),
  updateBacklogPoints: vi.fn(),
  updateBacklogViewMode: vi.fn(),
}));

const ORG = "outdent-org";
const id = (x: string) => `${ORG}::${x}`;
const T = id("t1");
const B = id("b1");

function item(x: string, rank: number, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id: id(x), title: x, status: "not_started", parentId: null, childrenIds: [],
    backlogAssignments: { [T]: B }, ranks: { [B]: rank }, boardRanks: {}, organizationId: ORG, ...over,
  } as WorkItem;
}

const s = () => useAppStore.getState();
/** Each item's rank as last saved. */
const savedRanks = () => {
  const out: Record<string, number> = {};
  for (const [items] of vi.mocked(sync.upsertWorkItems).mock.calls) for (const w of items) out[w.title] = w.ranks[B];
  return out;
};

beforeEach(() => {
  resetRankEchoSuppression();
  localStorage.clear();
  vi.clearAllMocks();
  // a (with c under it), b, d — in that order.
  useAppStore.setState({
    organizationId: ORG, userId: null, userEmail: null,
    backlogs: { [B]: { id: B, name: "B1", parentId: null, childrenIds: [], treeId: T, rank: 0 } as Backlog },
    backlogTrees: { [T]: { id: T, name: "T1", rank: 0, rootBacklogIds: [B] } as BacklogTree },
    workItems: {
      [id("a")]: item("a", 0, { childrenIds: [id("c")] }),
      [id("c")]: item("c", 0, { parentId: id("a") }),
      [id("b")]: item("b", 1),
      [id("d")]: item("d", 2),
    },
    hyperlinks: {},
    selectedTreeId: T, selectedBacklogIds: [B], selectedWorkItemIds: [],
    expandedWorkItems: new Set(), expandedBacklogs: new Set(),
    undoStack: [], redoStack: [], changeLog: [], isLoading: false,
  } as never);
});

describe("outdenting an item", () => {
  it("saves the places of the items it pushed down", () => {
    // As Shift+Tab does it: to the parent's level, right below the parent.
    s().reparentWorkItem(id("c"), null, T, B, undefined, 1);

    const order = Object.values(s().workItems)
      .filter((w) => !w.parentId)
      .sort((x, y) => x.ranks[B] - y.ranks[B])
      .map((w) => `${w.title}@${w.ranks[B]}`);
    expect(order).toEqual(["a@0", "c@1", "b@2", "d@3"]);
    // What the database holds is what the page shows.
    expect(savedRanks()).toMatchObject({ c: 1, b: 2, d: 3 });
  });
});
