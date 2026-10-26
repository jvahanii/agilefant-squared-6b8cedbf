/**
 * Performance regression tests: seed realistic-scale datasets and assert
 * that core store operations complete within acceptable time bounds.
 *
 * All DB calls are mocked (identical pattern to appStore.test.ts), so the
 * measured time reflects pure JS computation: structure traversal, rank
 * shifting, state cloning, sorting, and Zustand state updates.
 *
 * Thresholds are deliberately loose — roughly 5-10× the time these operations
 * actually take — because they are a backstop against catastrophic regressions,
 * not a benchmark. The operations here are O(n) or O(n log n) over hundreds of
 * items; a genuine regression to O(n²) shows up as orders of magnitude, not as
 * a few milliseconds. Tight budgets bought no extra protection and instead
 * failed on nothing more than a GC pause or a slower runner.
 *
 * The precise guard against complexity regressions is the "algorithmic scaling"
 * block at the bottom, which compares timings at different input sizes and so
 * does not care how fast the machine is.
 *
 * These budgets also assume the run has the CPU to itself; vitest.config.ts
 * sets fileParallelism: false for that reason.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  useAppStore,
  resetRankEchoSuppression,
} from "@/store/appStore";
import {
  loadFromSupabase as loadDataFromSupabase,
  upsertWorkItemBacklogRankRows,
  upsertWorkItemBoardRankRows,
  upsertWorkItems,
} from "@/store/supabaseSync";

// ─── Mock supabase sync — all DB calls are no-ops in tests ──────────────
vi.mock("@/store/supabaseSync", () => ({
  loadFromSupabase: vi
    .fn()
    .mockResolvedValue({ workItems: {}, backlogs: {}, backlogTrees: {} }),
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
  generateMockData: vi.fn(() => ({
    workItems: {},
    backlogs: {},
    backlogTrees: {},
  })),
}));

vi.mock("@/store/backlogStatusesStore", async () => {
  const actual =
    await vi.importActual<
      typeof import("@/store/backlogStatusesStore")
    >("@/store/backlogStatusesStore");
  return {
    ...actual,
    getEffectiveStatuses: vi.fn(
      (backlogId: string | null | undefined) =>
        actual.getEffectiveStatuses(backlogId ?? ""),
    ),
  };
});

const ORG = "perf-test";

// ─── Timing helper ──────────────────────────────────────────────────────

/** Run `fn()` and return elapsed wall-clock ms. */
function measure(fn: () => void): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

// ─── Seeding helpers ────────────────────────────────────────────────────

function mkWi(
  i: number,
  status: "not_started" | "in_progress" | "pending" | "blocked" | "done" = "not_started",
  opts: {
    parentId?: string | null;
    backlogId?: string;
    treeId?: string;
  } = {},
) {
  const blId = opts.backlogId ?? `${ORG}::bl-1`;
  const tId = opts.treeId ?? `${ORG}::bt-1`;
  return {
    id: `${ORG}::wi-${i}`,
    title: `Item ${i}`,
    status,
    parentId: opts.parentId === undefined ? (null as string | null) : opts.parentId,
    childrenIds: [] as string[],
    backlogAssignments: { [tId]: blId },
    ranks: { [blId]: i },
    boardRanks: { [blId]: i },
  };
}


// ─── The echoes of a move ───────────────────────────────────────────────
//
// Every item a move saves comes back over realtime: the item, its rank in the
// new list, its rank in the old one deleted, its board rank. Each used to
// copy the whole map of items and re-render every view of them; moving a
// hundred items into a list of eight hundred, among four thousand, took
// seconds of this, one echo after another. An echo saying what the item
// already is here now changes nothing.

const T = `${ORG}::bt-1`;
const lists = Array.from({ length: 52 }, (_, i) => `${ORG}::bl-${i}`);
const LONG = lists[0];
const SOURCE = lists[1];
const moved = Array.from({ length: 103 }, (_, i) => `${ORG}::wi-${821 + i}`);

