import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore, sanitizeData } from "@/store/appStore";

// Mock supabase sync — all DB calls are no-ops in tests
vi.mock("@/store/supabaseSync", () => ({
  loadFromSupabase: vi.fn().mockResolvedValue({ workItems: {}, backlogs: {}, backlogTrees: {} }),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
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
  generateMockData: vi.fn(() => ({ workItems: {}, backlogs: {}, backlogTrees: {} })),
}));

const ORG = "test-org";

function seedStore() {
  const store = useAppStore.getState();
  store.setOrganizationId(ORG);

  // Seed a tree, backlog, and work item
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: {
      [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
    },
    backlogs: {
      [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "Backlog 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
    },
    workItems: {
      [`${ORG}::wi-1`]: {
        id: `${ORG}::wi-1`, title: "Item 1", status: "not_started" as const,
        parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
      },
    },
    undoStack: [],
    redoStack: [],
    isLoading: false,
  });
}

beforeEach(() => {
  useAppStore.setState({
    workItems: {}, backlogs: {}, backlogTrees: {}, hyperlinks: {},
    selectedBacklogIds: [], selectedTreeId: null, selectedWorkItemIds: [],
    changeLog: [], expandedWorkItems: new Set(), expandedBacklogs: new Set(),
    undoStack: [], redoStack: [], isLoading: false, organizationId: null,
  });
});

// ─── WORK ITEM CRUD ────────────────────────────────────────────────────

describe("addWorkItem", () => {
  it("creates a work item with correct assignments", () => {
    seedStore();
    const s = useAppStore.getState();
    s.addWorkItem("New Item", null, `${ORG}::bl-1`, `${ORG}::bt-1`);
    const items = Object.values(useAppStore.getState().workItems);
    expect(items.length).toBe(2);
    const newItem = items.find((i) => i.title === "New Item");
    expect(newItem).toBeDefined();
    expect(newItem!.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-1`);
  });

  it("adds child to parent's childrenIds", () => {
    seedStore();
    const s = useAppStore.getState();
    s.addWorkItem("Child", `${ORG}::wi-1`, `${ORG}::bl-1`, `${ORG}::bt-1`);
    const parent = useAppStore.getState().workItems[`${ORG}::wi-1`];
    expect(parent.childrenIds.length).toBe(1);
  });

  it("cascades rank shift via requestedRank to avoid cross-context duplicates", () => {
    // wi-a: rank=0, in bt-1::bl-1 AND bt-2::bl-2 (will be shifted to rank 1 by insert at 0)
    // wi-b: rank=1, in bt-2::bl-2 only → must cascade-shift to rank 2
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "Tree 2", rootBacklogIds: [`${ORG}::bl-2`], rank: 1 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "BL 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "BL 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-2`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-a`]: {
          id: `${ORG}::wi-a`, title: "A", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1`, [`${ORG}::bt-2`]: `${ORG}::bl-2` },
          ranks: { [`${ORG}::bl-1`]: 0, [`${ORG}::bl-2`]: 0 },
        },
        [`${ORG}::wi-b`]: {
          id: `${ORG}::wi-b`, title: "B", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-2`]: `${ORG}::bl-2` },
          ranks: { [`${ORG}::bl-2`]: 1 },
        },
      },
      undoStack: [], redoStack: [], isLoading: false,
    });
    // Insert new item at rank 0 in bt-1::bl-1
    useAppStore.getState().addWorkItem("New", null, `${ORG}::bl-1`, `${ORG}::bt-1`, 0);
    // wi-a shifted 0 → 1 in bl-1; wi-b is NOT in bl-1 so stays unchanged
    expect(useAppStore.getState().workItems[`${ORG}::wi-a`].ranks[`${ORG}::bl-1`]).toBe(1);
    expect(useAppStore.getState().workItems[`${ORG}::wi-b`].ranks[`${ORG}::bl-2`]).toBe(1);
  });
});

describe("deleteWorkItem", () => {
  it("removes item from store", () => {
    seedStore();
    useAppStore.getState().deleteWorkItem(`${ORG}::wi-1`);
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`]).toBeUndefined();
  });

  it("recursively deletes children", () => {
    seedStore();
    const s = useAppStore.getState();
    s.addWorkItem("Child", `${ORG}::wi-1`, `${ORG}::bl-1`, `${ORG}::bt-1`);
    const childId = Object.keys(useAppStore.getState().workItems).find((id) => id !== `${ORG}::wi-1`)!;
    useAppStore.getState().deleteWorkItem(`${ORG}::wi-1`);
    expect(useAppStore.getState().workItems[childId]).toBeUndefined();
  });

  it("removes item from parent's childrenIds", () => {
    seedStore();
    const s = useAppStore.getState();
    s.addWorkItem("Child", `${ORG}::wi-1`, `${ORG}::bl-1`, `${ORG}::bt-1`);
    const childId = Object.keys(useAppStore.getState().workItems).find((id) => id !== `${ORG}::wi-1`)!;
    useAppStore.getState().deleteWorkItem(childId);
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`].childrenIds).toEqual([]);
  });
});

describe("renameWorkItem", () => {
  it("updates title", () => {
    seedStore();
    useAppStore.getState().renameWorkItem(`${ORG}::wi-1`, "Renamed");
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`].title).toBe("Renamed");
  });
});

describe("setWorkItemStatus", () => {
  it("updates status", () => {
    seedStore();
    useAppStore.getState().setWorkItemStatus(`${ORG}::wi-1`, "done");
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`].status).toBe("done");
  });

  it("cascades in_progress to all ancestors", () => {
    seedStore();
    // Add a parent and grandparent work item
    useAppStore.setState({
      workItems: {
        ...useAppStore.getState().workItems,
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent", status: "not_started" as const,
          parentId: `${ORG}::wi-grandparent`, childrenIds: [`${ORG}::wi-1`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
        [`${ORG}::wi-grandparent`]: {
          id: `${ORG}::wi-grandparent`, title: "Grandparent", status: "not_started" as const,
          parentId: null, childrenIds: [`${ORG}::wi-parent`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
        [`${ORG}::wi-1`]: {
          ...useAppStore.getState().workItems[`${ORG}::wi-1`],
          parentId: `${ORG}::wi-parent`,
        },
      },
    });
    useAppStore.getState().setWorkItemStatus(`${ORG}::wi-1`, "in_progress");
    const items = useAppStore.getState().workItems;
    expect(items[`${ORG}::wi-1`].status).toBe("in_progress");
    expect(items[`${ORG}::wi-parent`].status).toBe("in_progress");
    expect(items[`${ORG}::wi-grandparent`].status).toBe("in_progress");
  });

  it("cascades in_progress to not_started ancestors when status is done", () => {
    seedStore();
    useAppStore.setState({
      workItems: {
        ...useAppStore.getState().workItems,
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent", status: "not_started" as const,
          parentId: `${ORG}::wi-grandparent`, childrenIds: [`${ORG}::wi-1`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
        [`${ORG}::wi-grandparent`]: {
          id: `${ORG}::wi-grandparent`, title: "Grandparent", status: "not_started" as const,
          parentId: null, childrenIds: [`${ORG}::wi-parent`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
        [`${ORG}::wi-1`]: {
          ...useAppStore.getState().workItems[`${ORG}::wi-1`],
          parentId: `${ORG}::wi-parent`,
        },
      },
    });
    useAppStore.getState().setWorkItemStatus(`${ORG}::wi-1`, "done");
    const items = useAppStore.getState().workItems;
    expect(items[`${ORG}::wi-1`].status).toBe("done");
    expect(items[`${ORG}::wi-parent`].status).toBe("in_progress");
    expect(items[`${ORG}::wi-grandparent`].status).toBe("in_progress");
  });

  it("does not cascade to ancestors with non-not_started status when status is done", () => {
    seedStore();
    useAppStore.setState({
      workItems: {
        ...useAppStore.getState().workItems,
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent", status: "pending" as const,
          parentId: null, childrenIds: [`${ORG}::wi-1`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
        [`${ORG}::wi-1`]: {
          ...useAppStore.getState().workItems[`${ORG}::wi-1`],
          parentId: `${ORG}::wi-parent`,
        },
      },
    });
    useAppStore.getState().setWorkItemStatus(`${ORG}::wi-1`, "done");
    const items = useAppStore.getState().workItems;
    expect(items[`${ORG}::wi-1`].status).toBe("done");
    expect(items[`${ORG}::wi-parent`].status).toBe("pending");
  });

  it("skips ancestors already in_progress", () => {
    seedStore();
    useAppStore.setState({
      workItems: {
        ...useAppStore.getState().workItems,
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent", status: "in_progress" as const,
          parentId: null, childrenIds: [`${ORG}::wi-1`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
        [`${ORG}::wi-1`]: {
          ...useAppStore.getState().workItems[`${ORG}::wi-1`],
          parentId: `${ORG}::wi-parent`,
        },
      },
    });
    useAppStore.getState().setWorkItemStatus(`${ORG}::wi-1`, "in_progress");
    const items = useAppStore.getState().workItems;
    expect(items[`${ORG}::wi-parent`].status).toBe("in_progress");
  });
});

describe("setWorkItemPoints", () => {
  it("sets points", () => {
    seedStore();
    useAppStore.getState().setWorkItemPoints(`${ORG}::wi-1`, 5);
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`].points).toBe(5);
  });

  it("clears points", () => {
    seedStore();
    useAppStore.getState().setWorkItemPoints(`${ORG}::wi-1`, undefined);
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`].points).toBeUndefined();
  });
});

describe("removeWorkItemFromTree", () => {
  it("removes tree assignment", () => {
    seedStore();
    // Add a second tree assignment so it doesn't delete the item
    const items = { ...useAppStore.getState().workItems };
    useAppStore.setState({
      backlogTrees: {
        ...useAppStore.getState().backlogTrees,
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "Tree 2", rootBacklogIds: [`${ORG}::bl-2`], rank: 1 },
      },
      backlogs: {
        ...useAppStore.getState().backlogs,
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "Backlog 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-2`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-1`]: {
          ...items[`${ORG}::wi-1`],
          backlogAssignments: {
            [`${ORG}::bt-1`]: `${ORG}::bl-1`,
            [`${ORG}::bt-2`]: `${ORG}::bl-2`,
          },
        },
      },
    });
    useAppStore.getState().removeWorkItemFromTree(`${ORG}::wi-1`, `${ORG}::bt-1`);
    const wi = useAppStore.getState().workItems[`${ORG}::wi-1`];
    expect(wi).toBeDefined();
    expect(wi.backlogAssignments[`${ORG}::bt-1`]).toBeUndefined();
    expect(wi.backlogAssignments[`${ORG}::bt-2`]).toBe(`${ORG}::bl-2`);
  });

  it("deletes item if no assignments remain", () => {
    seedStore();
    useAppStore.getState().removeWorkItemFromTree(`${ORG}::wi-1`, `${ORG}::bt-1`);
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`]).toBeUndefined();
  });
});

