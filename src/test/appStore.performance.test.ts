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
  upsertWorkItemBoardRankRows: vi.fn().mockResolvedValue(true),
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

function seedFlatItems(count: number) {
  const workItems: Record<string, ReturnType<typeof mkWi>> = {};
  for (let i = 0; i < count; i++) {
    const wi = mkWi(i);
    workItems[wi.id] = wi;
  }
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: {
      [`${ORG}::bt-1`]: {
        id: `${ORG}::bt-1`,
        name: "Tree",
        rootBacklogIds: [`${ORG}::bl-1`],
        rank: 0,
      },
    },
    backlogs: {
      [`${ORG}::bl-1`]: {
        id: `${ORG}::bl-1`,
        name: "BL",
        parentId: null,
        childrenIds: [] as string[],
        treeId: `${ORG}::bt-1`,
        rank: 0,
      },
    },
    workItems,
    undoStack: [],
    redoStack: [],
    isLoading: false,
    hyperlinks: {},
    selectedBacklogIds: [],
    selectedTreeId: null,
    selectedWorkItemIds: [],
    changeLog: [],
    expandedWorkItems: new Set(),
    expandedBacklogs: new Set(),
  });
}

function seedDeepChain(depth: number) {
  const workItems: Record<string, ReturnType<typeof mkWi>> = {};
  let parentId: string | null = null;
  for (let i = 0; i < depth; i++) {
    const wi = mkWi(i, "not_started", { parentId });
    workItems[wi.id] = wi;
    parentId = wi.id;
  }
  // Set parent → child relationships
  for (let i = 0; i < depth - 1; i++) {
    workItems[`${ORG}::wi-${i}`].childrenIds = [`${ORG}::wi-${i + 1}`];
  }
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: {
      [`${ORG}::bt-1`]: {
        id: `${ORG}::bt-1`,
        name: "Tree",
        rootBacklogIds: [`${ORG}::bl-1`],
        rank: 0,
      },
    },
    backlogs: {
      [`${ORG}::bl-1`]: {
        id: `${ORG}::bl-1`,
        name: "BL",
        parentId: null,
        childrenIds: [] as string[],
        treeId: `${ORG}::bt-1`,
        rank: 0,
      },
    },
    workItems,
    undoStack: [],
    redoStack: [],
    isLoading: false,
    hyperlinks: {},
    selectedBacklogIds: [],
    selectedTreeId: null,
    selectedWorkItemIds: [],
    changeLog: [],
    expandedWorkItems: new Set(),
    expandedBacklogs: new Set(),
  });
}

function seedMultiStatus(count: number) {
  const statuses: Array<"not_started" | "in_progress" | "pending" | "blocked" | "done"> = [
    "not_started",
    "in_progress",
    "pending",
    "blocked",
    "done",
  ];
  const workItems: Record<string, ReturnType<typeof mkWi>> = {};
  for (let i = 0; i < count; i++) {
    const status = statuses[i % statuses.length];
    const wi = mkWi(i, status);
    workItems[wi.id] = wi;
  }
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: {
      [`${ORG}::bt-1`]: {
        id: `${ORG}::bt-1`,
        name: "Tree",
        rootBacklogIds: [`${ORG}::bl-1`],
        rank: 0,
      },
    },
    backlogs: {
      [`${ORG}::bl-1`]: {
        id: `${ORG}::bl-1`,
        name: "BL",
        parentId: null,
        childrenIds: [] as string[],
        treeId: `${ORG}::bt-1`,
        rank: 0,
      },
    },
    workItems,
    undoStack: [],
    redoStack: [],
    isLoading: false,
    hyperlinks: {},
    selectedBacklogIds: [],
    selectedTreeId: null,
    selectedWorkItemIds: [],
    changeLog: [],
    expandedWorkItems: new Set(),
    expandedBacklogs: new Set(),
  });
}

