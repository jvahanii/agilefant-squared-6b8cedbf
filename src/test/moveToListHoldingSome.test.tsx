/**
 * Moving a selection to a list that already holds some of it, mirrored there.
 * The list is offered as long as it lacks any of them; the rest arrive, and
 * those already there keep their place. The mocks are those of
 * appStore.performance.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAppStore } from "@/store/appStore";
import { MoveToBacklogDialog } from "@/components/MoveToBacklogDialog";

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

const SOURCE_TREE = "org::bt-source";
const TARGET_TREE = "org::bt-target";
const SOURCE = "org::bl-source";
const TARGET = "org::bl-target";
const OTHER = "org::bl-other";

const item = (id: string, assignments: Record<string, string>, ranks: Record<string, number>) => ({
  id, title: id, status: "not_started", parentId: null as string | null, childrenIds: [] as string[],
  backlogAssignments: assignments, ranks, boardRanks: { ...ranks },
});

beforeEach(() => {
  const list = (id: string, treeId: string, name: string) => ({ id, name, parentId: null, childrenIds: [] as string[], treeId, rank: 0 });
  useAppStore.setState({
    organizationId: "org",
    backlogTrees: {
      [SOURCE_TREE]: { id: SOURCE_TREE, name: "Source tree", rootBacklogIds: [SOURCE], rank: 0 },
      [TARGET_TREE]: { id: TARGET_TREE, name: "Target tree", rootBacklogIds: [TARGET, OTHER], rank: 1 },
    },
    backlogs: {
      [SOURCE]: list(SOURCE, SOURCE_TREE, "Source list"),
      [TARGET]: list(TARGET, TARGET_TREE, "Target list"),
      [OTHER]: list(OTHER, TARGET_TREE, "Other list"),
    },
    workItems: {
      // Already mirrored into the target list, in the middle of it.
      mirrored: item("mirrored", { [SOURCE_TREE]: SOURCE, [TARGET_TREE]: TARGET }, { [SOURCE]: 0, [TARGET]: 5 }),
      plain: item("plain", { [SOURCE_TREE]: SOURCE }, { [SOURCE]: 1 }),
      resident: item("resident", { [TARGET_TREE]: TARGET }, { [TARGET]: 3 }),
    },
    undoStack: [], redoStack: [], isLoading: false, hyperlinks: {}, selectedBacklogIds: [SOURCE],
    selectedTreeId: SOURCE_TREE, selectedWorkItemIds: [], changeLog: [], expandedWorkItems: new Set(), expandedBacklogs: new Set(),
  } as never);
});

function renderDialog(workItemIds: string[]) {
  render(<MoveToBacklogDialog workItemIds={workItemIds} treeId={SOURCE_TREE} currentBacklogId={SOURCE} open onOpenChange={() => {}} />);
}

describe("the lists offered to move a selection to", () => {
  it("include one that holds only some of the selection", () => {
    renderDialog(["mirrored", "plain"]);
    expect(screen.getByRole("button", { name: /Target list/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Other list/ })).toBeInTheDocument();
  });

  it("leave out one that holds all of it", () => {
    renderDialog(["mirrored", "plain"]);
    expect(screen.queryByRole("button", { name: /Source list/ })).toBeNull();
  });

  it("leave out what a single item is in, as ever", () => {
    renderDialog(["mirrored"]);
    expect(screen.queryByRole("button", { name: /Target list/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Source list/ })).toBeNull();
  });
});

describe("moving a selection to a list that holds some of it", () => {
  const items = () => useAppStore.getState().workItems;

  it("leaves those already there in their place, and brings the rest above the list", () => {
    useAppStore.getState().moveWorkItemsToBacklog(["mirrored", "plain"], TARGET, TARGET_TREE, "move", SOURCE_TREE);
    expect(items().mirrored.ranks[TARGET]).toBe(5);
    expect(items().plain.ranks[TARGET]).toBe(2);
    expect(items().resident.ranks[TARGET]).toBe(3);
  });

  it("takes all of them out of the source tree when moving", () => {
    useAppStore.getState().moveWorkItemsToBacklog(["mirrored", "plain"], TARGET, TARGET_TREE, "move", SOURCE_TREE);
    expect(items().mirrored.backlogAssignments).toEqual({ [TARGET_TREE]: TARGET });
    expect(items().plain.backlogAssignments).toEqual({ [TARGET_TREE]: TARGET });
  });

  it("leaves all of them in the source tree when mirroring", () => {
    useAppStore.getState().moveWorkItemsToBacklog(["mirrored", "plain"], TARGET, TARGET_TREE, "mirror");
    expect(items().mirrored.backlogAssignments).toEqual({ [SOURCE_TREE]: SOURCE, [TARGET_TREE]: TARGET });
    expect(items().mirrored.ranks[TARGET]).toBe(5);
    expect(items().plain.backlogAssignments).toEqual({ [SOURCE_TREE]: SOURCE, [TARGET_TREE]: TARGET });
  });
});