describe("reparentWorkItem", () => {
  it("moves item to a new parent", () => {
    seedStore();
    useAppStore.getState().addWorkItem("Item 2", null, `${ORG}::bl-1`, `${ORG}::bt-1`);
    const item2Id = Object.keys(useAppStore.getState().workItems).find((id) => id !== `${ORG}::wi-1`)!;
    useAppStore.getState().reparentWorkItem(item2Id, `${ORG}::wi-1`);
    const parent = useAppStore.getState().workItems[`${ORG}::wi-1`];
    const child = useAppStore.getState().workItems[item2Id];
    expect(parent.childrenIds).toContain(item2Id);
    expect(child.parentId).toBe(`${ORG}::wi-1`);
  });

  it("assigns a non-duplicate rank when reparented to a parent with existing children", () => {
    seedStore();
    const s = useAppStore.getState();
    // Give wi-1 a child at rank 0
    s.addWorkItem("Child A", `${ORG}::wi-1`, `${ORG}::bl-1`, `${ORG}::bt-1`);
    // Add a second root item (will get rank 1 after the shift in addWorkItem)
    s.addWorkItem("Item 2", null, `${ORG}::bl-1`, `${ORG}::bt-1`);
    const item2Id = Object.keys(useAppStore.getState().workItems).find(
      (id) => useAppStore.getState().workItems[id].title === "Item 2",
    )!;
    const childAId = Object.keys(useAppStore.getState().workItems).find(
      (id) => useAppStore.getState().workItems[id].title === "Child A",
    )!;
    // Record Child A's rank before the reparent
    const childARank = useAppStore.getState().workItems[childAId].ranks[`${ORG}::bl-1`];
    // Reparent Item 2 under wi-1 — it should NOT receive the same rank as Child A
    s.reparentWorkItem(item2Id, `${ORG}::wi-1`);
    const movedItem = useAppStore.getState().workItems[item2Id];
    expect(movedItem.ranks[`${ORG}::bl-1`]).not.toBe(childARank);
  });

  it("assigns rank 0 when reparented to a parent with no existing children", () => {
    seedStore();
    const s = useAppStore.getState();
    s.addWorkItem("Item 2", null, `${ORG}::bl-1`, `${ORG}::bt-1`);
    const item2Id = Object.keys(useAppStore.getState().workItems).find(
      (id) => useAppStore.getState().workItems[id].title === "Item 2",
    )!;
    // wi-1 currently has no children
    s.reparentWorkItem(item2Id, `${ORG}::wi-1`);
    const movedItem = useAppStore.getState().workItems[item2Id];
    expect(movedItem.ranks[`${ORG}::bl-1`]).toBe(0);
  });

  it("strategy=move-to-tree: updates backlogAssignments to only contain the new tree", () => {
    // Set up two trees with one item in each
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "Tree 2", rootBacklogIds: [`${ORG}::bl-2`], rank: 1 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "Backlog 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "Backlog 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-2`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent (Tree 2)", status: "not_started" as const,
          parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-2`]: `${ORG}::bl-2` }, ranks: { [`${ORG}::bl-2`]: 0 },
        },
        [`${ORG}::wi-1`]: {
          id: `${ORG}::wi-1`, title: "Item 1 (Tree 1)", status: "not_started" as const,
          parentId: null, childrenIds: [`${ORG}::wi-child`], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
        [`${ORG}::wi-child`]: {
          id: `${ORG}::wi-child`, title: "Child (Tree 1)", status: "not_started" as const,
          parentId: `${ORG}::wi-1`, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
      },
      undoStack: [],
      redoStack: [],
      isLoading: false,
    });
    useAppStore.getState().reparentWorkItem(
      `${ORG}::wi-1`,
      `${ORG}::wi-parent`,
      `${ORG}::bt-2`,
      `${ORG}::bl-2`,
      "move-to-tree",
    );
    const moved = useAppStore.getState().workItems[`${ORG}::wi-1`];
    const child = useAppStore.getState().workItems[`${ORG}::wi-child`];
    // The item should now only belong to Tree 2
    expect(moved.backlogAssignments).toEqual({ [`${ORG}::bt-2`]: `${ORG}::bl-2` });
    expect(moved.ranks[`${ORG}::bl-2`]).toBeDefined();
    expect(moved.ranks[`${ORG}::bl-1`]).toBeUndefined();
    expect(moved.parentId).toBe(`${ORG}::wi-parent`);
    // The child should also have been migrated to Tree 2
    expect(child.backlogAssignments).toEqual({ [`${ORG}::bt-2`]: `${ORG}::bl-2` });
    expect(child.ranks[`${ORG}::bl-2`]).toBeDefined();
    expect(child.ranks[`${ORG}::bl-1`]).toBeUndefined();
  });

  it("same tree, different backlog: migrates item to the target backlog", () => {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`, `${ORG}::bl-2`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "Backlog 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "Backlog 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
      },
      workItems: {
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent (Backlog 2)", status: "not_started" as const,
          parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-2` }, ranks: { [`${ORG}::bl-2`]: 0 },
        },
        [`${ORG}::wi-1`]: {
          id: `${ORG}::wi-1`, title: "Item 1 (Backlog 1)", status: "not_started" as const,
          parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
      },
      undoStack: [],
      redoStack: [],
      isLoading: false,
    });
    useAppStore.getState().reparentWorkItem(
      `${ORG}::wi-1`,
      `${ORG}::wi-parent`,
      `${ORG}::bt-1`,
      `${ORG}::bl-2`,
    );
    const moved = useAppStore.getState().workItems[`${ORG}::wi-1`];
    // Item should now be assigned to the new backlog only (for this tree)
    expect(moved.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-2`);
    // Rank in old backlog should be removed, new backlog rank should be set
    expect(moved.ranks[`${ORG}::bl-1`]).toBeUndefined();
    expect(moved.ranks[`${ORG}::bl-2`]).toBeDefined();
    expect(moved.parentId).toBe(`${ORG}::wi-parent`);
  });

  it("same tree, different backlog: migrates item and all descendants to the target backlog", () => {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`, `${ORG}::bl-2`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "Backlog 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "Backlog 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
      },
      workItems: {
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent (Backlog 2)", status: "not_started" as const,
          parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-2` }, ranks: { [`${ORG}::bl-2`]: 0 },
        },
        [`${ORG}::wi-1`]: {
          id: `${ORG}::wi-1`, title: "Item 1 (Backlog 1)", status: "not_started" as const,
          parentId: null, childrenIds: [`${ORG}::wi-child`], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
        [`${ORG}::wi-child`]: {
          id: `${ORG}::wi-child`, title: "Child (Backlog 1)", status: "not_started" as const,
          parentId: `${ORG}::wi-1`, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
      },
      undoStack: [],
      redoStack: [],
      isLoading: false,
    });
    useAppStore.getState().reparentWorkItem(
      `${ORG}::wi-1`,
      `${ORG}::wi-parent`,
      `${ORG}::bt-1`,
      `${ORG}::bl-2`,
    );
    const moved = useAppStore.getState().workItems[`${ORG}::wi-1`];
    const child = useAppStore.getState().workItems[`${ORG}::wi-child`];
    // Both item and its child should now be in the new backlog
    expect(moved.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-2`);
    expect(moved.ranks[`${ORG}::bl-1`]).toBeUndefined();
    expect(moved.ranks[`${ORG}::bl-2`]).toBeDefined();
    expect(child.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-2`);
    expect(child.ranks[`${ORG}::bl-1`]).toBeUndefined();
    expect(child.ranks[`${ORG}::bl-2`]).toBeDefined();
  });

  it("same tree, different backlog: preserves assignments in other trees when migrating", () => {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`, `${ORG}::bl-2`], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "Tree 2", rootBacklogIds: [`${ORG}::bl-3`], rank: 1 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "Backlog 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "Backlog 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
        [`${ORG}::bl-3`]: { id: `${ORG}::bl-3`, name: "Backlog 3", parentId: null, childrenIds: [], treeId: `${ORG}::bt-2`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent (Backlog 2)", status: "not_started" as const,
          parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-2` }, ranks: { [`${ORG}::bl-2`]: 0 },
        },
        [`${ORG}::wi-1`]: {
          id: `${ORG}::wi-1`, title: "Item 1 (multi-tree)", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1`, [`${ORG}::bt-2`]: `${ORG}::bl-3` },
          ranks: { [`${ORG}::bl-1`]: 0, [`${ORG}::bl-3`]: 0 },
        },
      },
      undoStack: [],
      redoStack: [],
      isLoading: false,
    });
    useAppStore.getState().reparentWorkItem(
      `${ORG}::wi-1`,
      `${ORG}::wi-parent`,
      `${ORG}::bt-1`,
      `${ORG}::bl-2`,
    );
    const moved = useAppStore.getState().workItems[`${ORG}::wi-1`];
    // Tree 1 backlog should switch from bl-1 to bl-2
    expect(moved.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-2`);
    expect(moved.ranks[`${ORG}::bl-1`]).toBeUndefined();
    expect(moved.ranks[`${ORG}::bl-2`]).toBeDefined();
    // Tree 2 assignment should be unchanged
    expect(moved.backlogAssignments[`${ORG}::bt-2`]).toBe(`${ORG}::bl-3`);
    expect(moved.ranks[`${ORG}::bl-3`]).toBe(0);
  });

  it("strategy=mirror: adds new tree assignment while keeping original", () => {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "Tree 2", rootBacklogIds: [`${ORG}::bl-2`], rank: 1 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "Backlog 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "Backlog 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-2`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent (Tree 2)", status: "not_started" as const,
          parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-2`]: `${ORG}::bl-2` }, ranks: { [`${ORG}::bl-2`]: 0 },
        },
        [`${ORG}::wi-1`]: {
          id: `${ORG}::wi-1`, title: "Item 1 (Tree 1)", status: "not_started" as const,
          parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 5 },
        },
      },
      undoStack: [],
      redoStack: [],
      isLoading: false,
    });
    useAppStore.getState().reparentWorkItem(
      `${ORG}::wi-1`,
      `${ORG}::wi-parent`,
      `${ORG}::bt-2`,
      `${ORG}::bl-2`,
      "mirror",
    );
    const moved = useAppStore.getState().workItems[`${ORG}::wi-1`];
    // The item should now belong to BOTH trees
    expect(moved.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-1`);
    expect(moved.backlogAssignments[`${ORG}::bt-2`]).toBe(`${ORG}::bl-2`);
    // Rank in original backlog should be preserved
    expect(moved.ranks[`${ORG}::bl-1`]).toBe(5);
    // Rank in new backlog should be set
    expect(moved.ranks[`${ORG}::bl-2`]).toBeDefined();
    expect(moved.parentId).toBe(`${ORG}::wi-parent`);
  });
});

