/**
 * Starting from a copy of the data kept from an earlier visit, however old.
 *
 * The copy used to be thrown away after thirty minutes, so a phone — opened a
 * few times a day — almost never had one: nearly every start showed nothing
 * until every item had been downloaded again. It is now shown at once, days
 * old or not, and replaced when the fresh data lands.
 *
 * What an old copy may not be is edited. A save writes a whole item, so one
 * made from yesterday's copy would put yesterday's values back over whatever
 * changed since on another device. Until the refresh lands the store says it
 * is catching up, and the guard in the layout holds edits back.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CATCH_UP_MAX_MS, REFRESH_AFTER_EDIT_MS, useAppStore } from "@/store/appStore";
import { loadFromSupabase as loadDataFromSupabase } from "@/store/supabaseSync";
import { DATA_CACHE_FRESH_MS, DATA_CACHE_TTL_MS } from "@/store/appDataCache";

vi.mock("@/store/supabaseSync", () => ({
  loadFromSupabase: vi.fn(),
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
vi.mock("@/store/changeLog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/changeLog")>()),
  loadChangeLog: vi.fn().mockResolvedValue([]),
  insertChangeLogEntry: vi.fn().mockResolvedValue(undefined),
}));

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

let orgCounter = 0;
function freshOrg() {
  const org = `old-copy-org-${++orgCounter}`;
  return { org, tree: `${org}::tree-1`, backlog: `${org}::backlog-1`, item: `${org}::item-1` };
}
type Ids = ReturnType<typeof freshOrg>;

const structure = ({ tree, backlog }: Ids) => ({
  backlogTrees: { [tree]: { id: tree, name: "Tree", rootBacklogIds: [backlog], rank: 0, pointsEnabled: null } },
  backlogs: {
    [backlog]: {
      id: backlog, name: "List", parentId: null, childrenIds: [], treeId: tree,
      rank: 0, boardHiddenStatusKeys: [], viewMode: "list" as const,
    },
  },
});
const items = ({ org, tree, backlog, item }: Ids, title: string) => ({
  [item]: {
    id: item, title, status: "not_started" as const, parentId: null, childrenIds: [],
    backlogAssignments: { [tree]: backlog }, ranks: { [backlog]: 0 }, boardRanks: {}, organizationId: org,
  },
});

/** A kept copy, written this long ago. */
function keepCopy(ids: Ids, title: string, age: number) {
  localStorage.setItem(
    `cached_app_data_${ids.org}`,
    JSON.stringify({
      orgId: ids.org,
      ...structure(ids),
      workItems: items(ids, title),
      hyperlinks: {},
      changeLog: [],
      selectedBacklogIds: [ids.backlog],
      selectedTreeId: ids.tree,
      selectedWorkItemIds: [],
      timestamp: Date.now() - age,
    }),
  );
}

/** A fetch that answers only when let go. */
function heldFetch(ids: Ids, title: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  vi.mocked(loadDataFromSupabase).mockImplementation((async () => {
    await gate;
    return { ...structure(ids), workItems: items(ids, title) };
  }) as never);
  return release;
}

