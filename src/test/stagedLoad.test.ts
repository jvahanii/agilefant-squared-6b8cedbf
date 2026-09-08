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
  upsertWorkItemBoardRankRows: vi.fn().mockResolvedValue(true),
  deleteWorkItemBoardRanks: vi.fn().mockResolvedValue(undefined),
  deleteWorkItems: vi.fn(),
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

const ORG = "staged-org";
const TREE = `${ORG}::tree-1`;
const BACKLOG = `${ORG}::backlog-1`;

const structure = () => ({
  backlogTrees: {
    [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BACKLOG], rank: 0, pointsEnabled: null },
  },
  backlogs: {
    [BACKLOG]: {
      id: BACKLOG, name: "Backlog", parentId: null, childrenIds: [], treeId: TREE,
      rank: 0, boardHiddenStatusKeys: [], viewMode: "list" as const,
    },
  },
});

const workItem = () => ({
  [`${ORG}::item-1`]: {
    id: `${ORG}::item-1`, title: "Item", status: "not_started" as const,
    parentId: null, childrenIds: [], backlogAssignments: { [TREE]: BACKLOG },
    ranks: { [BACKLOG]: 0 }, boardRanks: {}, organizationId: ORG,
  },
});

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
    let releaseWorkItems!: () => void;
    const workItemsGate = new Promise<void>((resolve) => { releaseWorkItems = resolve; });

    vi.mocked(loadDataFromSupabase).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (_orgId: string, onStructureReady?: (s: any) => void) => {
        onStructureReady?.(structure());
        await workItemsGate;
        return { ...structure(), workItems: workItem() };
      }) as never,
    );

    useAppStore.getState().setOrganizationId(ORG);
    const loadPromise = useAppStore.getState().loadFromSupabase();

    // Let the structure callback flush without releasing the work items.
    await Promise.resolve();
    await Promise.resolve();

    const painted = useAppStore.getState();
    expect(Object.keys(painted.backlogTrees)).toEqual([TREE]);
    expect(Object.keys(painted.backlogs)).toEqual([BACKLOG]);
    // The shell is renderable...
    expect(painted.isLoading).toBe(false);
    // ...but panels must not claim the backlog is empty yet.
    expect(painted.workItemsLoading).toBe(true);
    expect(painted.workItems).toEqual({});

    releaseWorkItems();
    await loadPromise;

    const settled = useAppStore.getState();
    expect(Object.keys(settled.workItems)).toEqual([`${ORG}::item-1`]);
    expect(settled.workItemsLoading).toBe(false);
    expect(settled.isLoading).toBe(false);
    expect(settled.loadingProgress).toBe(100);
  });

  it("leaves the structure untouched when the work items arrive", async () => {
    vi.mocked(loadDataFromSupabase).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (_orgId: string, onStructureReady?: (s: any) => void) => {
        onStructureReady?.(structure());
        return { ...structure(), workItems: workItem() };
      }) as never,
    );

    useAppStore.getState().setOrganizationId(ORG);
    await useAppStore.getState().loadFromSupabase();

    // What was painted early must equal what the final commit installs,
    // otherwise the user sees the tree shift under them mid-load.
    const settled = useAppStore.getState();
    expect(settled.backlogTrees[TREE].rootBacklogIds).toEqual([BACKLOG]);
    expect(settled.backlogs[BACKLOG].treeId).toBe(TREE);
  });

  it("restores the previously selected backlog during the early paint", async () => {
    localStorage.setItem(`selection_${ORG}_backlogIds`, JSON.stringify([BACKLOG]));
    localStorage.setItem(`selection_${ORG}_treeId`, TREE);

    let releaseWorkItems!: () => void;
    const workItemsGate = new Promise<void>((resolve) => { releaseWorkItems = resolve; });
    vi.mocked(loadDataFromSupabase).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (async (_orgId: string, onStructureReady?: (s: any) => void) => {
        onStructureReady?.(structure());
        await workItemsGate;
        return { ...structure(), workItems: workItem() };
      }) as never,
    );

    useAppStore.getState().setOrganizationId(ORG);
    const loadPromise = useAppStore.getState().loadFromSupabase();
    await Promise.resolve();
    await Promise.resolve();

    // Selection is restored at first paint, so the user is not looking at an
    // unselected tree while the items stream in.
    expect(useAppStore.getState().selectedTreeId).toBe(TREE);
    expect(useAppStore.getState().selectedBacklogIds).toEqual([BACKLOG]);

    releaseWorkItems();
    await loadPromise;
  });
});
