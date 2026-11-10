/**
 * Performance regression tests: seed realistic-scale datasets and check that
 * core store operations stay fast, and that their cost grows with the data as
 * it should.
 *
 * All DB calls are mocked (identical pattern to appStore.test.ts), so the
 * measured time reflects pure JS computation: structure traversal, rank
 * shifting, state cloning, sorting, and Zustand state updates.
 *
 * Milliseconds alone said too little: the same operation took 5-8× longer
 * whenever the machine was busy, and the tests failed with nothing changed.
 * So each operation is timed against a reference: a fixed piece of work like
 * the store's own, timed just before it on the same machine. A busy or slower
 * machine slows both, and the budgets are in multiples of the reference. The
 * median of several runs counts, which leaves out a moment's hiccup either way.
 *
 * Before each run, what the previous one started is let finish and the garbage
 * is collected, so that one test's leftovers do not slow down the next.
 *
 * The budgets are loose, several times what the operations take, because they
 * are a backstop against catastrophic regressions, not a benchmark. The precise
 * guard against complexity regressions is the "algorithmic scaling" block at
 * the bottom, which compares the same operation at sizes 4× apart and so does
 * not care how fast the machine is.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
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

// ─── Timing ─────────────────────────────────────────────────────────────

/** How many times each operation is timed. */
const RUNS = 5;

/**
 * Collects the garbage now. Node allows it only when started with
 * --expose-gc, but the flag can also be set from here, without changing how
 * the tests are run.
 */
setFlagsFromString("--expose-gc");
const collectGarbage = runInNewContext("gc") as () => void;

/**
 * Lets what an operation started run to its end, as it would in a browser
 * before the next click: the callbacks of its (mocked) saves. Until then they
 * hold on to what they save, and timed back to back, 500 adds left over 100 MB
 * that no collection could free.
 */
const settleStoreWork = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * The reference: a fixed piece of work like the store's own, sorting items by
 * rank and looking each one up by id, over items built once beforehand. It
 * allocates almost nothing, so it does not pay for collecting the garbage an
 * operation timed just before it left behind.
 */
const REFERENCE_ITEMS = Array.from({ length: 4000 }, (_, i) => ({ id: `ref::wi-${i}`, rank: (i * 7919) % 4000 }));
const REFERENCE_INDEX = new Map(REFERENCE_ITEMS.map((w) => [w.id, w]));
let referenceSink = 0;

function referenceWork() {
  for (let pass = 0; pass < 3; pass++) {
    const order = REFERENCE_ITEMS.slice().sort((a, b) => a.rank - b.rank);
    for (const w of order) referenceSink += REFERENCE_INDEX.get(w.id)!.rank;
  }
}

interface Timing {
  /** The operation's best time. */
  ms: number;
  /** The reference's median time. */
  referenceMs: number;
  /** The operation's time in references: the median of the runs. */
  references: number;
}

const median = (xs: number[]) => [...xs].sort((x, y) => x - y)[Math.floor(xs.length / 2)];

/**
 * Times `op` `runs` times, each run from a fresh `prepare()`, which is not
 * timed, and each right after the reference. A run's time in references is
 * from the same moment, so it does not matter that the machine is slower at
 * one moment than at another: this one runs at a third of its speed after a few
 * seconds at full load. The state the last run leaves is there to check
 * afterwards.
 */
async function timeAgainstReference<T>(
  prepare: () => T,
  op: (prepared: T) => unknown,
  runs = RUNS,
): Promise<Timing> {
  const opMs: number[] = [];
  const referenceMs: number[] = [];
  for (let i = 0; i < runs; i++) {
    const prepared = prepare();
    collectGarbage();
    let t0 = performance.now();
    referenceWork();
    referenceMs.push(performance.now() - t0);
    t0 = performance.now();
    const result = op(prepared);
    if (result instanceof Promise) await result;
    opMs.push(performance.now() - t0);
    await settleStoreWork();
  }
  return {
    ms: Math.min(...opMs),
    referenceMs: median(referenceMs),
    references: median(opMs.map((ms, i) => ms / referenceMs[i])),
  };
}