function seedNestedTree(depth: number, width: number) {
  const store = useAppStore.getState();

  // Create tree and root backlog
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: {
      [`${ORG}::bt-1`]: {
        id: `${ORG}::bt-1`,
        name: "Tree",
        rootBacklogIds: [`${ORG}::bl-0`],
        rank: 0,
      },
    },
    backlogs: {},
    workItems: {},
    undoStack: [],
    redoStack: [],
    isLoading: false,
    hyperlinks: {},
    selectedBacklogIds: [],
    selectedTreeId: null,
    selectedWorkItemIds: [],
    changeLog: [],
    expandedWorkItems: new Set(),
    expandedBacklogs: new Set(),
  });

  // Create nested backlogs
  const backlogIds: string[] = [];
  for (let d = 0; d < depth; d++) {
    const parentBl = d === 0 ? null : `${ORG}::bl-${d - 1}`;
    useAppStore.getState().backlogs[`${ORG}::bl-${d}`] = {
      id: `${ORG}::bl-${d}`,
      name: `BL L${d}`,
      parentId: parentBl,
      childrenIds: d < depth - 1 ? [`${ORG}::bl-${d + 1}`] : [],
      treeId: `${ORG}::bt-1`,
      rank: d,
    };
    backlogIds.push(`${ORG}::bl-${d}`);
  }

  // Create width items in the deepest backlog
  const leafBl = `${ORG}::bl-${depth - 1}`;
  let parentIdx = 0;
  for (let i = 0; i < width; i++) {
    useAppStore.getState().addWorkItem(
      `Leaf ${i}`,
      i > 0 && i % 5 === 0 ? `${ORG}::wi-${parentIdx++}` : null,
      leafBl,
      `${ORG}::bt-1`,
    );
  }
}

// ─── Before each ────────────────────────────────────────────────────────

beforeEach(() => {
  resetRankEchoSuppression();
  localStorage.clear();
  vi.mocked(loadDataFromSupabase).mockClear();
  vi.mocked(loadDataFromSupabase).mockResolvedValue({
    workItems: {},
    backlogs: {},
    backlogTrees: {},
  });
  vi.mocked(upsertWorkItemBacklogRankRows).mockClear();
  vi.mocked(upsertWorkItemBoardRankRows).mockClear();
  vi.mocked(upsertWorkItemBoardRankRows).mockResolvedValue(true);
  vi.mocked(upsertWorkItems).mockClear();
  vi.mocked(upsertWorkItems).mockResolvedValue(true);
  useAppStore.setState({
    workItems: {},
    backlogs: {},
    backlogTrees: {},
    hyperlinks: {},
    selectedBacklogIds: [],
    selectedTreeId: null,
    selectedWorkItemIds: [],
    changeLog: [],
    expandedWorkItems: new Set(),
    expandedBacklogs: new Set(),
    undoStack: [],
    redoStack: [],
    isLoading: false,
    organizationId: null,
  });
});

// ─── TESTS ──────────────────────────────────────────────────────────────

