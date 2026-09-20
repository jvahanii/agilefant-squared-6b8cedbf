/**
 * The cold load paints in two stages: backlogs + trees are committed as soon
 * as they arrive so the shell is usable, then the much larger work-item and
 * rank payloads fill in. These tests pin that sequencing, since a regression
 * would either delay the first paint again or leave panels claiming a backlog
 * is empty while its items are still downloading.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "@/store/appStore";
import { loadFromSupabase as loadDataFromSupabase } from "@/store/supabaseSync";

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

// A fresh org per test: the cache is persistent now, so reusing one would let
// an earlier test's snapshot send a later one down the cached path.
let orgCounter = 0;
function freshOrg() {
  const org = `staged-org-${++orgCounter}`;
  return { org, tree: `${org}::tree-1`, backlog: `${org}::backlog-1` };
}

function structureFor(tree: string, backlog: string) {
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

function workItemFor(org: string, tree: string, backlog: string) {
  return {
    [`${org}::item-1`]: {
      id: `${org}::item-1`, title: "Item", status: "not_started" as const,
      parentId: null, childrenIds: [], backlogAssignments: { [tree]: backlog },
      ranks: { [backlog]: 0 }, boardRanks: {}, organizationId: org,
    },
  };
}

async function waitFor(predicate: () => boolean, label: string) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadDataFromSupabase).mockReset();
  useAppStore.setState({
    workItems: {}, backlogs: {}, backlogTrees: {}, hyperlinks: {},
    selectedBacklogIds: [], selectedTreeId: null, selectedWorkItemIds: [],
    changeLog: [], expandedWorkItems: new Set(), expandedBacklogs: new Set(),
    undoStack: [], redoStack: [],
    isLoading: false, workItemsLoading: false, loadingProgress: 0,
    organizationId: null,
  });
});

describe("staged cold load", () => {
  it("commits backlogs and trees before work items finish downloading", async () => {
    const { org, tree, backlog } = freshOrg();
    let releaseWorkItems!: () => void;
    const workItemsGate = new Promise<void>((resolve) => { releaseWorkItems = resolve; });

    vi.mocked(loadDataFromSupabase).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (_orgId: string, onStructureReady?: (s: any) => void) => {
        onStructureReady?.(structureFor(tree, backlog));
        await workItemsGate;
        return { ...structureFor(tree, backlog), workItems: workItemFor(org, tree, backlog) };
      }) as never,
    );

    useAppStore.getState().setOrganizationId(org);
    const loadPromise = useAppStore.getState().loadFromSupabase();

    await waitFor(
      () => Object.keys(useAppStore.getState().backlogTrees).length > 0,
      "structure committed to the store",
    );

    const painted = useAppStore.getState();
    expect(Object.keys(painted.backlogs)).toEqual([backlog]);
    // The shell is renderable...
    expect(painted.isLoading).toBe(false);
    // ...but panels must not claim the backlog is empty yet.
    expect(painted.workItemsLoading).toBe(true);
    expect(painted.workItems).toEqual({});

    releaseWorkItems();
    await loadPromise;

    const settled = useAppStore.getState();
    expect(Object.keys(settled.workItems)).toEqual([`${org}::item-1`]);
    expect(settled.workItemsLoading).toBe(false);
    expect(settled.isLoading).toBe(false);
    expect(settled.loadingProgress).toBe(100);
  });

  it("leaves the structure untouched when the work items arrive", async () => {
    const { org, tree, backlog } = freshOrg();
    vi.mocked(loadDataFromSupabase).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (_orgId: string, onStructureReady?: (s: any) => void) => {
        onStructureReady?.(structureFor(tree, backlog));
        return { ...structureFor(tree, backlog), workItems: workItemFor(org, tree, backlog) };
      }) as never,
    );

    useAppStore.getState().setOrganizationId(org);
    await useAppStore.getState().loadFromSupabase();

    // What was painted early must equal what the final commit installs,
    // otherwise the user sees the tree shift under them mid-load.
    const settled = useAppStore.getState();
    expect(settled.backlogTrees[tree].rootBacklogIds).toEqual([backlog]);
    expect(settled.backlogs[backlog].treeId).toBe(tree);
  });

  it("restores the previously selected backlog during the early paint", async () => {
    const { org, tree, backlog } = freshOrg();
    localStorage.setItem(`selection_${org}_backlogIds`, JSON.stringify([backlog]));
    localStorage.setItem(`selection_${org}_treeId`, tree);

    let releaseWorkItems!: () => void;
    const workItemsGate = new Promise<void>((resolve) => { releaseWorkItems = resolve; });
    vi.mocked(loadDataFromSupabase).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (_orgId: string, onStructureReady?: (s: any) => void) => {
        onStructureReady?.(structureFor(tree, backlog));
        await workItemsGate;
        return { ...structureFor(tree, backlog), workItems: workItemFor(org, tree, backlog) };
      }) as never,
    );

    useAppStore.getState().setOrganizationId(org);
    const loadPromise = useAppStore.getState().loadFromSupabase();
    await waitFor(
      () => useAppStore.getState().selectedTreeId !== null,
      "selection restored at first paint",
    );

    // Selection is restored at first paint, so the user is not looking at an
    // unselected tree while the items stream in.
    expect(useAppStore.getState().selectedTreeId).toBe(tree);
    expect(useAppStore.getState().selectedBacklogIds).toEqual([backlog]);
    expect(useAppStore.getState().workItemsLoading).toBe(true);

    releaseWorkItems();
    await loadPromise;
  });
});
