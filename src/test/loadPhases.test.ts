/**
 * The load's phases (loadFromSupabase in the store): what a fresh load opens
 * and keeps, and what the refresh behind a cached copy keeps. Written before
 * the load was taken apart into showCachedCopy, refreshInBackground and
 * loadFresh, for the parts the other load tests did not reach.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "@/store/appStore";
import { loadFromSupabase as loadDataFromSupabase, loadHyperlinksForWorkItems } from "@/store/supabaseSync";
import { writeCachedAppData, flushCachedWrites } from "@/store/appDataCache";
import { loadChangeLog } from "@/store/changeLog";

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
  const org = `load-org-${++orgCounter}`;
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
        id: backlog, name: "List", parentId: null, childrenIds: [], treeId: tree,
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

describe("a load", () => {
  it("opens the parents of the selection this browser saved, and keeps only the links of items it keeps", async () => {
    const ids = freshOrg();
    localStorage.setItem(`selection_${ids.org}_backlogIds`, JSON.stringify([ids.backlog]));
    localStorage.setItem(`selection_${ids.org}_treeId`, ids.tree);
    localStorage.setItem(`selection_${ids.org}_workItemIds`, JSON.stringify([ids.child, "gone"]));
    vi.mocked(loadDataFromSupabase).mockResolvedValue({ ...structureFor(ids), workItems: itemsFor(ids, true) } as never);
    vi.mocked(loadHyperlinksForWorkItems).mockResolvedValueOnce({
      [ids.child]: [{ id: "l1", workItemId: ids.child, url: "https://a", altText: "", rank: 0 }],
      gone: [{ id: "l2", workItemId: "gone", url: "https://b", altText: "", rank: 0 }],
    } as never);
    useAppStore.setState({ organizationId: ids.org });
    await useAppStore.getState().loadFromSupabase();
    const s = useAppStore.getState();
    expect({
      selectedItems: s.selectedWorkItemIds,
      selectedLists: s.selectedBacklogIds,
      tree: s.selectedTreeId,
      openItems: [...s.expandedWorkItems],
      links: Object.keys(s.hyperlinks),
      loading: s.isLoading,
      progress: s.loadingProgress,
    }).toEqual({
      selectedItems: [ids.child],
      selectedLists: [ids.backlog],
      tree: ids.tree,
      openItems: [ids.parent],
      links: [ids.child],
      loading: false,
      progress: 100,
    });
  });

  it("keeps, behind a cached copy, an item the fetch would leave in no list", async () => {
    const ids = freshOrg();
    await seedCacheWithOldHierarchy(ids);
    // The fetch has the item, but in a tree it did not return.
    const fetched = itemsFor(ids, false);
    fetched[ids.child] = { ...fetched[ids.child], backlogAssignments: { [`${ids.org}::missing-tree`]: "x" } as never };
    vi.mocked(loadDataFromSupabase).mockResolvedValue({ ...structureFor(ids), workItems: fetched } as never);
    useAppStore.setState({ organizationId: ids.org });
    await useAppStore.getState().loadFromSupabase();
    await waitFor(() => !useAppStore.getState().workItemsRefreshing, "the refresh to land");
    expect(useAppStore.getState().workItems[ids.child]?.backlogAssignments).toEqual({ [ids.tree]: ids.backlog });
  });

  it("does not wait for the change log: it is fetched once the data has landed", async () => {
    const ids = freshOrg();
    await seedCacheWithOldHierarchy(ids);
    vi.mocked(loadDataFromSupabase).mockResolvedValue({ ...structureFor(ids), workItems: itemsFor(ids, true) } as never);
    let answer!: (entries: never[]) => void;
    vi.mocked(loadChangeLog).mockImplementationOnce(() => new Promise((r) => { answer = r as never; }));
    useAppStore.setState({ organizationId: ids.org });
    await useAppStore.getState().loadFromSupabase();
    // The log has not answered, and the fresh data is in: the page can be edited.
    await waitFor(() => !useAppStore.getState().workItemsRefreshing, "the refresh to land");
    expect(useAppStore.getState().workItems[ids.child]?.parentId).toBe(ids.parent);
    expect(useAppStore.getState().catchingUp).toBe(false);
    expect(loadChangeLog).toHaveBeenCalledWith(ids.org);

    // Logged here before the log answers, and not yet saved: kept on top.
    useAppStore.getState().logChange({ action: "Rename", entityType: "work_item", entityId: ids.child });
    answer([{ id: "e1", timestamp: "2020-01-01T00:00:00Z", action: "Create", entityType: "work_item" }] as never[]);
    await waitFor(() => useAppStore.getState().changeLog.length === 2, "the log to land");
    expect(useAppStore.getState().changeLog.map((e) => e.action)).toEqual(["Rename", "Create"]);
  });
});
