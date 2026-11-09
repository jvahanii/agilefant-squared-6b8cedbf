/**
 * The store's ordering and moving actions — reordering in a list and on a
 * board, sorting, moving to another list or tree, putting under another item,
 * taking out of a tree, and duplicating — recorded as they behave, step by
 * step, so that moving them out of appStore.ts into slices of their own
 * changes none of it.
 *
 * Each step records what changed in the items, lists, trees and links (and
 * which of them it left untouched), the selection, the depth of undo and redo,
 * and everything it sent to the database, queued for a retry, or asked the
 * labels, teams and financials stores to copy.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAppStore, resetRankEchoSuppression } from "@/store/appStore";
import * as sync from "@/store/supabaseSync";
import type { Backlog, BacklogTree, Hyperlink, WorkItem } from "@/types/models";

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
  upsertBacklog: vi.fn().mockResolvedValue(undefined),
  upsertBacklogs: vi.fn().mockResolvedValue(undefined),
  deleteBacklogs: vi.fn().mockResolvedValue(undefined),
  upsertBacklogTree: vi.fn().mockResolvedValue(undefined),
  deleteBacklogTree: vi.fn().mockResolvedValue(undefined),
  upsertBacklogTrees: vi.fn().mockResolvedValue(undefined),
  resetOrgData: vi.fn(),
  loadHyperlinksForWorkItems: vi.fn().mockResolvedValue({}),
  upsertHyperlink: vi.fn().mockResolvedValue(undefined),
  deleteHyperlink: vi.fn().mockResolvedValue(undefined),
  registerWorkItemRenameCallback: vi.fn(),
  updateBacklogRatingsEnabled: vi.fn(),
  updateBacklogCreatedDatesEnabled: vi.fn(),
  updateBacklogStartEndDatesEnabled: vi.fn(),
  updateBacklogPoints: vi.fn(),
  updateBacklogViewMode: vi.fn(),
}));

// What a duplicate asks the other stores to copy.
const copied: unknown[] = [];
vi.mock("@/store/labelsStore", () => ({
  useLabelsStore: {
    getState: () => ({
      labels: { lab1: { id: "lab1", organizationId: "order-org" } },
      byEntity: { "work_item:order-org::w1": ["lab1"] },
      assignLabel: (...args: unknown[]) => copied.push(["assignLabel", ...args]),
    }),
  },
}));
vi.mock("@/store/teamStore", () => ({
  useTeamStore: {
    getState: () => ({
      teams: [{ id: "team1", organization_id: "order-org" }],
      workItemTeams: { "order-org::w2": ["team1"] },
      assignTeamToWorkItem: (...args: unknown[]) => copied.push(["assignTeamToWorkItem", ...args]),
    }),
  },
}));
vi.mock("@/store/financialsStore", () => ({
  useFinancialsStore: {
    getState: () => ({
      byWorkItem: {
        "order-org::w1": { savingsByMonth: { "2026-01": 5 }, incomeByMonth: {}, actualSavingsByMonth: {}, actualIncomeByMonth: {}, currency: "EUR" },
      },
      upsert: (...args: unknown[]) => copied.push(["upsertFinancials", ...args]),
    }),
  },
}));

const ORG = "order-org";
const id = (x: string) => `${ORG}::${x}`;
const [T1, T2] = [id("t1"), id("t2")];
const [B1, B1A, B1B, B2, B3] = [id("b1"), id("b1a"), id("b1b"), id("b2"), id("b3")];
const W = (n: number) => id(`w${n}`);

function item(n: number, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id: W(n), title: `w${n}`, status: "not_started", parentId: null, childrenIds: [],
    backlogAssignments: { [T1]: B1 }, ranks: { [B1]: 0 }, boardRanks: {}, organizationId: ORG,
    ...over,
  } as WorkItem;
}

/**
 * Tree one: b1 with b1a and b1b under it, b2 beside it. Tree two: b3.
 * In b1: w1 (with w2 under it, w3 under w2), w4 (also in b3, on the board in
 * progress), w5 (done), w7 ("Alpha") and w10 ("Bravo"). w6 alone in b2. w8 under
 * w4 in b1, and in b3 at the top. w9 in b1a.
 */
