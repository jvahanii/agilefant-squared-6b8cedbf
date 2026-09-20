/**
 * Moving the selected item out of the list should leave the selection where
 * the eye already is — the row below, or the one above when it was last —
 * rather than dropping it and sending the panel back to nothing selected.
 *
 * A move that keeps the item on screen, or a mirror that leaves it in place,
 * must not disturb the selection at all.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "@/store/appStore";
import { visibleWorkItemIdsRef } from "@/store/navigationRefs";
import type { WorkItem } from "@/types/models";

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
  restoreWorkItems: vi.fn().mockResolvedValue(true),
  deleteWorkItemBacklogRanks: vi.fn(),
  upsertBacklog: vi.fn(),
  updateBacklogViewMode: vi.fn(),
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

const ORG = "selection-org";
const TREE = `${ORG}::tree-1`;
const FROM = `${ORG}::bl-from`;
const CHILD_OF_FROM = `${ORG}::bl-child`;
const ELSEWHERE = `${ORG}::bl-elsewhere`;
const [A, B, C] = [`${ORG}::wi-a`, `${ORG}::wi-b`, `${ORG}::wi-c`];

function backlog(id: string, parentId: string | null, childrenIds: string[], rank: number) {
  return { id, name: id, parentId, childrenIds, treeId: TREE, rank, boardHiddenStatusKeys: [], viewMode: "list" as const };
}

function item(id: string, rank: number): WorkItem {
  return {
    id, title: id, status: "not_started", parentId: null, childrenIds: [],
    backlogAssignments: { [TREE]: FROM }, ranks: { [FROM]: rank }, boardRanks: {}, organizationId: ORG,
  } as WorkItem;
}

function seed(selected: string[], visible: string[] = [A, B, C]) {
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [FROM, ELSEWHERE], rank: 0, pointsEnabled: null } },
    backlogs: {
      [FROM]: backlog(FROM, null, [CHILD_OF_FROM], 0),
      [CHILD_OF_FROM]: backlog(CHILD_OF_FROM, FROM, [], 0),
      [ELSEWHERE]: backlog(ELSEWHERE, null, [], 1),
    },
    workItems: { [A]: item(A, 0), [B]: item(B, 1), [C]: item(C, 2) },
    selectedTreeId: TREE,
    selectedBacklogIds: [FROM],
    selectedWorkItemIds: selected,
    undoStack: [], redoStack: [],
    isLoading: false, workItemsLoading: false,
  });
  visibleWorkItemIdsRef.current = visible;
}

const selection = () => useAppStore.getState().selectedWorkItemIds;

beforeEach(() => {
  visibleWorkItemIdsRef.current = [];
});

describe("selection after moving an item to another backlog", () => {
  it("moves to the row below", () => {
    seed([B]);
    useAppStore.getState().moveWorkItemsToBacklog([B], ELSEWHERE, TREE);
    expect(selection()).toEqual([C]);
  });

  it("moves to the row above when the item was last", () => {
    seed([C]);
    useAppStore.getState().moveWorkItemsToBacklog([C], ELSEWHERE, TREE);
    expect(selection()).toEqual([B]);
  });

  it("skips the other items moving with it", () => {
    seed([A, B]);
    useAppStore.getState().moveWorkItemsToBacklog([A, B], ELSEWHERE, TREE);
    expect(selection()).toEqual([C]);
  });

  it("clears the selection when nothing is left", () => {
    seed([A, B, C]);
    useAppStore.getState().moveWorkItemsToBacklog([A, B, C], ELSEWHERE, TREE);
    expect(selection()).toEqual([]);
  });

  it("leaves the selection alone when the item stays on screen", () => {
    // Selecting a backlog shows everything beneath it, so a move into a child
    // backlog does not take the item out of view.
    seed([B]);
    useAppStore.getState().moveWorkItemsToBacklog([B], CHILD_OF_FROM, TREE);
    expect(selection()).toEqual([B]);
  });

  it("leaves the selection alone when mirroring, which moves nothing", () => {
    seed([B]);
    useAppStore.getState().moveWorkItemsToBacklog([B], ELSEWHERE, TREE, "mirror");
    expect(selection()).toEqual([B]);
  });

  it("leaves the selection alone when some other item is moved", () => {
    seed([B]);
    useAppStore.getState().moveWorkItemsToBacklog([A], ELSEWHERE, TREE);
    expect(selection()).toEqual([B]);
  });
});

describe("selection after removing an item from the tree", () => {
  it("moves to the row below, since the item leaves the view entirely", () => {
    seed([B]);
    useAppStore.getState().removeWorkItemsFromTreeBulk([{ workItemId: B, treeId: TREE }]);
    expect(selection()).toEqual([C]);
  });

  it("moves to the row above when the item was last", () => {
    seed([C]);
    useAppStore.getState().removeWorkItemsFromTreeBulk([{ workItemId: C, treeId: TREE }]);
    expect(selection()).toEqual([B]);
  });

  it("leaves the selection alone when some other item is removed", () => {
    seed([B]);
    useAppStore.getState().removeWorkItemsFromTreeBulk([{ workItemId: A, treeId: TREE }]);
    expect(selection()).toEqual([B]);
  });
});