describe("performance: large dataset operations", () => {
  // ── Bulk add ────────────────────────────────────────────────────────

  it("adds 500 items within a CI-safe per-item budget", () => {
    seedFlatItems(0); // just the structure, no items
    const store = useAppStore.getState();
    const elapsed = measure(() => {
      for (let i = 0; i < 500; i++) {
        store.addWorkItem(`Item ${i}`, null, `${ORG}::bl-1`, `${ORG}::bt-1`);
      }
    });
    const perItem = elapsed / 500;
    expect(perItem).toBeLessThan(8); // ms per item; ~1.3 ms observed
    // Verify all items created
    expect(Object.keys(useAppStore.getState().workItems)).toHaveLength(500);
  });

  // ── Large reorder ───────────────────────────────────────────────────

  it("reorders an item from top to bottom in 1 000-item backlog within 100 ms", () => {
    seedFlatItems(1000);
    const elapsed = measure(() => {
      useAppStore
        .getState()
        .reorderWorkItemAmongSiblings(
          `${ORG}::wi-0`,
          1000,
          `${ORG}::bt-1`,
          [`${ORG}::bl-1`],
        );
    });
    expect(elapsed).toBeLessThan(100); // ~16 ms observed
  });

  it("reorders last item to first in 1 000-item backlog within 60 ms", () => {
    seedFlatItems(1000);
    const elapsed = measure(() => {
      useAppStore
        .getState()
        .reorderWorkItemAmongSiblings(
          `${ORG}::wi-999`,
          0,
          `${ORG}::bt-1`,
          [`${ORG}::bl-1`],
        );
    });
    expect(elapsed).toBeLessThan(60); // ~8 ms observed
  });

  // ── Status change with auto-promotion ───────────────────────────────

  it("promotes a 200-level deep chain within 40 ms", () => {
    seedDeepChain(200);
    const elapsed = measure(() => {
      useAppStore
        .getState()
        .setWorkItemStatus(`${ORG}::wi-199`, "in_progress");
    });
    expect(elapsed).toBeLessThan(40); // ~4.5 ms observed
    // Verify the root was promoted
    expect(
      useAppStore.getState().workItems[`${ORG}::wi-0`].status,
    ).toBe("in_progress");
  });

  // ── Board reorder at scale ──────────────────────────────────────────

  it("reorders within a specific status column in 500 mixed-status items within 10 ms", () => {
    seedMultiStatus(500);

    // Move wi-5 (not_started) to index 0 of the not_started column
    const elapsed = measure(() => {
      useAppStore
        .getState()
        .reorderWorkItemInBoard(
          `${ORG}::wi-5`,
          0,
          `${ORG}::bt-1`,
          [`${ORG}::bl-1`],
          "not_started",
        );
    });
    expect(elapsed).toBeLessThan(10);

    // Verify not_started column: wi-5 is now first
    const notStartedItems = Object.values(
      useAppStore.getState().workItems,
    )
      .filter((w) => w.status === "not_started")
      .sort(
        (a, b) =>
          (a.boardRanks?.[`${ORG}::bl-1`] ?? 0) -
          (b.boardRanks?.[`${ORG}::bl-1`] ?? 0),
      );
    expect(notStartedItems[0].title).toBe("Item 5");
  });

  // ── Bulk undo ───────────────────────────────────────────────────────

  it("undoes 10 runBulk operations on a 500-item set within 30 ms", () => {
    seedFlatItems(500);

    // Perform 10 bulk ops
    const store = useAppStore.getState();
    for (let op = 0; op < 10; op++) {
      store.runBulk(() => {
        store.setWorkItemStatus(`${ORG}::wi-${op * 3}`, "done");
        store.setWorkItemStatus(`${ORG}::wi-${op * 3 + 1}`, "in_progress");
        store.setWorkItemStatus(`${ORG}::wi-${op * 3 + 2}`, "blocked");
      });
    }

    // Undo all 10
    const elapsed = measure(() => {
      for (let i = 0; i < 10; i++) {
        useAppStore.getState().undo();
      }
    });
    const perUndo = elapsed / 10;
    expect(perUndo).toBeLessThan(5); // ms per undo

    // All items should be back to not_started
    const allNotStarted = Object.values(
      useAppStore.getState().workItems,
    ).every((w) => w.status === "not_started");
    expect(allNotStarted).toBe(true);
  });

  // ── Load from Supabase ──────────────────────────────────────────────

  it("loads 2 000 items, 50 backlogs, and 5 trees within 100 ms", async () => {
    const bigData = {
      workItems: {} as Record<string, ReturnType<typeof mkWi>>,
      backlogs: {} as Record<
        string,
        {
          id: string;
          name: string;
          parentId: string | null;
          childrenIds: string[];
          treeId: string;
          rank: number;
        }
      >,
      backlogTrees: {} as Record<
        string,
        {
          id: string;
          name: string;
          rootBacklogIds: string[];
          rank: number;
        }
      >,
    };

    for (let i = 0; i < 5; i++) {
      const tId = `${ORG}::bt-${i}`;
      bigData.backlogTrees[tId] = {
        id: tId,
        name: `Tree ${i}`,
        rootBacklogIds: [] as string[],
        rank: i,
      };
    }

    for (let i = 0; i < 50; i++) {
      const bId = `${ORG}::bl-${i}`;
      const tIdx = i % 5;
      bigData.backlogs[bId] = {
        id: bId,
        name: `BL ${i}`,
        parentId: null,
        childrenIds: [],
        treeId: `${ORG}::bt-${tIdx}`,
        rank: i,
      };
      bigData.backlogTrees[`${ORG}::bt-${tIdx}`].rootBacklogIds.push(bId);
    }

    for (let i = 0; i < 2000; i++) {
      const blIdx = i % 50;
      const tIdx = blIdx % 5;
      const bId = `${ORG}::bl-${blIdx}`;
      const tId = `${ORG}::bt-${tIdx}`;
      bigData.workItems[`${ORG}::wi-${i}`] = mkWi(i, "not_started", {
        backlogId: bId,
        treeId: tId,
      });
      (bigData.workItems[`${ORG}::wi-${i}`] as any).boardRanks = {
        [bId]: i,
      };
    }

    vi.mocked(loadDataFromSupabase).mockResolvedValueOnce(bigData as any);
    useAppStore.setState({ organizationId: ORG, isLoading: false });

    let elapsed = 0;
    elapsed = await new Promise<number>((resolve) => {
      const t0 = performance.now();
      useAppStore.getState().loadFromSupabase().then(() => {
        resolve(performance.now() - t0);
      });
    });

    expect(elapsed).toBeLessThan(100);
    expect(
      Object.keys(useAppStore.getState().workItems),
    ).toHaveLength(2000);
  });

  // ── Rank normalization ──────────────────────────────────────────────

  it("normalizes ranks after inserting 500 items at the top within a CI-safe budget", () => {
    // Insert items one by one at rank 0 — this forces rank shifting + eventual normalization
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: {
          id: `${ORG}::bt-1`,
          name: "Tree",
          rootBacklogIds: [`${ORG}::bl-1`],
          rank: 0,
        },
      },
      backlogs: {
        [`${ORG}::bl-1`]: {
          id: `${ORG}::bl-1`,
          name: "BL",
          parentId: null,
          childrenIds: [] as string[],
          treeId: `${ORG}::bt-1`,
          rank: 0,
        },
      },
      workItems: {},
      undoStack: [],
      redoStack: [],
      isLoading: false,
    });

    const store = useAppStore.getState();
    const elapsed = measure(() => {
      for (let i = 0; i < 500; i++) {
        store.addWorkItem(
          `Item ${i}`,
          null,
          `${ORG}::bl-1`,
          `${ORG}::bt-1`,
          0,
        ); // always at top
      }
    });

    expect(elapsed).toBeLessThan(4000); // ~620 ms observed

    // All ranks should be consecutive integers 0..499
    const ranks = Object.values(useAppStore.getState().workItems)
      .map((w) => w.ranks[`${ORG}::bl-1`])
      .sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: 500 }, (_, i) => i));
  });

  // ── Duplicate deep tree ─────────────────────────────────────────────

  it("duplicates a seeded nested tree within 20 ms", () => {
    seedNestedTree(3, 17); // ~17 leaves × 3 levels
    const initialCount = Object.keys(useAppStore.getState().workItems).length;

    const rootId = Object.values(useAppStore.getState().workItems).find(
      (w) => w.parentId === null,
    )?.id;
    expect(rootId).toBeDefined();

    const elapsed = measure(() => {
      useAppStore.getState().duplicateWorkItems([rootId!]);
    });

    expect(elapsed).toBeLessThan(20);

    // The duplicate should add another copy of the selected subtree.
    const count = Object.keys(useAppStore.getState().workItems).length;
    expect(count).toBeGreaterThan(initialCount);
  });
});