function world() {
  const backlogs: Record<string, Backlog> = {
    [B1]: { id: B1, name: "B1", parentId: null, childrenIds: [B1A, B1B], treeId: T1, rank: 0 } as Backlog,
    [B1A]: { id: B1A, name: "B1a", parentId: B1, childrenIds: [], treeId: T1, rank: 0 } as Backlog,
    [B1B]: { id: B1B, name: "B1b", parentId: B1, childrenIds: [], treeId: T1, rank: 1 } as Backlog,
    [B2]: { id: B2, name: "B2", parentId: null, childrenIds: [], treeId: T1, rank: 1 } as Backlog,
    [B3]: { id: B3, name: "B3", parentId: null, childrenIds: [], treeId: T2, rank: 0 } as Backlog,
  };
  const backlogTrees: Record<string, BacklogTree> = {
    [T1]: { id: T1, name: "T1", rank: 0, rootBacklogIds: [B1, B2] } as BacklogTree,
    [T2]: { id: T2, name: "T2", rank: 1, rootBacklogIds: [B3] } as BacklogTree,
  };
  const workItems: Record<string, WorkItem> = {
    [W(1)]: item(1, { title: "Zulu", childrenIds: [W(2)], ranks: { [B1]: 0 }, boardRanks: { [B1]: 0 } }),
    [W(2)]: item(2, { parentId: W(1), childrenIds: [W(3)], ranks: { [B1]: 1 } }),
    [W(3)]: item(3, { parentId: W(2), ranks: { [B1]: 2 } }),
    [W(4)]: item(4, {
      title: "Mike", status: "in_progress", childrenIds: [W(8)],
      backlogAssignments: { [T1]: B1, [T2]: B3 }, ranks: { [B1]: 3, [B3]: 1 }, boardRanks: { [B1]: 0 },
    }),
    [W(5)]: item(5, { title: "Echo", status: "done", ranks: { [B1]: 4 }, boardRanks: { [B1]: 0 } }),
    [W(6)]: item(6, { backlogAssignments: { [T1]: B2 }, ranks: { [B2]: 0 } }),
    [W(7)]: item(7, { title: "Alpha", ranks: { [B1]: 5 }, boardRanks: { [B1]: 1 } }),
    [W(8)]: item(8, {
      parentId: W(4), parentIds: { [T2]: null } as never,
      backlogAssignments: { [T1]: B1, [T2]: B3 }, ranks: { [B1]: 6, [B3]: 0 },
    }),
    [W(9)]: item(9, { backlogAssignments: { [T1]: B1A }, ranks: { [B1A]: 0 } }),
    [W(10)]: item(10, { title: "Bravo", ranks: { [B1]: 7 }, boardRanks: { [B1]: 2 } }),
  };
  const hyperlinks: Record<string, Hyperlink[]> = {
    [W(1)]: [{ id: "h1", workItemId: W(1), url: "https://a.example", altText: "A", rank: 0 }],
    [W(3)]: [{ id: "h3", workItemId: W(3), url: "https://c.example", altText: "C", rank: 0 }],
  };
  return { workItems, backlogs, backlogTrees, hyperlinks };
}

let uuids = 0;
let uuidSpy: { mockRestore: () => void } | null = null;
beforeEach(() => {
  localStorage.clear();
  resetRankEchoSuppression();
  vi.clearAllMocks();
  copied.length = 0;
  uuids = 0;
  uuidSpy = vi.spyOn(crypto, "randomUUID").mockImplementation(
    () => `${String(++uuids).padStart(8, "0")}-0000-4000-8000-000000000000` as `${string}-${string}-${string}-${string}-${string}`,
  );
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-04T10:00:00Z"));
  useAppStore.setState({
    ...world(),
    organizationId: ORG, userId: null, userEmail: null,
    selectedTreeId: T1, selectedBacklogIds: [B1], selectedWorkItemIds: [],
    expandedWorkItems: new Set(), expandedBacklogs: new Set(),
    undoStack: [], redoStack: [], changeLog: [], isLoading: false,
  } as never);
});
afterEach(() => {
  vi.useRealTimers();
  uuidSpy?.mockRestore();
});

