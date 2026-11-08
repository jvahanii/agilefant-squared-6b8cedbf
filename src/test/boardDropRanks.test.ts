/**
 * A board drop rewrites board ranks for the column it lands in and, on purpose,
 * feeds the new column order back into the list ranks of same-context cards.
 * Seen live on 2026-11-07 ("Tab test" list): dragging "Receive the parcel" back
 * to the top of Not Started swapped two cards nobody touched and left two list
 * items on the same list rank. These tests pin what a drop must not do.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn().mockResolvedValue(true),
  upsertWorkItemBacklogRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
  upsertWorkItemBoardRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
}));

import { useAppStore } from "@/store/appStore";
import { upsertWorkItemBacklogRankRowsDetailed } from "@/store/supabaseSync";
import { byRank, topLevelItems } from "@/lib/workItemRows";
import type { WorkItem } from "@/types/models";

const ORG = "org";
const BT = `${ORG}::bt-1`;
const BL = `${ORG}::bl-1`;

// Ids as in the live list, so the id tie-break falls the same way:
// Weekly sync (3b9f…) sorts before Uusi (5826…) and Budget plan (efc7…).
const PARCEL = `${ORG}::wi-9c054f2e`;
const UUSI = `${ORG}::wi-58263440`;
const WEEKLY = `${ORG}::wi-3b9ff0eb`;
const BUDGET = `${ORG}::wi-efc723c1`;
const OTHER = `${ORG}::wi-00aa00aa`;

const card = (id: string, status: string, listRank: number | undefined, boardRank?: number): WorkItem =>
  ({
    id,
    title: id,
    status,
    parentId: null,
    childrenIds: [],
    backlogAssignments: { [BT]: BL },
    ranks: listRank === undefined ? {} : { [BL]: listRank },
    ...(boardRank === undefined ? {} : { boardRanks: { [BL]: boardRank } }),
  }) as WorkItem;

/** Items are inserted in the given order — the order the board keeps for ties. */
function seed(items: WorkItem[]) {
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: { [BT]: { id: BT, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
    backlogs: { [BL]: { id: BL, name: "Tab test", parentId: null, childrenIds: [], treeId: BT, rank: 0 } },
    workItems: Object.fromEntries(items.map((i) => [i.id, i])),
    selectedWorkItemIds: [],
    undoStack: [],
    redoStack: [],
    isLoading: false,
  } as never);
}

/** The Not Started column as the board draws it (BoardView's cardsByStatus). */
function drawnColumn(statusKey: string): string[] {
  const known = new Set(["not_started", "in_progress", "pending", "blocked", "done"]);
  return Object.values(useAppStore.getState().workItems)
    .filter((wi) => wi.childrenIds.length === 0 && (known.has(wi.status) ? wi.status : "not_started") === statusKey)
    .sort((a, b) => (a.boardRanks?.[BL] ?? a.ranks[BL] ?? 0) - (b.boardRanks?.[BL] ?? b.ranks[BL] ?? 0))
    .map((wi) => wi.id);
}

/** The list's top level as the list draws it. */
function listOrder(): string[] {
  const { workItems } = useAppStore.getState();
  return topLevelItems(workItems, BT, new Set([BL])).sort(byRank(BT)).map((wi) => wi.id);
}

function listRanks(): number[] {
  const { workItems } = useAppStore.getState();
  return listOrder().map((id) => workItems[id].ranks[BL]);
}

const writtenListRows = () =>
  vi.mocked(upsertWorkItemBacklogRankRowsDetailed).mock.calls.flatMap(([rows]) => rows);

beforeEach(() => {
  vi.mocked(upsertWorkItemBacklogRankRowsDetailed).mockClear();
});