/** For a failure's message: what was measured. */
const measured = (t: Timing) =>
  `${t.ms.toFixed(1)} ms, ${t.references.toFixed(2)}× the reference's ${t.referenceMs.toFixed(1)} ms`;

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

/** Set PERF_REPORT=1 to print each operation's timing, e.g. to revisit the budgets. */
function report(name: string, t: Timing) {
  if (process.env.PERF_REPORT) console.log(`PERF ${name}: ${measured(t)}`);
}

/** 2 000 items in 50 lists across 5 trees, as the database would return them. */
function largeLoad() {
  const data = {
    workItems: {} as Record<string, ReturnType<typeof mkWi> & { boardRanks: Record<string, number> }>,
    backlogs: {} as Record<
      string,
      { id: string; name: string; parentId: string | null; childrenIds: string[]; treeId: string; rank: number }
    >,
    backlogTrees: {} as Record<string, { id: string; name: string; rootBacklogIds: string[]; rank: number }>,
  };
  for (let i = 0; i < 5; i++) {
    const tId = `${ORG}::bt-${i}`;
    data.backlogTrees[tId] = { id: tId, name: `Tree ${i}`, rootBacklogIds: [], rank: i };
  }
  for (let i = 0; i < 50; i++) {
    const bId = `${ORG}::bl-${i}`;
    const tId = `${ORG}::bt-${i % 5}`;
    data.backlogs[bId] = { id: bId, name: `BL ${i}`, parentId: null, childrenIds: [], treeId: tId, rank: i };
    data.backlogTrees[tId].rootBacklogIds.push(bId);
  }
  for (let i = 0; i < 2000; i++) {
    const blIdx = i % 50;
    const bId = `${ORG}::bl-${blIdx}`;
    const wi = mkWi(i, "not_started", { backlogId: bId, treeId: `${ORG}::bt-${blIdx % 5}` });
    data.workItems[wi.id] = { ...wi, boardRanks: { [bId]: i } };
  }
  return data;
}