const MAPS = ["workItems", "backlogs", "backlogTrees", "hyperlinks"] as const;

/** What a step changed in each map: the new value of every entry it replaced, added or removed. */
function changes(before: ReturnType<typeof useAppStore.getState>, after: ReturnType<typeof useAppStore.getState>) {
  const out: Record<string, unknown> = {};
  for (const name of MAPS) {
    const a = before[name] as Record<string, unknown>;
    const b = after[name] as Record<string, unknown>;
    if (a === b) {
      out[name] = "untouched";
      continue;
    }
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
    out[name] = Object.fromEntries(keys.map((k) => [k, b[k] === undefined ? "REMOVED" : b[k]]));
  }
  return out;
}

/** Every call the step made to the database layer, in order. */
function calls() {
  const out: unknown[] = [];
  for (const [name, fn] of Object.entries(sync)) {
    const mock = vi.mocked(fn as (...args: unknown[]) => unknown);
    if (!mock?.mock) continue;
    for (const args of mock.mock.calls) out.push([name, ...args]);
  }
  return out;
}

function queued() {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith("pending_")) out[k] = JSON.parse(localStorage.getItem(k)!);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

async function run(steps: Array<[string, () => unknown]>) {
  const record: unknown[] = [];
  for (const [name, step] of steps) {
    vi.clearAllMocks();
    copied.length = 0;
    const before = useAppStore.getState();
    const returned = step();
    const queuedAtOnce = queued();
    await vi.dynamicImportSettled();
    for (let i = 0; i < 5; i++) await Promise.resolve();
    const after = useAppStore.getState();
    record.push({
      step: name,
      returned,
      ...changes(before, after),
      selected: after.selectedWorkItemIds,
      undo: after.undoStack.length,
      redo: after.redoStack.length,
      log: after.changeLog.slice(0, after.changeLog.length - before.changeLog.length).map((e) => [e.action, e.entityId, e.details]),
      db: calls(),
      queuedAtOnce,
      queued: queued(),
      copied: [...copied],
    });
  }
  return record;
}

const s = () => useAppStore.getState();

describe("ordering", () => {
  it("in a list, step by step", async () => {
    expect(await run([
      ["w7 to the top of b1", () => s().reorderWorkItemAmongSiblings(W(7), 0, T1, [B1])],
      ["w2 among its siblings (alone)", () => s().reorderWorkItemAmongSiblings(W(2), 0, T1, [B1])],
      ["w1 to the bottom", () => s().reorderWorkItemAmongSiblings(W(1), 4, T1, [B1])],
      ["w4 and w5 selected, w5 dragged up one", () => {
        s().selectWorkItemRange([W(4), W(5)], false);
        s().reorderWorkItemAmongSiblings(W(5), 1, T1, [B1]);
      }],
      ["w9 into the view of b1 and b1a, to the top", () => s().reorderWorkItemAmongSiblings(W(9), 0, T1, [B1, B1A])],
      ["w8, a child here and a root in tree two, to the top of b3", () => s().reorderWorkItemAmongSiblings(W(8), 1, T2, [B3])],
      ["sort b1 by name", () => s().sortChildrenAlphabetically(null, T1, [B1])],
      ["sort under w1", () => s().sortChildrenAlphabetically(W(1), T1, [B1])],
      ["order b1 as given", () => s().applySiblingOrder(null, T1, [B1], [W(5), W(1), W(4), W(7)], "custom order")],
      ["undo", () => s().undo()],
      ["redo", () => s().redo()],
    ])).toMatchSnapshot();
  });

  it("on a board, step by step", async () => {
    expect(await run([
      ["w7 to the top of Not started", () => s().reorderWorkItemInBoard(W(7), 0, T1, [B1], "not_started")],
      ["w10 above w7: the list follows the column", () => s().reorderWorkItemInBoard(W(10), 0, T1, [B1], "not_started")],
      ["w7 into In progress, below w4", () => s().reorderWorkItemInBoard(W(7), 1, T1, [B1], "in_progress")],
      ["w4 into Done, at the top", () => s().reorderWorkItemInBoard(W(4), 0, T1, [B1], "done")],
      ["w1 within its column, no column given", () => s().reorderWorkItemInBoard(W(1), 1, T1, [B1])],
      ["w5 to a column of its own in b3's view", () => s().reorderWorkItemInBoard(W(5), 0, T1, [B1, B1A], "blocked")],
      ["undo", () => s().undo()],
      ["undo", () => s().undo()],
    ])).toMatchSnapshot();
  });
});