// ─── MOVE WORK ITEM TO BACKLOG ─────────────────────────────────────────

describe("moveWorkItemToBacklog", () => {
  function seedTwoBacklogStore() {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`, `${ORG}::bl-2`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "Backlog 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "Backlog 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
      },
      workItems: {
        [`${ORG}::wi-1`]: {
          id: `${ORG}::wi-1`, title: "Item 1", status: "not_started" as const,
          parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
        [`${ORG}::wi-2`]: {
          id: `${ORG}::wi-2`, title: "Item 2", status: "not_started" as const,
          parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-2` }, ranks: { [`${ORG}::bl-2`]: 0 },
        },
      },
      undoStack: [],
      redoStack: [],
      isLoading: false,
    });
  }

  it("updates backlog assignment of the moved item", () => {
    seedTwoBacklogStore();
    useAppStore.getState().moveWorkItemToBacklog(`${ORG}::wi-1`, `${ORG}::bl-2`, `${ORG}::bt-1`);
    const moved = useAppStore.getState().workItems[`${ORG}::wi-1`];
    expect(moved.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-2`);
  });

  it("assigns a non-duplicate rank when target backlog already has an item with the same rank", () => {
    seedTwoBacklogStore();
    // wi-1 (rank 0) is in bl-1; wi-2 (rank 0) is in bl-2.
    // Moving wi-1 to bl-2 must not result in two rank-0 root items in bl-2.
    useAppStore.getState().moveWorkItemToBacklog(`${ORG}::wi-1`, `${ORG}::bl-2`, `${ORG}::bt-1`);
    const movedItem = useAppStore.getState().workItems[`${ORG}::wi-1`];
    const existingItem = useAppStore.getState().workItems[`${ORG}::wi-2`];
    expect(movedItem.ranks[`${ORG}::bl-2`]).not.toBe(existingItem.ranks[`${ORG}::bl-2`]);
  });

  it("also moves child items' backlog assignment recursively", () => {
    seedTwoBacklogStore();
    // Give wi-1 a child
    useAppStore.setState({
      workItems: {
        ...useAppStore.getState().workItems,
        [`${ORG}::wi-1`]: {
          ...useAppStore.getState().workItems[`${ORG}::wi-1`],
          childrenIds: [`${ORG}::wi-child`],
        },
        [`${ORG}::wi-child`]: {
          id: `${ORG}::wi-child`, title: "Child", status: "not_started" as const,
          parentId: `${ORG}::wi-1`, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
      },
    });
    useAppStore.getState().moveWorkItemToBacklog(`${ORG}::wi-1`, `${ORG}::bl-2`, `${ORG}::bt-1`);
    const child = useAppStore.getState().workItems[`${ORG}::wi-child`];
    expect(child.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-2`);
  });

  it("moves an item that also resides in a non-shared backlog (cross-org scenario)", () => {
    // Simulates: item owned by partner-org appears in a shared tree (bt-1) and
    // also has an assignment in a non-shared tree (bt-nonshared). The active user
    // (ORG) should be able to move it between backlogs within bt-1 without the
    // stale non-shared rank interfering.
    const PARTNER = "partner-org";
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Shared Tree", rootBacklogIds: [`${ORG}::bl-1`, `${ORG}::bl-2`], rank: 0 },
        [`${PARTNER}::bt-nonshared`]: { id: `${PARTNER}::bt-nonshared`, name: "Non-shared", rootBacklogIds: [`${PARTNER}::bl-own`], rank: 1 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "Shared BL 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "Shared BL 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
        [`${PARTNER}::bl-own`]: { id: `${PARTNER}::bl-own`, name: "Non-shared BL", parentId: null, childrenIds: [], treeId: `${PARTNER}::bt-nonshared`, rank: 0 },
      },
      workItems: {
        [`${PARTNER}::wi-cross`]: {
          id: `${PARTNER}::wi-cross`, title: "Cross-org item", status: "not_started" as const,
          parentId: null, childrenIds: [],
          organizationId: PARTNER,
          backlogAssignments: {
            [`${ORG}::bt-1`]: `${ORG}::bl-1`,
            [`${PARTNER}::bt-nonshared`]: `${PARTNER}::bl-own`,
          },
          ranks: { [`${ORG}::bl-1`]: 3, [`${PARTNER}::bl-own`]: 7 },
        },
      },
      undoStack: [], redoStack: [], isLoading: false,
    });

    useAppStore.getState().moveWorkItemToBacklog(`${PARTNER}::wi-cross`, `${ORG}::bl-2`, `${ORG}::bt-1`);

    const moved = useAppStore.getState().workItems[`${PARTNER}::wi-cross`];
    // Assignment in the shared tree must point to the new backlog
    expect(moved.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-2`);
    // Assignment in the non-shared tree must be unchanged
    expect(moved.backlogAssignments[`${PARTNER}::bt-nonshared`]).toBe(`${PARTNER}::bl-own`);
    // Rank for the new shared backlog must be defined
    expect(moved.ranks[`${ORG}::bl-2`]).toBeDefined();
    // Rank for the OLD shared backlog must be removed
    expect(moved.ranks[`${ORG}::bl-1`]).toBeUndefined();
    // Rank for the non-shared backlog must be preserved
    expect(moved.ranks[`${PARTNER}::bl-own`]).toBe(7);
  });
});

// ─── RESPAWN ITEM ──────────────────────────────────────────────────────

describe("respawnItem", () => {
  function seedRespawnStore() {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "Tree 2", rootBacklogIds: [`${ORG}::bl-2`], rank: 1 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "Backlog 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "Backlog 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-2`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-1`]: {
          id: `${ORG}::wi-1`,
          title: "Recurring Item",
          description: "Some description",
          points: 3,
          status: "done" as const,
          parentId: null,
          childrenIds: [],
          backlogAssignments: {
            [`${ORG}::bt-1`]: `${ORG}::bl-1`,
            [`${ORG}::bt-2`]: `${ORG}::bl-2`,
          },
          ranks: { [`${ORG}::bl-1`]: 0, [`${ORG}::bl-2`]: 0 },
          respawnEnabled: true,
          respawnIntervalDays: 7,
          respawnHour: 9,
        },
      },
      undoStack: [],
      redoStack: [],
      isLoading: false,
    });
  }

  it("respawned item inherits all backlog assignments from the original", () => {
    seedRespawnStore();
    useAppStore.getState().respawnItem(`${ORG}::wi-1`);
    const items = Object.values(useAppStore.getState().workItems);
    const copy = items.find((i) => i.id !== `${ORG}::wi-1`);
    expect(copy).toBeDefined();
    expect(copy!.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-1`);
    expect(copy!.backlogAssignments[`${ORG}::bt-2`]).toBe(`${ORG}::bl-2`);
  });

  it("respawned item has status not_started", () => {
    seedRespawnStore();
    useAppStore.getState().respawnItem(`${ORG}::wi-1`);
    const items = Object.values(useAppStore.getState().workItems);
    const copy = items.find((i) => i.id !== `${ORG}::wi-1`);
    expect(copy!.status).toBe("not_started");
  });

  it("respawned item copies title, description, and points from the original", () => {
    seedRespawnStore();
    useAppStore.getState().respawnItem(`${ORG}::wi-1`);
    const items = Object.values(useAppStore.getState().workItems);
    const copy = items.find((i) => i.id !== `${ORG}::wi-1`);
    expect(copy!.title).toBe("Recurring Item");
    expect(copy!.description).toBe("Some description");
    expect(copy!.points).toBe(3);
  });

  it("updates respawnLastTriggeredAt on the source item", () => {
    seedRespawnStore();
    useAppStore.getState().respawnItem(`${ORG}::wi-1`);
    const source = useAppStore.getState().workItems[`${ORG}::wi-1`];
    expect(source.respawnLastTriggeredAt).toBeDefined();
  });

  it("shifts siblings in all backlog tree contexts", () => {
    seedRespawnStore();
    // Add a sibling in tree 2 only (not in tree 1)
    useAppStore.setState({
      workItems: {
        ...useAppStore.getState().workItems,
        [`${ORG}::wi-sibling`]: {
          id: `${ORG}::wi-sibling`,
          title: "Sibling in tree 2",
          status: "not_started" as const,
          parentId: null,
          childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-2`]: `${ORG}::bl-2` },
          ranks: { [`${ORG}::bl-2`]: 1 },
        },
      },
    });
    useAppStore.getState().respawnItem(`${ORG}::wi-1`);
    const sibling = useAppStore.getState().workItems[`${ORG}::wi-sibling`];
    expect(sibling.ranks[`${ORG}::bl-2`]).toBe(2); // shifted from 1 to 2
  });

  it("cascades rank shift to avoid cross-context duplicates", () => {
    // wi-1: rank=0, in bt-1::bl-1 only (the item being respawned)
    // wi-shared: rank=1, in bt-1::bl-1 AND bt-2::bl-2 (will be shifted to rank 2)
    // wi-tree2-only: rank=2, in bt-2::bl-2 only
    //   → after wi-shared shifts to 2, wi-tree2-only must cascade-shift to 3
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "Tree 2", rootBacklogIds: [`${ORG}::bl-2`], rank: 1 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "BL 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "BL 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-2`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-1`]: {
          id: `${ORG}::wi-1`, title: "Source", status: "done" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` },
          ranks: { [`${ORG}::bl-1`]: 0 },
          respawnEnabled: true, respawnIntervalDays: 7, respawnHour: 9,
        },
        [`${ORG}::wi-shared`]: {
          id: `${ORG}::wi-shared`, title: "Shared item", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1`, [`${ORG}::bt-2`]: `${ORG}::bl-2` },
          ranks: { [`${ORG}::bl-1`]: 1, [`${ORG}::bl-2`]: 1 },
        },
        [`${ORG}::wi-tree2only`]: {
          id: `${ORG}::wi-tree2only`, title: "Tree-2-only item", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-2`]: `${ORG}::bl-2` },
          ranks: { [`${ORG}::bl-2`]: 2 },
        },
      },
      undoStack: [], redoStack: [], isLoading: false,
    });
    useAppStore.getState().respawnItem(`${ORG}::wi-1`);
    // wi-shared shifted from 1 → 2 in bl-1; wi-tree2only unchanged (not in bl-1)
    expect(useAppStore.getState().workItems[`${ORG}::wi-shared`].ranks[`${ORG}::bl-1`]).toBe(2);
    expect(useAppStore.getState().workItems[`${ORG}::wi-tree2only`].ranks[`${ORG}::bl-2`]).toBe(2);
  });

  it("respawned item is a single instance visible in all trees via backlogAssignments", () => {
    seedRespawnStore();
    useAppStore.getState().respawnItem(`${ORG}::wi-1`);
    const items = Object.values(useAppStore.getState().workItems);
    const copy = items.find((i) => i.id !== `${ORG}::wi-1`)!;
    useAppStore.getState().setWorkItemStatus(copy.id, "done");
    // The single item's status is done, visible in all trees via backlogAssignments
    expect(useAppStore.getState().workItems[copy.id].status).toBe("done");
    expect(Object.keys(useAppStore.getState().workItems[copy.id].backlogAssignments).length).toBe(2);
  });

  function seedRespawnChildStore() {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "Backlog 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`,
          title: "Parent Item",
          status: "not_started" as const,
          parentId: null,
          childrenIds: [`${ORG}::wi-child`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` },
          ranks: { [`${ORG}::bl-1`]: 0 },
        },
        [`${ORG}::wi-child`]: {
          id: `${ORG}::wi-child`,
          title: "Child Item",
          status: "done" as const,
          parentId: `${ORG}::wi-parent`,
          childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` },
          ranks: { [`${ORG}::bl-1`]: 0 },
          respawnEnabled: true,
          respawnIntervalDays: 7,
          respawnHour: 9,
        },
      },
      undoStack: [],
      redoStack: [],
      isLoading: false,
    });
  }

  it("respawned item inherits the same parentId as the original item", () => {
    seedRespawnChildStore();
    useAppStore.getState().respawnItem(`${ORG}::wi-child`);
    const items = Object.values(useAppStore.getState().workItems);
    const copy = items.find((i) => i.id !== `${ORG}::wi-child` && i.id !== `${ORG}::wi-parent`);
    expect(copy).toBeDefined();
    expect(copy!.parentId).toBe(`${ORG}::wi-parent`);
  });

  it("respawned item is added to the parent's childrenIds", () => {
    seedRespawnChildStore();
    useAppStore.getState().respawnItem(`${ORG}::wi-child`);
    const items = Object.values(useAppStore.getState().workItems);
    const copy = items.find((i) => i.id !== `${ORG}::wi-child` && i.id !== `${ORG}::wi-parent`);
    expect(copy).toBeDefined();
    const parent = useAppStore.getState().workItems[`${ORG}::wi-parent`];
    expect(parent.childrenIds).toContain(copy!.id);
  });
});