/** An empty list in an empty tree. */
function seedEmptyList() {
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: {
      [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
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
}

const reorder = (id: string, to: number) =>
  useAppStore.getState().reorderWorkItemAmongSiblings(`${ORG}::wi-${id}`, to, `${ORG}::bt-1`, [`${ORG}::bl-1`]);

/** The runs for the two operations that take most of a second or more each. */
const SLOW_RUNS = 3;

/**
 * Each test's time limit. The budgets, not vitest's 5 s limit, say what is too
 * slow: with every core of the machine busy, a test here took up to 40 s.
 */
const TEST_TIMEOUT_MS = 180_000;

/**
 * Each operation's budget, in references: about 4× the most it took on a
 * developer laptop, idle and with all 16 cores busy, which is noted beside it.
 */
const BUDGET = {
  add500: 1000, // 170-262
  reorderDown: 15, // 1.6-3.8
  reorderUp: 10, // 1.4-2.1
  promoteChain: 15, // 2.0-3.3
  boardReorder: 4, // 0.46-0.92
  undo10: 6, // 0.90-1.3
  load2000: 35, // 3.6-8.7
  insertAtTop500: 2000, // 300-510
  duplicateTree: 2, // 0.16-0.34
};

describe("performance: large dataset operations", { timeout: TEST_TIMEOUT_MS }, () => {

  it("adds 500 items", async () => {
    const t = await timeAgainstReference(
      () => seedFlatItems(0), // just the structure, no items
      () => {
        const store = useAppStore.getState();
        for (let i = 0; i < 500; i++) store.addWorkItem(`Item ${i}`, null, `${ORG}::bl-1`, `${ORG}::bt-1`);
      },
      SLOW_RUNS,
    );
    report("add 500", t);
    expect(t.references, measured(t)).toBeLessThan(BUDGET.add500);
    expect(Object.keys(useAppStore.getState().workItems)).toHaveLength(500);
  });

  // ── Large reorder ───────────────────────────────────────────────────

  it("reorders an item from top to bottom in a 1 000-item list", async () => {
    const t = await timeAgainstReference(() => seedFlatItems(1000), () => reorder("0", 1000));
    report("reorder top to bottom", t);
    expect(t.references, measured(t)).toBeLessThan(BUDGET.reorderDown);
  });

  it("reorders the last item to first in a 1 000-item list", async () => {
    const t = await timeAgainstReference(() => seedFlatItems(1000), () => reorder("999", 0));
    report("reorder bottom to top", t);
    expect(t.references, measured(t)).toBeLessThan(BUDGET.reorderUp);
  });

  // ── Status change with auto-promotion ───────────────────────────────

  it("promotes a 200-level deep chain", async () => {
    const t = await timeAgainstReference(
      () => seedDeepChain(200),
      () => useAppStore.getState().setWorkItemStatus(`${ORG}::wi-199`, "in_progress"),
    );
    report("promote 200-deep chain", t);
    expect(t.references, measured(t)).toBeLessThan(BUDGET.promoteChain);
    // The root was promoted
    expect(useAppStore.getState().workItems[`${ORG}::wi-0`].status).toBe("in_progress");
  });

  // ── Board reorder at scale ──────────────────────────────────────────

  it("reorders within a specific status column in 500 mixed-status items", async () => {
    // Move wi-5 (not_started) to index 0 of the not_started column
    const t = await timeAgainstReference(
      () => seedMultiStatus(500),
      () =>
        useAppStore
          .getState()
          .reorderWorkItemInBoard(`${ORG}::wi-5`, 0, `${ORG}::bt-1`, [`${ORG}::bl-1`], "not_started"),
    );
    report("board reorder", t);
    expect(t.references, measured(t)).toBeLessThan(BUDGET.boardReorder);

    // Verify not_started column: wi-5 is now first
    const notStartedItems = Object.values(useAppStore.getState().workItems)
      .filter((w) => w.status === "not_started")
      .sort((a, b) => (a.boardRanks?.[`${ORG}::bl-1`] ?? 0) - (b.boardRanks?.[`${ORG}::bl-1`] ?? 0));
    expect(notStartedItems[0].title).toBe("Item 5");
  });

  // ── Bulk undo ───────────────────────────────────────────────────────

  it("undoes 10 runBulk operations on a 500-item set", async () => {
    const t = await timeAgainstReference(
      () => {
        seedFlatItems(500);
        const store = useAppStore.getState();
        for (let op = 0; op < 10; op++) {
          store.runBulk(() => {
            store.setWorkItemStatus(`${ORG}::wi-${op * 3}`, "done");
            store.setWorkItemStatus(`${ORG}::wi-${op * 3 + 1}`, "in_progress");
            store.setWorkItemStatus(`${ORG}::wi-${op * 3 + 2}`, "blocked");
          });
        }
      },
      () => {
        for (let i = 0; i < 10; i++) useAppStore.getState().undo();
      },
    );
    report("undo 10 bulk", t);
    expect(t.references, measured(t)).toBeLessThan(BUDGET.undo10);

    // All items should be back to not_started
    expect(Object.values(useAppStore.getState().workItems).every((w) => w.status === "not_started")).toBe(true);
  });

  // ── Load from Supabase ──────────────────────────────────────────────

  it("loads 2 000 items, 50 lists, and 5 trees", async () => {
    const t = await timeAgainstReference(
      () => {
        vi.mocked(loadDataFromSupabase).mockResolvedValueOnce(largeLoad() as never);
        useAppStore.setState({ organizationId: ORG, isLoading: false, workItems: {}, backlogs: {}, backlogTrees: {} });
      },
      () => useAppStore.getState().loadFromSupabase(),
    );
    report("load 2 000", t);
    expect(t.references, measured(t)).toBeLessThan(BUDGET.load2000);
    expect(Object.keys(useAppStore.getState().workItems)).toHaveLength(2000);
  });

  // ── Rank normalization ──────────────────────────────────────────────

  it("normalizes ranks after inserting 500 items at the top", async () => {
    // Insert items one by one at rank 0 — this forces rank shifting + eventual normalization
    const t = await timeAgainstReference(
      seedEmptyList,
      () => {
        const store = useAppStore.getState();
        for (let i = 0; i < 500; i++) store.addWorkItem(`Item ${i}`, null, `${ORG}::bl-1`, `${ORG}::bt-1`, 0);
      },
      SLOW_RUNS,
    );
    report("insert 500 at top", t);
    expect(t.references, measured(t)).toBeLessThan(BUDGET.insertAtTop500);

    // All ranks should be consecutive integers 0..499
    const ranks = Object.values(useAppStore.getState().workItems)
      .map((w) => w.ranks[`${ORG}::bl-1`])
      .sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: 500 }, (_, i) => i));
  });

  // ── Duplicate deep tree ─────────────────────────────────────────────

  it("duplicates a seeded nested tree", async () => {
    let initialCount = 0;
    const t = await timeAgainstReference(
      () => {
        seedNestedTree(3, 17); // ~17 leaves × 3 levels
        initialCount = Object.keys(useAppStore.getState().workItems).length;
        const rootId = Object.values(useAppStore.getState().workItems).find((w) => w.parentId === null)?.id;
        expect(rootId).toBeDefined();
        return rootId!;
      },
      (rootId) => useAppStore.getState().duplicateWorkItems([rootId]),
    );
    report("duplicate tree", t);
    expect(t.references, measured(t)).toBeLessThan(BUDGET.duplicateTree);

    // The duplicate should add another copy of the selected subtree.
    expect(Object.keys(useAppStore.getState().workItems).length).toBeGreaterThan(initialCount);
  });
});