describe("moving", () => {
  it("to another list or tree, step by step", async () => {
    expect(await run([
      ["w1 with its children to b2", () => s().moveWorkItemToBacklog(W(1), B2, T1)],
      ["w4 mirrored into b3 of tree two", () => s().moveWorkItemToBacklog(W(7), B3, T2, "mirror", T1)],
      ["w5 moved to tree two", () => s().moveWorkItemToBacklog(W(5), B3, T2, "move", T1)],
      ["w6 and w9 to b1b", () => s().moveWorkItemsToBacklog([W(6), W(9)], B1B, T1)],
      ["w6 and w7 moved to tree two", () => s().moveWorkItemsToBacklog([W(6), W(7)], B3, T2, "move", T1)],
      ["w4 mirrored into b2 (same tree)", () => s().moveWorkItemsToBacklog([W(4)], B2, T1, "mirror", T1)],
      ["undo", () => s().undo()],
      ["undo", () => s().undo()],
      ["redo", () => s().redo()],
    ])).toMatchSnapshot();
  });

  it("under another item, step by step", async () => {
    expect(await run([
      ["w3 under w1", () => s().reparentWorkItem(W(3), W(1))],
      ["w7 under w4, at rank 0", () => s().reparentWorkItem(W(7), W(4), T1, B1, undefined, 0)],
      ["w2 to the top level", () => s().reparentWorkItem(W(2), null, T1, B1)],
      ["w6 from b2 under w1 in b1", () => s().reparentWorkItem(W(6), W(1), T1, B1)],
      ["w4 with w8 under it, under w6 in b2", () => s().reparentWorkItem(W(4), W(6), T1, B2)],
      ["w9 under w8 in tree two, moved there", () => s().reparentWorkItem(W(9), W(8), T2, B3, "move-to-tree")],
      ["w5 under w8 in tree two, mirrored", () => s().reparentWorkItem(W(5), W(8), T2, B3, "mirror")],
      ["w1 under its own grandchild (refused)", () => s().reparentWorkItem(W(1), W(3))],
      ["undo", () => s().undo()],
      ["undo", () => s().undo()],
    ])).toMatchSnapshot();
  });

  it("under another item in another list, with everything under it", async () => {
    expect(await run([
      ["w1, with w2 and w3 under it, under w6 in b2", () => s().reparentWorkItem(W(1), W(6), T1, B2)],
      ["undo", () => s().undo()],
    ])).toMatchSnapshot();
  });

  it("out of a tree, step by step", async () => {
    expect(await run([
      ["w4 out of tree two", () => s().removeWorkItemFromTree(W(4), T2)],
      ["w8 out of tree one (still in two)", () => s().removeWorkItemFromTree(W(8), T1)],
      ["w2 out of tree one (its only one)", () => s().removeWorkItemFromTree(W(2), T1)],
      ["w5 and w7 out of tree one", () => s().removeWorkItemsFromTreeBulk([{ workItemId: W(5), treeId: T1 }, { workItemId: W(7), treeId: T1 }])],
      ["undo", () => s().undo()],
    ])).toMatchSnapshot();
  });

  it("duplicating, step by step", async () => {
    expect(await run([
      ["w1 with everything under it", () => s().duplicateWorkItems([W(1)])],
      ["w2 and w4, w8 under w4", () => s().duplicateWorkItems([W(2), W(4)])],
      ["w3 and its parent w2 (only the parent's copy is a root)", () => s().duplicateWorkItems([W(3), W(2)])],
      ["w9 in b1a", () => s().duplicateWorkItems([W(9)])],
      ["undo", () => s().undo()],
    ])).toMatchSnapshot();
  });
});
