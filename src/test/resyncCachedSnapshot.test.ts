/**
 * A resync must not repaint the cached snapshot over live data.
 *
 * loadFromSupabase() applies the cached snapshot before fetching, which is what
 * makes a cold start paint instantly. But the cache is only written after a
 * fetch, so it lags every edit made since — and a wake-up resync calls the same
 * function. Re-parenting a few items, leaving the tab, and coming back showed
 * the old hierarchy until the fetch landed. The same apply also clears the undo
 * stacks and collapses every branch, which a resync threw away for good.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "@/store/appStore";
import { loadFromSupabase as loadDataFromSupabase } from "@/store/supabaseSync";
import { writeCachedAppData, flushCachedWrites } from "@/store/appDataCache";

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
// The background refresh fetches the change log alongside the data, and waits
// for both. Left unmocked that was a real request to Supabase — anywhere from a
// third of a second to five — which decided whether the cold-start test saw the
// refresh land inside its one-second wait. That was the whole of its flakiness.
vi.mock("@/store/changeLog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/changeLog")>()),
  loadChangeLog: vi.fn().mockResolvedValue([]),
  insertChangeLogEntry: vi.fn().mockResolvedValue(undefined),
}));

let orgCounter = 0;
function freshOrg() {
  const org = `resync-org-${++orgCounter}`;
  return { org, tree: `${org}::tree-1`, backlog: `${org}::backlog-1`, parent: `${org}::week-37`, child: `${org}::item-1` };
}

type Ids = ReturnType<typeof freshOrg>;

function structureFor({ tree, backlog }: Ids) {
  return {
    backlogTrees: {
      [tree]: { id: tree, name: "Tree", rootBacklogIds: [backlog], rank: 0, pointsEnabled: null },
    },
    backlogs: {
      [backlog]: {
        id: backlog, name: "Backlog", parentId: null, childrenIds: [], treeId: tree,
        rank: 0, boardHiddenStatusKeys: [], viewMode: "list" as const,
      },
    },
  };
}

/** The two items, with the child either at the root or under "Week 37". */
function itemsFor(ids: Ids, nested: boolean) {
  const { org, tree, backlog, parent, child } = ids;
  return {
    [parent]: {
      id: parent, title: "Week 37", status: "not_started" as const, parentId: null,
      childrenIds: nested ? [child] : [], backlogAssignments: { [tree]: backlog },
      ranks: { [backlog]: 0 }, boardRanks: {}, organizationId: org,
    },
    [child]: {
      id: child, title: "Bring the user guide up to date", status: "not_started" as const,
      parentId: nested ? parent : null, childrenIds: [], backlogAssignments: { [tree]: backlog },
      ranks: { [backlog]: 1 }, boardRanks: {}, organizationId: org,
    },
  };
}

async function seedCacheWithOldHierarchy(ids: Ids) {
  writeCachedAppData(ids.org, {
    ...structureFor(ids),
    workItems: itemsFor(ids, false), // before the re-parenting
    hyperlinks: {},
    changeLog: [],
    selectedBacklogIds: [ids.backlog],
    selectedTreeId: ids.tree,
    selectedWorkItemIds: [],
  });
  await flushCachedWrites(ids.org);
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

function resetStore() {
  useAppStore.setState({
    workItems: {}, backlogs: {}, backlogTrees: {}, hyperlinks: {},
    selectedBacklogIds: [], selectedTreeId: null, selectedWorkItemIds: [],
    changeLog: [], expandedWorkItems: new Set(), expandedBacklogs: new Set(),
    undoStack: [], redoStack: [],
    isLoading: false, workItemsLoading: false, loadingProgress: 0,
    organizationId: null,
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadDataFromSupabase).mockReset();
  resetStore();
});

describe("resync against a stale cached snapshot", () => {
  it("keeps the live hierarchy, undo history and expansion while the fetch runs", async () => {
    const ids = freshOrg();
    await seedCacheWithOldHierarchy(ids);

    // What the user is looking at: the items re-parented under "Week 37",
    // an undo entry for that, and the parent expanded.
    const live = itemsFor(ids, true);
    useAppStore.setState({
      organizationId: ids.org,
      ...structureFor(ids),
      workItems: live,
      expandedWorkItems: new Set([ids.parent]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      undoStack: [{ workItems: itemsFor(ids, false) } as any],
      isLoading: false,
      loadingProgress: 100,
    });

    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
    vi.mocked(loadDataFromSupabase).mockImplementation((async () => {
      await fetchGate;
      return { ...structureFor(ids), workItems: itemsFor(ids, true) };
    }) as never);

    const loadPromise = useAppStore.getState().loadFromSupabase();
    // Give the cached-snapshot step every chance to run before the fetch does.
    await new Promise((r) => setTimeout(r, 20));

    const during = useAppStore.getState();
    expect(during.workItems[ids.child].parentId).toBe(ids.parent);
    expect(during.workItems[ids.parent].childrenIds).toEqual([ids.child]);
    expect(during.undoStack.length).toBe(1);
    expect(during.expandedWorkItems.has(ids.parent)).toBe(true);

    releaseFetch();
    await loadPromise;

    const settled = useAppStore.getState();
    expect(settled.workItems[ids.child].parentId).toBe(ids.parent);
  });

  it("still paints the cached snapshot on a cold start", async () => {
    const ids = freshOrg();
    await seedCacheWithOldHierarchy(ids);

    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => { releaseFetch = resolve; });
    vi.mocked(loadDataFromSupabase).mockImplementation((async () => {
      await fetchGate;
      return { ...structureFor(ids), workItems: itemsFor(ids, true) };
    }) as never);

    // Nothing on screen yet — only the organization is known.
    useAppStore.setState({ organizationId: ids.org });
    const loadPromise = useAppStore.getState().loadFromSupabase();
    await new Promise((r) => setTimeout(r, 20));

    // The cache fills the screen rather than leaving it blank.
    expect(Object.keys(useAppStore.getState().workItems)).toContain(ids.child);

    releaseFetch();
    await loadPromise;
    // The cached path hands back before its background refresh finishes.
    await waitFor(
      () => useAppStore.getState().workItems[ids.child]?.parentId === ids.parent,
      "the fetched hierarchy to replace the cached one",
    );
  });
});
