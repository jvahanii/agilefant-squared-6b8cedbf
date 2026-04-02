import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore, sanitizeData } from "@/store/appStore";

// Mock supabase sync — all DB calls are no-ops in tests
vi.mock("@/store/supabaseSync", () => ({
  loadFromSupabase: vi.fn().mockResolvedValue({ workItems: {}, backlogs: {}, backlogTrees: {} }),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
  deleteWorkItems: vi.fn(),
  upsertBacklog: vi.fn(),
  upsertBacklogs: vi.fn(),
  deleteBacklogs: vi.fn(),
  upsertBacklogTree: vi.fn(),
  deleteBacklogTree: vi.fn(),
  upsertBacklogTrees: vi.fn(),
  resetOrgData: vi.fn(),
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
        parentId: null, childrenIds: [], backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, rank: 0,
      },
    },
    undoStack: [],
    redoStack: [],
    isLoading: false,
  });
}

beforeEach(() => {
  useAppStore.setState({
    workItems: {}, backlogs: {}, backlogTrees: {},
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
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, rank: 0,
        },
        [`${ORG}::wi-grandparent`]: {
          id: `${ORG}::wi-grandparent`, title: "Grandparent", status: "not_started" as const,
          parentId: null, childrenIds: [`${ORG}::wi-parent`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, rank: 0,
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

  it("does not cascade to ancestors when status is not in_progress", () => {
    seedStore();
    useAppStore.setState({
      workItems: {
        ...useAppStore.getState().workItems,
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent", status: "not_started" as const,
          parentId: null, childrenIds: [`${ORG}::wi-1`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, rank: 0,
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
    expect(items[`${ORG}::wi-parent`].status).toBe("not_started");
  });

  it("skips ancestors already in_progress", () => {
    seedStore();
    useAppStore.setState({
      workItems: {
        ...useAppStore.getState().workItems,
        [`${ORG}::wi-parent`]: {
          id: `${ORG}::wi-parent`, title: "Parent", status: "in_progress" as const,
          parentId: null, childrenIds: [`${ORG}::wi-1`],
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, rank: 0,
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
          rank: 0,
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
          rank: 1,
        },
      },
    });
    useAppStore.getState().respawnItem(`${ORG}::wi-1`);
    const sibling = useAppStore.getState().workItems[`${ORG}::wi-sibling`];
    expect(sibling.rank).toBe(2); // shifted from 1 to 2
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
          backlogAssignments: { [`${ORG}::bt-1`]: `${ORG}::bl-1` }, rank: 0,
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
          backlogAssignments: { "bt-1": "bl-nonexistent" }, rank: 0,
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
        "wi-1": { id: "wi-1", title: "Parent", status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { "bt-1": "bl-1" }, rank: 0 },
        "wi-2": { id: "wi-2", title: "Child", status: "not_started", parentId: "wi-1", childrenIds: [], backlogAssignments: { "bt-1": "bl-1" }, rank: 0 },
      },
      backlogs: { "bl-1": { id: "bl-1", name: "BL", parentId: null, childrenIds: [], treeId: "bt-1", rank: 0 } },
      backlogTrees: { "bt-1": { id: "bt-1", name: "Tree", rootBacklogIds: ["bl-1"], rank: 0 } },
    }, ORG);
    expect(result.workItems[`${ORG}::wi-1`].childrenIds).toContain(`${ORG}::wi-2`);
  });
});