// ─── BACKLOG CRUD ──────────────────────────────────────────────────────

describe("addBacklog", () => {
  it("creates a root backlog", () => {
    seedStore();
    useAppStore.getState().addBacklog("New BL", null, `${ORG}::bt-1`);
    const bls = Object.values(useAppStore.getState().backlogs);
    expect(bls.length).toBe(2);
    const tree = useAppStore.getState().backlogTrees[`${ORG}::bt-1`];
    expect(tree.rootBacklogIds.length).toBe(2);
  });

  it("creates a child backlog", () => {
    seedStore();
    useAppStore.getState().addBacklog("Child BL", `${ORG}::bl-1`, `${ORG}::bt-1`);
    const parent = useAppStore.getState().backlogs[`${ORG}::bl-1`];
    expect(parent.childrenIds.length).toBe(1);
  });
});

describe("deleteBacklog", () => {
  it("removes backlog and orphaned work items", () => {
    seedStore();
    useAppStore.getState().deleteBacklog(`${ORG}::bl-1`);
    expect(useAppStore.getState().backlogs[`${ORG}::bl-1`]).toBeUndefined();
    // wi-1 was only assigned to bl-1, so should be deleted
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`]).toBeUndefined();
  });

  it("removes from tree rootBacklogIds", () => {
    seedStore();
    useAppStore.getState().deleteBacklog(`${ORG}::bl-1`);
    const tree = useAppStore.getState().backlogTrees[`${ORG}::bt-1`];
    expect(tree.rootBacklogIds).not.toContain(`${ORG}::bl-1`);
  });
});

describe("renameBacklog", () => {
  it("updates name", () => {
    seedStore();
    useAppStore.getState().renameBacklog(`${ORG}::bl-1`, "Renamed BL");
    expect(useAppStore.getState().backlogs[`${ORG}::bl-1`].name).toBe("Renamed BL");
  });
});

// ─── BACKLOG TREE CRUD ─────────────────────────────────────────────────

describe("addBacklogTree", () => {
  it("creates a new tree", () => {
    seedStore();
    useAppStore.getState().addBacklogTree("New Tree");
    const trees = Object.values(useAppStore.getState().backlogTrees);
    expect(trees.length).toBe(2);
    expect(trees.find((t) => t.name === "New Tree")).toBeDefined();
  });

  it("assigns a non-duplicate rank after a tree has been deleted", () => {
    // Two trees with a gap in ranks (simulating a deletion): ranks 0 and 2.
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "Tree 2", rootBacklogIds: [], rank: 2 },
      },
      backlogs: {},
      workItems: {},
      selectedWorkItemIds: [],
      undoStack: [], redoStack: [], isLoading: false,
    });
    useAppStore.getState().addBacklogTree("New Tree");
    const ranks = Object.values(useAppStore.getState().backlogTrees).map((t) => t.rank);
    expect(new Set(ranks).size).toBe(ranks.length); // all ranks unique
  });
});

describe("deleteBacklogTree", () => {
  it("removes tree, backlogs, and orphaned items", () => {
    seedStore();
    useAppStore.getState().deleteBacklogTree(`${ORG}::bt-1`);
    expect(useAppStore.getState().backlogTrees[`${ORG}::bt-1`]).toBeUndefined();
    expect(useAppStore.getState().backlogs[`${ORG}::bl-1`]).toBeUndefined();
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`]).toBeUndefined();
  });
});

describe("renameBacklogTree", () => {
  it("updates name", () => {
    seedStore();
    useAppStore.getState().renameBacklogTree(`${ORG}::bt-1`, "Renamed Tree");
    expect(useAppStore.getState().backlogTrees[`${ORG}::bt-1`].name).toBe("Renamed Tree");
  });
});

// ─── UNDO / REDO ───────────────────────────────────────────────────────

describe("undo/redo", () => {
  it("undoes the last action", () => {
    seedStore();
    useAppStore.getState().renameWorkItem(`${ORG}::wi-1`, "Changed");
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`].title).toBe("Changed");
    useAppStore.getState().undo();
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`].title).toBe("Item 1");
  });

  it("redoes after undo", () => {
    seedStore();
    useAppStore.getState().renameWorkItem(`${ORG}::wi-1`, "Changed");
    useAppStore.getState().undo();
    useAppStore.getState().redo();
    expect(useAppStore.getState().workItems[`${ORG}::wi-1`].title).toBe("Changed");
  });
});

// ─── SANITIZE DATA ─────────────────────────────────────────────────────

describe("sanitizeData", () => {
  it("cleans double-prefixed IDs", () => {
    const result = sanitizeData({
      workItems: {
        [`${ORG}::${ORG}::wi-1`]: {
          id: `${ORG}::${ORG}::wi-1`, title: "Test", status: "not_started",
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 },
        },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "BL", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
      },
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
      },
    }, ORG);
    expect(result.workItems[`${ORG}::wi-1`]).toBeDefined();
    expect(result.workItems[`${ORG}::${ORG}::wi-1`]).toBeUndefined();
  });

  it("removes invalid backlog assignments", () => {
    const result = sanitizeData({
      workItems: {
        "wi-1": {
          id: "wi-1", title: "Test", status: "not_started",
          parentId: null, childrenIds: [],
          backlogAssignments: { "bt-1": "bl-nonexistent" }, ranks: { "bl-nonexistent": 0 },
        },
      },
      backlogs: {},
      backlogTrees: { "bt-1": { id: "bt-1", name: "Tree", rootBacklogIds: [], rank: 0 } },
    }, ORG);
    const wi = result.workItems[`${ORG}::wi-1`];
    expect(Object.keys(wi.backlogAssignments)).toHaveLength(0);
  });

  it("rebuilds childrenIds", () => {
    const result = sanitizeData({
      workItems: {
        "wi-1": { id: "wi-1", title: "Parent", status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { "bt-1": "bl-1" }, ranks: { "bl-1": 0 } },
        "wi-2": { id: "wi-2", title: "Child", status: "not_started", parentId: "wi-1", childrenIds: [], backlogAssignments: { "bt-1": "bl-1" }, ranks: { "bl-1": 0 } },
      },
      backlogs: { "bl-1": { id: "bl-1", name: "BL", parentId: null, childrenIds: [], treeId: "bt-1", rank: 0 } },
      backlogTrees: { "bt-1": { id: "bt-1", name: "Tree", rootBacklogIds: ["bl-1"], rank: 0 } },
    }, ORG);
    expect(result.workItems[`${ORG}::wi-1`].childrenIds).toContain(`${ORG}::wi-2`);
  });
});