describe("board drop: the column it computes is the column the board draws", () => {
  it("cards tied on rank keep the order they were drawn in", () => {
    // Budget plan has a board rank of 3; Weekly sync has none yet, so the board
    // falls back to its list rank — also 3. The board draws the tie in insertion
    // order (Budget plan first); the drop must not re-break it by id.
    seed([
      card(PARCEL, "in_progress", 0, 0),
      card(UUSI, "not_started", 1, 1),
      card(BUDGET, "not_started", 2, 3),
      card(WEEKLY, "not_started", 3),
    ]);
    expect(drawnColumn("not_started")).toEqual([UUSI, BUDGET, WEEKLY]);

    useAppStore.getState().reorderWorkItemInBoard(PARCEL, 0, BT, [BL], "not_started");

    expect(drawnColumn("not_started")).toEqual([PARCEL, UUSI, BUDGET, WEEKLY]);
    // List and board already agreed, and the parcel is already first in the
    // list: no list rank needs to change.
    expect(listOrder()).toEqual([PARCEL, UUSI, BUDGET, WEEKLY]);
    expect(writtenListRows()).toEqual([]);
  });

  it("a card the board files under Not Started counts when placing the drop", () => {
    // "review" is not a status of this list, so the board draws it in Not Started.
    seed([
      card(PARCEL, "in_progress", 0, 0),
      card(UUSI, "not_started", 1, 1),
      card(OTHER, "review", 2, 2),
      card(WEEKLY, "not_started", 3, 3),
    ]);
    expect(drawnColumn("not_started")).toEqual([UUSI, OTHER, WEEKLY]);

    // Dropped on the zone after the second card.
    useAppStore.getState().reorderWorkItemInBoard(PARCEL, 2, BT, [BL], "not_started");

    expect(drawnColumn("not_started")).toEqual([UUSI, OTHER, PARCEL, WEEKLY]);
  });

  it("a card dragged in from another column lands at the slot it was dropped on", () => {
    // The parcel's board rank 0 in In Progress says nothing about Not Started:
    // it must not shift the target index there.
    seed([
      card(PARCEL, "in_progress", 0, 0),
      card(UUSI, "not_started", 1, 1),
      card(WEEKLY, "not_started", 2, 2),
      card(BUDGET, "not_started", 3, 3),
    ]);

    // Dropped on the zone after Weekly sync.
    useAppStore.getState().reorderWorkItemInBoard(PARCEL, 2, BT, [BL], "not_started");

    expect(drawnColumn("not_started")).toEqual([UUSI, WEEKLY, PARCEL, BUDGET]);
  });
});

describe("board drop: the list follows the column without shared ranks", () => {
  it("duplicate list ranks are split so the list shows the column's order", () => {
    // Weekly sync and Budget plan share list rank 2 (the id breaks the tie in
    // the list). An In Progress item sits after them at 4.
    seed([
      card(UUSI, "not_started", 1, 1),
      card(WEEKLY, "not_started", 2, 2),
      card(BUDGET, "not_started", 2, 3),
      card(OTHER, "in_progress", 4, 0),
    ]);

    // Budget plan to the top of Not Started.
    useAppStore.getState().reorderWorkItemInBoard(BUDGET, 0, BT, [BL], "not_started");

    expect(drawnColumn("not_started")).toEqual([BUDGET, UUSI, WEEKLY]);
    expect(listOrder()).toEqual([BUDGET, UUSI, WEEKLY, OTHER]);
    const ranks = listRanks();
    expect(new Set(ranks).size).toBe(ranks.length);
    // The In Progress item keeps its place, and its rank as well.
    expect(useAppStore.getState().workItems[OTHER].ranks[BL]).toBe(4);
  });

  it("a card with no list rank yet does not take a rank another item holds", () => {
    // Weekly sync has no list rank row (the list reads it as 0, like OTHER's 0).
    seed([
      card(OTHER, "in_progress", 0, 0),
      card(UUSI, "not_started", 1, 1),
      card(WEEKLY, "not_started", undefined, 2),
    ]);

    // Weekly sync to the top of Not Started.
    useAppStore.getState().reorderWorkItemInBoard(WEEKLY, 0, BT, [BL], "not_started");

    expect(drawnColumn("not_started")).toEqual([WEEKLY, UUSI]);
    const { workItems } = useAppStore.getState();
    expect(workItems[WEEKLY].ranks[BL]).toBeLessThan(workItems[UUSI].ranks[BL]);
    const ranks = listRanks();
    expect(new Set(ranks).size).toBe(ranks.length);
  });

  it("with distinct ranks only the column's own list slots are handed round", () => {
    // Unchanged behaviour: the Not Started items swap the slots {0, 2}; the
    // In Progress item at 1 is not touched.
    seed([
      card(UUSI, "not_started", 0, 0),
      card(OTHER, "in_progress", 1, 0),
      card(WEEKLY, "not_started", 2, 1),
    ]);

    useAppStore.getState().reorderWorkItemInBoard(WEEKLY, 0, BT, [BL], "not_started");

    const { workItems } = useAppStore.getState();
    expect(workItems[WEEKLY].ranks[BL]).toBe(0);
    expect(workItems[UUSI].ranks[BL]).toBe(2);
    expect(workItems[OTHER].ranks[BL]).toBe(1);
    expect(writtenListRows().map((r) => r.workItemId).sort()).toEqual([UUSI, WEEKLY].sort());
  });
});