async function until(predicate: () => boolean, label: string) {
  for (let i = 0; i < 400; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const state = () => useAppStore.getState();

beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadDataFromSupabase).mockReset();
  useAppStore.setState({
    workItems: {}, backlogs: {}, backlogTrees: {}, hyperlinks: {},
    selectedBacklogIds: [], selectedTreeId: null, selectedWorkItemIds: [],
    changeLog: [], expandedWorkItems: new Set(), expandedBacklogs: new Set(),
    undoStack: [], redoStack: [],
    isLoading: false, workItemsLoading: false, workItemsRefreshing: false, catchingUp: false,
    loadingProgress: 0, organizationId: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a kept copy", () => {
  it("is kept for a month, not half an hour", () => {
    expect(DATA_CACHE_TTL_MS).toBeGreaterThanOrEqual(30 * DAY);
    expect(DATA_CACHE_FRESH_MS).toBe(30 * MINUTE);
  });

  it("is on the screen at once though it is days old, and cannot be edited until the fresh data lands", async () => {
    const ids = freshOrg();
    keepCopy(ids, "As it was on Tuesday", 3 * DAY);
    const release = heldFetch(ids, "As it is now");
    useAppStore.setState({ organizationId: ids.org });

    void state().loadFromSupabase();
    await until(() => !!state().workItems[ids.item], "the kept copy to be shown");

    // Shown, with nothing fetched yet — and held.
    expect(state().workItems[ids.item].title).toBe("As it was on Tuesday");
    expect(state().isLoading).toBe(false);
    expect(state().catchingUp).toBe(true);

    release();
    await until(() => state().workItems[ids.item]?.title === "As it is now", "the fresh data to land");
    await until(() => !state().catchingUp, "edits to be let through");
    expect(state().workItemsRefreshing).toBe(false);
  });

  it("holds nothing back when it is only minutes old", async () => {
    const ids = freshOrg();
    keepCopy(ids, "A moment ago", 5 * MINUTE);
    const release = heldFetch(ids, "Now");
    useAppStore.setState({ organizationId: ids.org });

    void state().loadFromSupabase();
    await until(() => !!state().workItems[ids.item], "the kept copy to be shown");
    expect(state().catchingUp).toBe(false);

    release();
    await until(() => state().workItems[ids.item]?.title === "Now", "the fresh data to land");
  });

  // The two below are about waiting, so the clock is theirs to move.
  async function advanceUntil(predicate: () => boolean, label: string) {
    for (let i = 0; i < 600; i++) {
      if (predicate()) return;
      await vi.advanceTimersByTimeAsync(5);
    }
    throw new Error(`timed out waiting for: ${label}`);
  }

  it("lets edits through after a while if the fresh data never comes, so being offline does not lock the app", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ids = freshOrg();
    keepCopy(ids, "All there is", 2 * DAY);
    heldFetch(ids, "Never arrives");
    useAppStore.setState({ organizationId: ids.org });

    void state().loadFromSupabase();
    await advanceUntil(() => state().catchingUp, "the hold to start");

    await vi.advanceTimersByTimeAsync(CATCH_UP_MAX_MS - 100);
    expect(state().catchingUp).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(state().catchingUp).toBe(false);
    expect(state().workItems[ids.item].title).toBe("All there is");
  });

  it("is refreshed again when the first refresh came back in the middle of an edit", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const ids = freshOrg();
    keepCopy(ids, "A moment ago", 5 * MINUTE);
    const release = heldFetch(ids, "From the server");
    useAppStore.setState({ organizationId: ids.org });

    void state().loadFromSupabase();
    await advanceUntil(() => !!state().workItems[ids.item], "the kept copy to be shown");
    // An edit while the fetch is out: its result must not be undone by it.
    state().renameWorkItem(ids.item, "Renamed on this phone");
    release();
    await advanceUntil(() => !state().workItemsRefreshing, "the first refresh to finish");
    expect(state().workItems[ids.item].title).toBe("Renamed on this phone");
    expect(vi.mocked(loadDataFromSupabase)).toHaveBeenCalledTimes(1);

    // And then it asks again by itself, rather than staying on the older data.
    vi.mocked(loadDataFromSupabase).mockResolvedValue({
      ...structure(ids),
      workItems: items(ids, "Renamed on this phone, and saved"),
    } as never);
    await vi.advanceTimersByTimeAsync(REFRESH_AFTER_EDIT_MS);
    await advanceUntil(() => vi.mocked(loadDataFromSupabase).mock.calls.length === 2, "a second refresh");
    await advanceUntil(() => state().workItems[ids.item]?.title === "Renamed on this phone, and saved", "it to be applied");
  });
});