// ─── HYPERLINKS ────────────────────────────────────────────────────────

// ─── REORDER WORK ITEMS ────────────────────────────────────────────────

describe("reorderWorkItemAmongSiblings", () => {
  function seedThreeItems() {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "BL 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-a`]: { id: `${ORG}::wi-a`, title: "A", status: "not_started" as const, parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 } },
        [`${ORG}::wi-b`]: { id: `${ORG}::wi-b`, title: "B", status: "not_started" as const, parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 1 } },
        [`${ORG}::wi-c`]: { id: `${ORG}::wi-c`, title: "C", status: "not_started" as const, parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 2 } },
      },
      selectedWorkItemIds: [],
      undoStack: [], redoStack: [], isLoading: false,
    });
  }

  function rankedOrder() {
    return Object.values(useAppStore.getState().workItems)
      .sort((a, b) => (a.ranks[`${ORG}::bl-1`] ?? 0) - (b.ranks[`${ORG}::bl-1`] ?? 0))
      .map((wi) => wi.title);
  }

  it("moves first item to end", () => {
    seedThreeItems();
    useAppStore.getState().reorderWorkItemAmongSiblings(`${ORG}::wi-a`, 3, `${ORG}::bt-1`, [`${ORG}::bl-1`]);
    expect(rankedOrder()).toEqual(["B", "C", "A"]);
  });

  it("moves last item to beginning", () => {
    seedThreeItems();
    useAppStore.getState().reorderWorkItemAmongSiblings(`${ORG}::wi-c`, 0, `${ORG}::bt-1`, [`${ORG}::bl-1`]);
    expect(rankedOrder()).toEqual(["C", "A", "B"]);
  });

  it("moves middle item to beginning", () => {
    seedThreeItems();
    useAppStore.getState().reorderWorkItemAmongSiblings(`${ORG}::wi-b`, 0, `${ORG}::bt-1`, [`${ORG}::bl-1`]);
    expect(rankedOrder()).toEqual(["B", "A", "C"]);
  });

  it("clamps out-of-range index to end", () => {
    seedThreeItems();
    useAppStore.getState().reorderWorkItemAmongSiblings(`${ORG}::wi-a`, 999, `${ORG}::bt-1`, [`${ORG}::bl-1`]);
    expect(rankedOrder()).toEqual(["B", "C", "A"]);
  });

  it("pushes to undo stack", () => {
    seedThreeItems();
    useAppStore.getState().reorderWorkItemAmongSiblings(`${ORG}::wi-a`, 3, `${ORG}::bt-1`, [`${ORG}::bl-1`]);
    expect(useAppStore.getState().undoStack.length).toBeGreaterThan(0);
  });

  it("moves cross-context sub-task to top of flat view (rank issue regression)", () => {
    // wi-a and wi-b are root items (parentId=null) in bl-1 with negative ranks from
    // addWorkItem default (minRank-1).  wi-cross has a non-null parentId whose parent
    // (wi-ext) is NOT in bl-1, so wi-cross appears at root level in the flat view.
    // Before the fix, reorderWorkItemAmongSiblings with targetIndex=0 would only
    // consider wi-cross's own parentId group (just itself), assign rank=0, and leave
    // wi-a(rank=-2) and wi-b(rank=-1) sorting before it.  After the fix all three
    // root-visible items are treated as siblings and wi-cross correctly reaches rank 0.
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "BL 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
      },
      workItems: {
        // wi-ext is the parent of wi-cross but is NOT assigned to bl-1.
        [`${ORG}::wi-ext`]: { id: `${ORG}::wi-ext`, title: "Ext", status: "not_started" as const, parentId: null, childrenIds: [`${ORG}::wi-cross`], backlogAssignments: {}, ranks: {} },
        // wi-cross is a sub-task of wi-ext AND also in bl-1 → appears as root in flat view.
        [`${ORG}::wi-cross`]: { id: `${ORG}::wi-cross`, title: "Cross", status: "not_started" as const, parentId: `${ORG}::wi-ext`, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 5 } },
        // wi-a and wi-b are true root items in bl-1 with negative ranks.
        [`${ORG}::wi-a`]: { id: `${ORG}::wi-a`, title: "A", status: "not_started" as const, parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: -2 } },
        [`${ORG}::wi-b`]: { id: `${ORG}::wi-b`, title: "B", status: "not_started" as const, parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: -1 } },
      },
      selectedWorkItemIds: [`${ORG}::wi-cross`],
      undoStack: [], redoStack: [], isLoading: false,
    });

    useAppStore.getState().reorderWorkItemAmongSiblings(`${ORG}::wi-cross`, 0, `${ORG}::bt-1`, [`${ORG}::bl-1`]);

    const items = useAppStore.getState().workItems;
    // wi-cross must have the lowest rank so it sorts first in the flat view.
    expect(items[`${ORG}::wi-cross`].ranks[`${ORG}::bl-1`]).toBeLessThan(items[`${ORG}::wi-a`].ranks[`${ORG}::bl-1`]);
    expect(items[`${ORG}::wi-cross`].ranks[`${ORG}::bl-1`]).toBeLessThan(items[`${ORG}::wi-b`].ranks[`${ORG}::bl-1`]);
  });

  it("moves cross-context sub-task to bottom of flat view (rank issue regression)", () => {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "BL 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-ext`]: { id: `${ORG}::wi-ext`, title: "Ext", status: "not_started" as const, parentId: null, childrenIds: [`${ORG}::wi-cross`], backlogAssignments: {}, ranks: {} },
        [`${ORG}::wi-cross`]: { id: `${ORG}::wi-cross`, title: "Cross", status: "not_started" as const, parentId: `${ORG}::wi-ext`, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: -5 } },
        [`${ORG}::wi-a`]: { id: `${ORG}::wi-a`, title: "A", status: "not_started" as const, parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 0 } },
        [`${ORG}::wi-b`]: { id: `${ORG}::wi-b`, title: "B", status: "not_started" as const, parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 1 } },
      },
      selectedWorkItemIds: [`${ORG}::wi-cross`],
      undoStack: [], redoStack: [], isLoading: false,
    });

    useAppStore.getState().reorderWorkItemAmongSiblings(`${ORG}::wi-cross`, 999999, `${ORG}::bt-1`, [`${ORG}::bl-1`]);

    const items = useAppStore.getState().workItems;
    // wi-cross must have the highest rank so it sorts last in the flat view.
    expect(items[`${ORG}::wi-cross`].ranks[`${ORG}::bl-1`]).toBeGreaterThan(items[`${ORG}::wi-a`].ranks[`${ORG}::bl-1`]);
    expect(items[`${ORG}::wi-cross`].ranks[`${ORG}::bl-1`]).toBeGreaterThan(items[`${ORG}::wi-b`].ranks[`${ORG}::bl-1`]);
  });
});

// ─── REORDER BACKLOGS ──────────────────────────────────────────────────