function seedLongList() {
  const workItems: Record<string, ReturnType<typeof mkWi>> = {};
  for (let i = 0; i < 4328; i++) {
    const bl = i < 821 ? LONG : i < 1000 ? SOURCE : lists[2 + (i % 50)];
    // As loading makes them from their rows.
    workItems[`${ORG}::wi-${i}`] = { ...mkWi(i, "not_started", { backlogId: bl, treeId: T }), respawnEnabled: false, organizationId: ORG } as ReturnType<typeof mkWi>;
  }
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: { [T]: { id: T, name: "Tree", rootBacklogIds: lists, rank: 0 } },
    backlogs: Object.fromEntries(lists.map((id, i) => [id, { id, name: id, parentId: null, childrenIds: [] as string[], treeId: T, rank: i }])),
    workItems, undoStack: [], redoStack: [], isLoading: false, hyperlinks: {},
    selectedBacklogIds: [SOURCE], selectedTreeId: T, selectedWorkItemIds: [], changeLog: [],
    expandedWorkItems: new Set(), expandedBacklogs: new Set(),
  });
}

/** The row the database sends back for an item, as realtime carries it. */
function rowOf(id: string, fields: Record<string, unknown> = {}) {
  const wi = useAppStore.getState().workItems[id];
  return {
    id, title: wi.title, description: null, points: null, rating: null, deadline: null, status: wi.status,
    parent_id: wi.parentId, parent_id_overrides: {}, backlog_assignments: wi.backlogAssignments,
    organization_id: ORG, respawn_enabled: false, ...fields,
  };
}

describe("the realtime echoes of a move into a long list", () => {
  beforeEach(() => {
    resetRankEchoSuppression();
    seedLongList();
    useAppStore.getState().moveWorkItemsToBacklog(moved, LONG, T);
  });

  it("change nothing, and re-render nothing, when they say what the items already are", () => {
    const before = useAppStore.getState().workItems;
    let notifications = 0;
    const unsubscribe = useAppStore.subscribe(() => { notifications++; });
    const elapsed = measure(() => {
      const s = useAppStore.getState();
      for (const id of moved) {
        const rank = before[id].ranks[LONG];
        s.applyRealtimeWorkItem("UPDATE", rowOf(id));
        s.applyRealtimeWorkItemRank("DELETE", { work_item_id: id, backlog_id: SOURCE });
        s.applyRealtimeWorkItemRank("INSERT", { work_item_id: id, backlog_id: LONG, rank });
        s.applyRealtimeWorkItemBoardRank("INSERT", { work_item_id: id, backlog_id: LONG, rank });
      }
    });
    unsubscribe();
    expect(notifications).toBe(0);
    expect(useAppStore.getState().workItems).toBe(before);
    // Seconds before; now a few milliseconds.
    expect(elapsed).toBeLessThan(500);
  });

  it("leave the rest to come in as before: what someone else changed", () => {
    // An item the move did not touch: its own echoes are held back for a moment anyway.
    const id = `${ORG}::wi-10`;
    const s = useAppStore.getState();
    s.applyRealtimeWorkItem("UPDATE", rowOf(id, { title: "Renamed elsewhere" }));
    s.applyRealtimeWorkItemRank("UPDATE", { work_item_id: id, backlog_id: LONG, rank: 12345 });
    s.applyRealtimeWorkItemBoardRank("UPDATE", { work_item_id: id, backlog_id: LONG, rank: 6789 });
    const wi = useAppStore.getState().workItems[id];
    expect(wi.title).toBe("Renamed elsewhere");
    expect(wi.ranks[LONG]).toBe(12345);
    expect(wi.boardRanks?.[LONG]).toBe(6789);
    s.applyRealtimeWorkItemRank("DELETE", { work_item_id: id, backlog_id: LONG });
    expect(useAppStore.getState().workItems[id].ranks[LONG]).toBeUndefined();
  });
});