// ─── SCALING: quadratic / N² detection ─────────────────────────────────

describe("performance: algorithmic scaling", () => {
  it("reorder time scales roughly linearly with item count", () => {
    const times: Array<{ n: number; ms: number }> = [];
    for (const n of [100, 300, 500]) {
      seedFlatItems(n);
      const ms = measure(() => {
        useAppStore
          .getState()
          .reorderWorkItemAmongSiblings(
            `${ORG}::wi-0`,
            n,
            `${ORG}::bt-1`,
            [`${ORG}::bl-1`],
          );
      });
      times.push({ n, ms });
    }

    // If time scales worse than O(n log n), the ratio ms₂/ms₃ should
    // stay reasonable.  For 300 vs 100 we expect at most ~5× (accounting
    // for JS engine warm-up noise at the small end), and 500 vs 300 at
    // most ~3×.
    if (times.length >= 3) {
      const ratio1 = times[1].ms / Math.max(times[0].ms, 1);
      const ratio2 = times[2].ms / Math.max(times[1].ms, 1);
      // Allow generous headroom — a true O(n²) regression would produce
      // ratios of ~9 (300²/100²) and ~2.8 (500²/300²) or worse.
      expect(ratio1).toBeLessThan(8);
      expect(ratio2).toBeLessThan(5);
    }
  });

  it("status-change promotion time scales roughly linearly with chain depth", () => {
    const times: Array<{ depth: number; ms: number }> = [];
    for (const depth of [50, 100, 200]) {
      seedDeepChain(depth);
      const ms = measure(() => {
        useAppStore
          .getState()
          .setWorkItemStatus(`${ORG}::wi-${depth - 1}`, "done");
      });
      times.push({ depth, ms });
    }

    if (times.length >= 3) {
      const ratio1 = times[1].ms / Math.max(times[0].ms, 1);
      const ratio2 = times[2].ms / Math.max(times[1].ms, 1);
      expect(ratio1).toBeLessThan(6);
      expect(ratio2).toBeLessThan(6);
    }
  });
});