// ─── SCALING: quadratic / N² detection ─────────────────────────────────

/**
 * The same operation at a size and at 4× that size, each in references, so
 * that the machine slowing down between the two does not count as growth.
 * Linear growth takes at most about 4× as long (2.3-3.8× measured, as each
 * operation also has a part that does not grow); quadratic growth takes up to
 * 16×. A lookup over every item for each item, planted in reordering, measured
 * 10×. A limit of 8 tells them apart with twice the room linear growth needs.
 */
const SCALING_LIMIT = 8;

async function growth(seed: (n: number) => void, op: (n: number) => void, n: number) {
  const small = await timeAgainstReference(() => seed(n), () => op(n));
  const large = await timeAgainstReference(() => seed(4 * n), () => op(4 * n));
  return { small, large, ratio: large.references / small.references };
}

const grew = (g: Awaited<ReturnType<typeof growth>>) =>
  `${g.small.references.toFixed(2)} → ${g.large.references.toFixed(2)} references: ${g.ratio.toFixed(1)}×`;

describe("performance: algorithmic scaling", { timeout: TEST_TIMEOUT_MS }, () => {
  it("reorder time grows about linearly with the number of items", async () => {
    const g = await growth(seedFlatItems, (n) => reorder("0", n), 300);
    if (process.env.PERF_REPORT) console.log(`PERF reorder growth: ${grew(g)}`);
    expect(g.ratio, grew(g)).toBeLessThan(SCALING_LIMIT);
  });

  it("status-change promotion time grows about linearly with chain depth", async () => {
    const g = await growth(
      seedDeepChain,
      (depth) => useAppStore.getState().setWorkItemStatus(`${ORG}::wi-${depth - 1}`, "done"),
      60,
    );
    if (process.env.PERF_REPORT) console.log(`PERF promotion growth: ${grew(g)}`);
    expect(g.ratio, grew(g)).toBeLessThan(SCALING_LIMIT);
  });
});