describe("reorderBacklogAmongSiblings", () => {
  function seedThreeBacklogs() {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: {
          id: `${ORG}::bt-1`,
          name: "Tree 1",
          rootBacklogIds: [`${ORG}::bl-a`, `${ORG}::bl-b`, `${ORG}::bl-c`],
          rank: 0,
        },
      },
      backlogs: {
        [`${ORG}::bl-a`]: { id: `${ORG}::bl-a`, name: "A", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-b`]: { id: `${ORG}::bl-b`, name: "B", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
        [`${ORG}::bl-c`]: { id: `${ORG}::bl-c`, name: "C", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 2 },
      },
      workItems: {},
      selectedWorkItemIds: [],
      undoStack: [], redoStack: [], isLoading: false,
    });
  }

  function rootOrder() {
    const tree = useAppStore.getState().backlogTrees[`${ORG}::bt-1`];
    return tree.rootBacklogIds.map((id) => useAppStore.getState().backlogs[id]?.name);
  }

  it("moves first backlog to end", () => {
    seedThreeBacklogs();
    useAppStore.getState().reorderBacklogAmongSiblings(`${ORG}::bl-a`, 3, null, `${ORG}::bt-1`);
    expect(rootOrder()).toEqual(["B", "C", "A"]);
  });

  it("moves last backlog to beginning", () => {
    seedThreeBacklogs();
    useAppStore.getState().reorderBacklogAmongSiblings(`${ORG}::bl-c`, 0, null, `${ORG}::bt-1`);
    expect(rootOrder()).toEqual(["C", "A", "B"]);
  });

  it("moves middle backlog to beginning", () => {
    seedThreeBacklogs();
    useAppStore.getState().reorderBacklogAmongSiblings(`${ORG}::bl-b`, 0, null, `${ORG}::bt-1`);
    expect(rootOrder()).toEqual(["B", "A", "C"]);
  });

  it("reorders child backlogs within their parent", () => {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-root`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-root`]: { id: `${ORG}::bl-root`, name: "Root", parentId: null, childrenIds: [`${ORG}::bl-x`, `${ORG}::bl-y`], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-x`]: { id: `${ORG}::bl-x`, name: "X", parentId: `${ORG}::bl-root`, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-y`]: { id: `${ORG}::bl-y`, name: "Y", parentId: `${ORG}::bl-root`, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
      },
      workItems: {},
      selectedWorkItemIds: [],
      undoStack: [], redoStack: [], isLoading: false,
    });
    useAppStore.getState().reorderBacklogAmongSiblings(`${ORG}::bl-x`, 2, `${ORG}::bl-root`, `${ORG}::bt-1`);
    const parent = useAppStore.getState().backlogs[`${ORG}::bl-root`];
    expect(parent.childrenIds).toEqual([`${ORG}::bl-y`, `${ORG}::bl-x`]);
  });

  it("cross-parent: moveBacklog then reorderBacklogAmongSiblings moves to new parent at correct position", () => {
    // BL-root has children [BL-x, BL-y]. BL-z is a root sibling of BL-root.
    // Simulate what handleDragEnd does: moveBacklog(BL-z, BL-root) then reorder at index 1.
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: {
          id: `${ORG}::bt-1`,
          name: "Tree 1",
          rootBacklogIds: [`${ORG}::bl-root`, `${ORG}::bl-z`],
          rank: 0,
        },
      },
      backlogs: {
        [`${ORG}::bl-root`]: { id: `${ORG}::bl-root`, name: "Root", parentId: null, childrenIds: [`${ORG}::bl-x`, `${ORG}::bl-y`], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-x`]: { id: `${ORG}::bl-x`, name: "X", parentId: `${ORG}::bl-root`, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-y`]: { id: `${ORG}::bl-y`, name: "Y", parentId: `${ORG}::bl-root`, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
        [`${ORG}::bl-z`]: { id: `${ORG}::bl-z`, name: "Z", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
      },
      workItems: {},
      selectedWorkItemIds: [],
      undoStack: [], redoStack: [], isLoading: false,
    });
    // Move BL-z under BL-root, then reorder it to position 1 (between X and Y)
    useAppStore.getState().moveBacklog(`${ORG}::bl-z`, `${ORG}::bl-root`, `${ORG}::bt-1`);
    useAppStore.getState().reorderBacklogAmongSiblings(`${ORG}::bl-z`, 1, `${ORG}::bl-root`, `${ORG}::bt-1`);
    const parent = useAppStore.getState().backlogs[`${ORG}::bl-root`];
    expect(parent.childrenIds).toEqual([`${ORG}::bl-x`, `${ORG}::bl-z`, `${ORG}::bl-y`]);
  });

  it("pushes to undo stack", () => {
    seedThreeBacklogs();
    useAppStore.getState().reorderBacklogAmongSiblings(`${ORG}::bl-a`, 3, null, `${ORG}::bt-1`);
    expect(useAppStore.getState().undoStack.length).toBeGreaterThan(0);
  });
});

// ─── MOVE BACKLOG ──────────────────────────────────────────────────────

describe("moveBacklog", () => {
  it("assigns a non-duplicate rank when moved into a parent that already has a sibling at the same rank", () => {
    // bl-x is a child of bl-root at rank 0.
    // bl-z is a root-level backlog also at rank 0.
    // After moving bl-z under bl-root, both bl-x and bl-z would share rank 0 – the fix
    // must assign bl-z a rank that does not conflict (maxRank + 1 = 1).
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: {
          id: `${ORG}::bt-1`, name: "Tree 1",
          rootBacklogIds: [`${ORG}::bl-root`, `${ORG}::bl-z`], rank: 0,
        },
      },
      backlogs: {
        [`${ORG}::bl-root`]: { id: `${ORG}::bl-root`, name: "Root", parentId: null, childrenIds: [`${ORG}::bl-x`], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-x`]: { id: `${ORG}::bl-x`, name: "X", parentId: `${ORG}::bl-root`, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-z`]: { id: `${ORG}::bl-z`, name: "Z", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
      },
      workItems: {},
      selectedWorkItemIds: [],
      undoStack: [], redoStack: [], isLoading: false,
    });
    useAppStore.getState().moveBacklog(`${ORG}::bl-z`, `${ORG}::bl-root`, `${ORG}::bt-1`);
    const movedBl = useAppStore.getState().backlogs[`${ORG}::bl-z`];
    const existingBl = useAppStore.getState().backlogs[`${ORG}::bl-x`];
    expect(movedBl.rank).not.toBe(existingBl.rank);
  });

  it("cross-tree: moves a root backlog to another tree's root", () => {
    // bl-a is in tree-1. Moving it to tree-2 as root.
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-a`], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "Tree 2", rootBacklogIds: [], rank: 1 },
      },
      backlogs: {
        [`${ORG}::bl-a`]: { id: `${ORG}::bl-a`, name: "A", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-1`]: {
          id: `${ORG}::wi-1`, title: "Item 1", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-a` },
          ranks: { [`${ORG}::bl-a`]: 0 },
        },
      },
      selectedWorkItemIds: [],
      undoStack: [], redoStack: [], isLoading: false,
    });
    useAppStore.getState().moveBacklog(`${ORG}::bl-a`, null, `${ORG}::bt-2`);
    const s = useAppStore.getState();
    // backlog moved to tree-2
    expect(s.backlogs[`${ORG}::bl-a`].treeId).toBe(`${ORG}::bt-2`);
    expect(s.backlogs[`${ORG}::bl-a`].parentId).toBeNull();
    // tree membership updated
    expect(s.backlogTrees[`${ORG}::bt-1`].rootBacklogIds).not.toContain(`${ORG}::bl-a`);
    expect(s.backlogTrees[`${ORG}::bt-2`].rootBacklogIds).toContain(`${ORG}::bl-a`);
    // work item backlog assignment remapped
    const wi = s.workItems[`${ORG}::wi-1`];
    expect(wi.backlogAssignments[`${ORG}::bt-1`]).toBeUndefined();
    expect(wi.backlogAssignments[`${ORG}::bt-2`]).toBe(`${ORG}::bl-a`);
  });

  it("cross-tree: updates treeId of descendant backlogs and their work items", () => {
    // bl-parent (tree-1) has child bl-child. Work items in bl-child also need remapping.
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-parent`], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "Tree 2", rootBacklogIds: [], rank: 1 },
      },
      backlogs: {
        [`${ORG}::bl-parent`]: { id: `${ORG}::bl-parent`, name: "Parent", parentId: null, childrenIds: [`${ORG}::bl-child`], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-child`]: { id: `${ORG}::bl-child`, name: "Child", parentId: `${ORG}::bl-parent`, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-p`]: {
          id: `${ORG}::wi-p`, title: "In parent", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-parent` },
          ranks: { [`${ORG}::bl-parent`]: 0 },
        },
        [`${ORG}::wi-c`]: {
          id: `${ORG}::wi-c`, title: "In child", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-child` },
          ranks: { [`${ORG}::bl-child`]: 0 },
        },
      },
      selectedWorkItemIds: [],
      undoStack: [], redoStack: [], isLoading: false,
    });
    useAppStore.getState().moveBacklog(`${ORG}::bl-parent`, null, `${ORG}::bt-2`);
    const s = useAppStore.getState();
    // Both backlogs in tree-2
    expect(s.backlogs[`${ORG}::bl-parent`].treeId).toBe(`${ORG}::bt-2`);
    expect(s.backlogs[`${ORG}::bl-child`].treeId).toBe(`${ORG}::bt-2`);
    // Work items remapped
    expect(s.workItems[`${ORG}::wi-p`].backlogAssignments[`${ORG}::bt-2`]).toBe(`${ORG}::bl-parent`);
    expect(s.workItems[`${ORG}::wi-p`].backlogAssignments[`${ORG}::bt-1`]).toBeUndefined();
    expect(s.workItems[`${ORG}::wi-c`].backlogAssignments[`${ORG}::bt-2`]).toBe(`${ORG}::bl-child`);
    expect(s.workItems[`${ORG}::wi-c`].backlogAssignments[`${ORG}::bt-1`]).toBeUndefined();
  });
});

// ─── REORDER BACKLOG TREES ─────────────────────────────────────────────

describe("reorderBacklogTree", () => {
  function seedThreeTrees() {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "Tree 2", rootBacklogIds: [], rank: 1 },
        [`${ORG}::bt-3`]: { id: `${ORG}::bt-3`, name: "Tree 3", rootBacklogIds: [], rank: 2 },
      },
      backlogs: {},
      workItems: {},
      selectedWorkItemIds: [],
      undoStack: [], redoStack: [], isLoading: false,
    });
  }

  function treeOrder() {
    return Object.values(useAppStore.getState().backlogTrees)
      .sort((a, b) => a.rank - b.rank)
      .map((t) => t.name);
  }

  it("moves first tree to end", () => {
    seedThreeTrees();
    useAppStore.getState().reorderBacklogTree(`${ORG}::bt-1`, 3);
    expect(treeOrder()).toEqual(["Tree 2", "Tree 3", "Tree 1"]);
  });

  it("moves last tree to beginning", () => {
    seedThreeTrees();
    useAppStore.getState().reorderBacklogTree(`${ORG}::bt-3`, 0);
    expect(treeOrder()).toEqual(["Tree 3", "Tree 1", "Tree 2"]);
  });

  it("moves middle tree to beginning", () => {
    seedThreeTrees();
    useAppStore.getState().reorderBacklogTree(`${ORG}::bt-2`, 0);
    expect(treeOrder()).toEqual(["Tree 2", "Tree 1", "Tree 3"]);
  });

  it("pushes to undo stack", () => {
    seedThreeTrees();
    useAppStore.getState().reorderBacklogTree(`${ORG}::bt-1`, 3);
    expect(useAppStore.getState().undoStack.length).toBeGreaterThan(0);
  });
});

// ─── HYPERLINKS ────────────────────────────────────────────────────────

describe("addHyperlink", () => {
  it("adds a hyperlink to a work item", () => {
    seedStore();
    useAppStore.getState().addHyperlink(`${ORG}::wi-1`, "https://example.com", "Example");
    const links = useAppStore.getState().hyperlinks[`${ORG}::wi-1`];
    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://example.com");
    expect(links[0].altText).toBe("Example");
    expect(links[0].workItemId).toBe(`${ORG}::wi-1`);
    expect(links[0].rank).toBe(0);
  });

  it("increments rank for subsequent links", () => {
    seedStore();
    useAppStore.getState().addHyperlink(`${ORG}::wi-1`, "https://a.com", "A");
    useAppStore.getState().addHyperlink(`${ORG}::wi-1`, "https://b.com", "B");
    const links = useAppStore.getState().hyperlinks[`${ORG}::wi-1`];
    expect(links).toHaveLength(2);
    expect(links[0].rank).toBe(0);
    expect(links[1].rank).toBe(1);
  });

  it("allows empty alt text", () => {
    seedStore();
    useAppStore.getState().addHyperlink(`${ORG}::wi-1`, "https://example.com", "");
    const links = useAppStore.getState().hyperlinks[`${ORG}::wi-1`];
    expect(links[0].altText).toBe("");
  });

  it("pushes to undo stack", () => {
    seedStore();
    useAppStore.getState().addHyperlink(`${ORG}::wi-1`, "https://example.com", "Example");
    expect(useAppStore.getState().undoStack.length).toBeGreaterThan(0);
  });
});

describe("updateHyperlink", () => {
  it("updates URL and alt text of an existing hyperlink", () => {
    seedStore();
    useAppStore.getState().addHyperlink(`${ORG}::wi-1`, "https://old.com", "Old");
    const links = useAppStore.getState().hyperlinks[`${ORG}::wi-1`];
    const linkId = links[0].id;
    useAppStore.getState().updateHyperlink(linkId, `${ORG}::wi-1`, "https://new.com", "New");
    const updated = useAppStore.getState().hyperlinks[`${ORG}::wi-1`];
    expect(updated).toHaveLength(1);
    expect(updated[0].url).toBe("https://new.com");
    expect(updated[0].altText).toBe("New");
  });

  it("does nothing for non-existent link ID", () => {
    seedStore();
    useAppStore.getState().addHyperlink(`${ORG}::wi-1`, "https://old.com", "Old");
    useAppStore.getState().updateHyperlink("nonexistent", `${ORG}::wi-1`, "https://new.com", "New");
    const links = useAppStore.getState().hyperlinks[`${ORG}::wi-1`];
    expect(links[0].url).toBe("https://old.com");
  });
});

// ─── BULK ADD WORK ITEMS ───────────────────────────────────────────────

describe("bulkAddWorkItems", () => {
  it("assigns unique sequential ranks starting after the existing max rank", () => {
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "BL 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-1`]: {
          id: `${ORG}::wi-1`, title: "Existing", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, ranks: { [`${ORG}::bl-1`]: 2 },
        },
      },
      undoStack: [], redoStack: [], isLoading: false,
    });
    useAppStore.getState().bulkAddWorkItems(["A", "B", "C"], null, `${ORG}::bl-1`, `${ORG}::bt-1`);
    const items = Object.values(useAppStore.getState().workItems);
    const newItems = items.filter((wi) => wi.title !== "Existing");
    const ranks = newItems.map((wi) => wi.ranks[`${ORG}::bl-1`]).sort((a, b) => a - b);
    // All ranks must be unique and all above the existing max rank of 2
    expect(new Set(ranks).size).toBe(ranks.length);
    expect(ranks.every((r) => r > 2)).toBe(true);
  });

  it("does not produce duplicate ranks when child backlogs have items at higher ranks", () => {
    // bl-parent has an item at rank=1; bl-child (child of bl-parent) has an item at rank=3.
    // The combined panel shows both at the same level, sorted by rank.
    // Pasting into bl-parent must start ranks AFTER rank=3 (the child-backlog max),
    // not after rank=1 (the parent-backlog max) which would collide with the child item.
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "Tree 1", rootBacklogIds: [`${ORG}::bl-parent`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-parent`]: {
          id: `${ORG}::bl-parent`, name: "Parent BL", parentId: null,
          childrenIds: [`${ORG}::bl-child`], treeId: `${ORG}::bt-1`, rank: 0,
        },
        [`${ORG}::bl-child`]: {
          id: `${ORG}::bl-child`, name: "Child BL", parentId: `${ORG}::bl-parent`,
          childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1,
        },
      },
      workItems: {
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent item", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-parent` }, ranks: { [`${ORG}::bl-parent`]: 1 },
        },
        [`${ORG}::wi-child`]: {
          id: `${ORG}::wi-child`, title: "Child item", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-child` }, ranks: { [`${ORG}::bl-child`]: 3 },
        },
      },
      undoStack: [], redoStack: [], isLoading: false,
    });
    useAppStore.getState().bulkAddWorkItems(["X", "Y"], null, `${ORG}::bl-parent`, `${ORG}::bt-1`);
    const allItems = Object.values(useAppStore.getState().workItems);
    const pastedItems = allItems.filter((wi) => wi.title === "X" || wi.title === "Y");
    const childItem = useAppStore.getState().workItems[`${ORG}::wi-child`];
    // Pasted items must not share a rank with the child-backlog item (rank=3)
    expect(pastedItems.every((pi) => pi.ranks[`${ORG}::bl-parent`] !== childItem.ranks[`${ORG}::bl-child`])).toBe(true);
    // All pasted ranks must be unique
    const pastedRanks = pastedItems.map((pi) => pi.ranks[`${ORG}::bl-parent`]);
    expect(new Set(pastedRanks).size).toBe(pastedRanks.length);
    // Pasted items should appear after ALL existing items (rank > 3)
    expect(pastedItems.every((pi) => pi.ranks[`${ORG}::bl-parent`] > 3)).toBe(true);
  });
});

describe("removeHyperlink", () => {
  it("removes a hyperlink from a work item", () => {
    seedStore();
    useAppStore.getState().addHyperlink(`${ORG}::wi-1`, "https://example.com", "Example");
    const links = useAppStore.getState().hyperlinks[`${ORG}::wi-1`];
    const linkId = links[0].id;
    useAppStore.getState().removeHyperlink(linkId, `${ORG}::wi-1`);
    const remaining = useAppStore.getState().hyperlinks[`${ORG}::wi-1`];
    expect(remaining).toHaveLength(0);
  });

  it("only removes the specified hyperlink", () => {
    seedStore();
    useAppStore.getState().addHyperlink(`${ORG}::wi-1`, "https://a.com", "A");
    useAppStore.getState().addHyperlink(`${ORG}::wi-1`, "https://b.com", "B");
    const links = useAppStore.getState().hyperlinks[`${ORG}::wi-1`];
    const firstId = links[0].id;
    useAppStore.getState().removeHyperlink(firstId, `${ORG}::wi-1`);
    const remaining = useAppStore.getState().hyperlinks[`${ORG}::wi-1`];
    expect(remaining).toHaveLength(1);
    expect(remaining[0].url).toBe("https://b.com");
  });

  it("pushes to undo stack", () => {
    seedStore();
    useAppStore.getState().addHyperlink(`${ORG}::wi-1`, "https://example.com", "Example");
    const stackBefore = useAppStore.getState().undoStack.length;
    const links = useAppStore.getState().hyperlinks[`${ORG}::wi-1`];
    useAppStore.getState().removeHyperlink(links[0].id, `${ORG}::wi-1`);
    expect(useAppStore.getState().undoStack.length).toBeGreaterThan(stackBefore);
  });
});

// ─── CROSS-CONTEXT DUPLICATE RANK REGRESSION TESTS ────────────────────

describe("moveWorkItemToBacklog cross-context rank", () => {
  it("avoids duplicate ranks in other tree contexts after move", () => {
    // wi-a is in bt-1:bl-1 AND bt-2:bl-2 at rank 0.
    // wi-b is in bt-2:bl-2 only at rank 0.
    // Moving wi-a from bl-1 to bl-3 (in bt-1) must not assign rank 0
    // because that would collide with wi-b in the bt-2:bl-2 context.
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "T1", rootBacklogIds: [`${ORG}::bl-1`, `${ORG}::bl-3`], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "T2", rootBacklogIds: [`${ORG}::bl-2`], rank: 1 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "BL 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "BL 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-2`, rank: 0 },
        [`${ORG}::bl-3`]: { id: `${ORG}::bl-3`, name: "BL 3", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
      },
      workItems: {
        [`${ORG}::wi-a`]: {
          id: `${ORG}::wi-a`, title: "A", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1`, [`${ORG}::bt-2`]: `${ORG}::bl-2` },
          ranks: { [`${ORG}::bl-1`]: 0, [`${ORG}::bl-2`]: 0 },
        },
        [`${ORG}::wi-b`]: {
          id: `${ORG}::wi-b`, title: "B", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-2`]: `${ORG}::bl-2` },
          ranks: { [`${ORG}::bl-2`]: 0 },
        },
      },
      undoStack: [], redoStack: [], isLoading: false,
    });

    useAppStore.getState().moveWorkItemToBacklog(`${ORG}::wi-a`, `${ORG}::bl-3`, `${ORG}::bt-1`);

    const a = useAppStore.getState().workItems[`${ORG}::wi-a`];
    const b = useAppStore.getState().workItems[`${ORG}::wi-b`];
    // With per-backlog ranks, wi-a gets a rank in bl-3 and keeps its bl-2 rank.
    // wi-b's rank in bl-2 is independent and unchanged.
    expect(a.ranks[`${ORG}::bl-3`]).toBeDefined();
    expect(b.ranks[`${ORG}::bl-2`]).toBe(0);
  });

  it("deduplicates child ranks when siblings were in different backlogs before the move", () => {
    // Parent P: bt-1:bl-A, rank=5
    // Child C1: bt-1:bl-B (individually moved there), rank=0
    // Child C2: bt-1:bl-A, rank=0
    // After moveWorkItemToBacklog(P, bl-C, bt-1), C1 and C2 are both in bt-1:bl-C.
    // Without a fix, both would remain at rank 0 → duplicate rank in (bt-1, bl-C, P) group.
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "T1", rootBacklogIds: [`${ORG}::bl-A`, `${ORG}::bl-B`, `${ORG}::bl-C`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-A`]: { id: `${ORG}::bl-A`, name: "BL A", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-B`]: { id: `${ORG}::bl-B`, name: "BL B", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
        [`${ORG}::bl-C`]: { id: `${ORG}::bl-C`, name: "BL C", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 2 },
      },
      workItems: {
        [`${ORG}::wi-P`]: {
          id: `${ORG}::wi-P`, title: "Parent", status: "not_started" as const,
          parentId: null, childrenIds: [`${ORG}::wi-C1`, `${ORG}::wi-C2`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-A` },
          ranks: { [`${ORG}::bl-A`]: 5 },
        },
        [`${ORG}::wi-C1`]: {
          id: `${ORG}::wi-C1`, title: "Child1", status: "not_started" as const,
          parentId: `${ORG}::wi-P`, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-B` },
          ranks: { [`${ORG}::bl-B`]: 0 },
        },
        [`${ORG}::wi-C2`]: {
          id: `${ORG}::wi-C2`, title: "Child2", status: "not_started" as const,
          parentId: `${ORG}::wi-P`, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-A` },
          ranks: { [`${ORG}::bl-A`]: 0 },
        },
      },
      undoStack: [], redoStack: [], isLoading: false,
    });

    useAppStore.getState().moveWorkItemToBacklog(`${ORG}::wi-P`, `${ORG}::bl-C`, `${ORG}::bt-1`);

    const items = useAppStore.getState().workItems;
    const c1 = items[`${ORG}::wi-C1`];
    const c2 = items[`${ORG}::wi-C2`];
    // Both children must be in bl-C after the move
    expect(c1.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-C`);
    expect(c2.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-C`);
    // Ranks must be unique (no duplicate within the (bt-1, bl-C, wi-P) group)
    expect(c1.ranks[`${ORG}::bl-C`]).not.toBe(c2.ranks[`${ORG}::bl-C`]);
  });

  it("deduplicates child ranks for multiple levels of hierarchy", () => {
    // Parent P: bt-1:bl-A
    // Child C1: bt-1:bl-B, rank=0; Grandchild G1: bt-1:bl-D, rank=0; Grandchild G2: bt-1:bl-B, rank=0
    // After moveWorkItemToBacklog(P, bl-C, bt-1):
    //   G1 and G2 both become bt-1:bl-C under C1 — ranks must not collide.
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "T1", rootBacklogIds: [`${ORG}::bl-A`, `${ORG}::bl-B`, `${ORG}::bl-C`, `${ORG}::bl-D`], rank: 0 },
      },
      backlogs: {
        [`${ORG}::bl-A`]: { id: `${ORG}::bl-A`, name: "BL A", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-B`]: { id: `${ORG}::bl-B`, name: "BL B", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 1 },
        [`${ORG}::bl-C`]: { id: `${ORG}::bl-C`, name: "BL C", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 2 },
        [`${ORG}::bl-D`]: { id: `${ORG}::bl-D`, name: "BL D", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 3 },
      },
      workItems: {
        [`${ORG}::wi-P`]: {
          id: `${ORG}::wi-P`, title: "Parent", status: "not_started" as const,
          parentId: null, childrenIds: [`${ORG}::wi-C1`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-A` },
          ranks: { [`${ORG}::bl-A`]: 0 },
        },
        [`${ORG}::wi-C1`]: {
          id: `${ORG}::wi-C1`, title: "Child1", status: "not_started" as const,
          parentId: `${ORG}::wi-P`, childrenIds: [`${ORG}::wi-G1`, `${ORG}::wi-G2`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-B` },
          ranks: { [`${ORG}::bl-B`]: 0 },
        },
        [`${ORG}::wi-G1`]: {
          id: `${ORG}::wi-G1`, title: "Grand1", status: "not_started" as const,
          parentId: `${ORG}::wi-C1`, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-D` },
          ranks: { [`${ORG}::bl-D`]: 0 },
        },
        [`${ORG}::wi-G2`]: {
          id: `${ORG}::wi-G2`, title: "Grand2", status: "not_started" as const,
          parentId: `${ORG}::wi-C1`, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-B` },
          ranks: { [`${ORG}::bl-B`]: 0 },
        },
      },
      undoStack: [], redoStack: [], isLoading: false,
    });

    useAppStore.getState().moveWorkItemToBacklog(`${ORG}::wi-P`, `${ORG}::bl-C`, `${ORG}::bt-1`);

    const items = useAppStore.getState().workItems;
    const g1 = items[`${ORG}::wi-G1`];
    const g2 = items[`${ORG}::wi-G2`];
    // Both grandchildren must be in bl-C after the move
    expect(g1.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-C`);
    expect(g2.backlogAssignments[`${ORG}::bt-1`]).toBe(`${ORG}::bl-C`);
    // Grandchildren ranks must be unique within their (bt-1, bl-C, wi-C1) group
    expect(g1.ranks[`${ORG}::bl-C`]).not.toBe(g2.ranks[`${ORG}::bl-C`]);
  });
});

describe("reorderWorkItemAmongSiblings cross-context rank", () => {
  it("shifts cross-context siblings when reorder creates a collision", () => {
    // bt-1:bl-1: wi-a(rank 0), wi-b(rank 1), wi-c(rank 2)
    // bt-2:bl-2: wi-b(rank 1), wi-d(rank 2)
    // wi-b is in both trees.
    // Reorder in bt-1:bl-1, moving wi-c to position 0 → [wi-c(0), wi-a(1), wi-b(2)].
    // wi-b's rank changes from 1 to 2 — now wi-d (rank 2 in bt-2) collides!
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "T1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "T2", rootBacklogIds: [`${ORG}::bl-2`], rank: 1 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "BL 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "BL 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-2`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-a`]: {
          id: `${ORG}::wi-a`, title: "A", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` },
          ranks: { [`${ORG}::bl-1`]: 0 },
        },
        [`${ORG}::wi-b`]: {
          id: `${ORG}::wi-b`, title: "B", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1`, [`${ORG}::bt-2`]: `${ORG}::bl-2` },
          ranks: { [`${ORG}::bl-1`]: 1, [`${ORG}::bl-2`]: 1 },
        },
        [`${ORG}::wi-c`]: {
          id: `${ORG}::wi-c`, title: "C", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` },
          ranks: { [`${ORG}::bl-1`]: 2 },
        },
        [`${ORG}::wi-d`]: {
          id: `${ORG}::wi-d`, title: "D", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-2`]: `${ORG}::bl-2` },
          ranks: { [`${ORG}::bl-2`]: 2 },
        },
      },
      selectedWorkItemIds: [],
      undoStack: [], redoStack: [], isLoading: false,
    });

    // Move wi-c to position 0 in bt-1:bl-1
    useAppStore.getState().reorderWorkItemAmongSiblings(
      `${ORG}::wi-c`, 0, `${ORG}::bt-1`, [`${ORG}::bl-1`],
    );

    const items = useAppStore.getState().workItems;
    // In bt-1:bl-1: wi-c(0), wi-a(1), wi-b(2)
    expect(items[`${ORG}::wi-c`].ranks[`${ORG}::bl-1`]).toBe(0);
    expect(items[`${ORG}::wi-a`].ranks[`${ORG}::bl-1`]).toBe(1);
    expect(items[`${ORG}::wi-b`].ranks[`${ORG}::bl-1`]).toBe(2);
    // With per-backlog ranks, wi-d's rank in bl-2 is independent of bl-1 reorder
    expect(items[`${ORG}::wi-d`].ranks[`${ORG}::bl-2`]).not.toBe(items[`${ORG}::wi-b`].ranks[`${ORG}::bl-2`]);
  });

  it("cascades cross-context shifts through transitive contexts", () => {
    // bt-1:bl-1: wi-a(0), wi-b(1)
    // bt-2:bl-2: wi-a(0), wi-c(1)
    // bt-3:bl-3: wi-c(1), wi-d(2)
    // Reorder in bt-1:bl-1, moving wi-b to position 0 → [wi-b(0), wi-a(1)].
    // wi-a moves 0→1 → collides with wi-c(1) in bt-2:bl-2.
    // wi-c pushed to 2 → collides with wi-d(2) in bt-3:bl-3.
    // wi-d must also be pushed.
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: {
        [`${ORG}::bt-1`]: { id: `${ORG}::bt-1`, name: "T1", rootBacklogIds: [`${ORG}::bl-1`], rank: 0 },
        [`${ORG}::bt-2`]: { id: `${ORG}::bt-2`, name: "T2", rootBacklogIds: [`${ORG}::bl-2`], rank: 1 },
        [`${ORG}::bt-3`]: { id: `${ORG}::bt-3`, name: "T3", rootBacklogIds: [`${ORG}::bl-3`], rank: 2 },
      },
      backlogs: {
        [`${ORG}::bl-1`]: { id: `${ORG}::bl-1`, name: "BL 1", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 },
        [`${ORG}::bl-2`]: { id: `${ORG}::bl-2`, name: "BL 2", parentId: null, childrenIds: [], treeId: `${ORG}::bt-2`, rank: 0 },
        [`${ORG}::bl-3`]: { id: `${ORG}::bl-3`, name: "BL 3", parentId: null, childrenIds: [], treeId: `${ORG}::bt-3`, rank: 0 },
      },
      workItems: {
        [`${ORG}::wi-a`]: {
          id: `${ORG}::wi-a`, title: "A", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1`, [`${ORG}::bt-2`]: `${ORG}::bl-2` },
          ranks: { [`${ORG}::bl-1`]: 0, [`${ORG}::bl-2`]: 0 },
        },
        [`${ORG}::wi-b`]: {
          id: `${ORG}::wi-b`, title: "B", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` },
          ranks: { [`${ORG}::bl-1`]: 1 },
        },
        [`${ORG}::wi-c`]: {
          id: `${ORG}::wi-c`, title: "C", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-2`]: `${ORG}::bl-2`, [`${ORG}::bt-3`]: `${ORG}::bl-3` },
          ranks: { [`${ORG}::bl-2`]: 1, [`${ORG}::bl-3`]: 1 },
        },
        [`${ORG}::wi-d`]: {
          id: `${ORG}::wi-d`, title: "D", status: "not_started" as const,
          parentId: null, childrenIds: [],
          backlogAssignments: { [`${ORG}::bt-3`]: `${ORG}::bl-3` },
          ranks: { [`${ORG}::bl-3`]: 2 },
        },
      },
      selectedWorkItemIds: [],
      undoStack: [], redoStack: [], isLoading: false,
    });

    useAppStore.getState().reorderWorkItemAmongSiblings(
      `${ORG}::wi-b`, 0, `${ORG}::bt-1`, [`${ORG}::bl-1`],
    );

    const items = useAppStore.getState().workItems;
    // bt-1:bl-1: wi-b(0), wi-a(1)
    expect(items[`${ORG}::wi-b`].ranks[`${ORG}::bl-1`]).toBe(0);
    expect(items[`${ORG}::wi-a`].ranks[`${ORG}::bl-1`]).toBe(1);
    // With per-backlog ranks, wi-c's rank in bl-2 is independent (no cross-context cascade)
    expect(items[`${ORG}::wi-c`].ranks[`${ORG}::bl-2`]).not.toBe(items[`${ORG}::wi-a`].ranks[`${ORG}::bl-2`]);
    // wi-d's rank in bl-3 is independent (no cross-context cascade)
    expect(items[`${ORG}::wi-d`].ranks[`${ORG}::bl-3`]).not.toBe(items[`${ORG}::wi-c`].ranks[`${ORG}::bl-3`]);
  });
});
