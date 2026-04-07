import { describe, it, expect } from "vitest";
import { checkDataIntegrity, cleanseData } from "@/store/dataIntegrity";
import type { WorkItem, Backlog, BacklogTree } from "@/types/models";

const ORG = "org-1";
const p = (id: string) => `${ORG}::${id}`;

function makeWi(overrides: Partial<WorkItem> & { id: string; title: string }): WorkItem {
  return {
    status: "not_started", parentId: null, childrenIds: [],
    backlogAssignments: { [p("bt-1")]: p("bl-1") }, rank: 0,
    ...overrides,
  };
}

function makeBl(overrides: Partial<Backlog> & { id: string; name: string }): Backlog {
  return { parentId: null, childrenIds: [], treeId: p("bt-1"), rank: 0, ...overrides };
}

function baseData() {
  return {
    workItems: {
      [p("wi-1")]: makeWi({ id: p("wi-1"), title: "Item 1" }),
    } as Record<string, WorkItem>,
    backlogs: {
      [p("bl-1")]: makeBl({ id: p("bl-1"), name: "Backlog 1" }),
    } as Record<string, Backlog>,
    backlogTrees: {
      [p("bt-1")]: { id: p("bt-1"), name: "Tree 1", rootBacklogIds: [p("bl-1")], rank: 0 },
    } as Record<string, BacklogTree>,
  };
}

// ─── CHECK: Ghost Parent ───────────────────────────────────────────────

describe("Ghost Parent", () => {
  it("detects work item with missing parent", () => {
    const data = baseData();
    data.workItems[p("wi-1")].parentId = p("wi-nonexistent");
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Ghost Parent" && i.id === p("wi-1"))).toBe(true);
  });

  it("detects backlog with missing parent", () => {
    const data = baseData();
    data.backlogs[p("bl-1")].parentId = p("bl-missing");
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Ghost Parent" && i.id === p("bl-1"))).toBe(true);
  });

  it("cleanse fixes ghost parent on work item", () => {
    const data = baseData();
    data.workItems[p("wi-1")].parentId = p("wi-gone");
    const result = cleanseData(data);
    expect(result.data.workItems[p("wi-1")].parentId).toBeNull();
  });
});

// ─── CHECK: Orphaned Children ──────────────────────────────────────────

describe("Orphaned Children", () => {
  it("detects child not in parent childrenIds", () => {
    const data = baseData();
    data.workItems[p("wi-2")] = makeWi({ id: p("wi-2"), title: "Child", parentId: p("wi-1") });
    // Parent does NOT list wi-2 in childrenIds
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Orphaned Children" && i.id === p("wi-2"))).toBe(true);
  });

  it("cleanse adds missing child to parent childrenIds", () => {
    const data = baseData();
    data.workItems[p("wi-2")] = makeWi({ id: p("wi-2"), title: "Child", parentId: p("wi-1") });
    const result = cleanseData(data);
    expect(result.data.workItems[p("wi-1")].childrenIds).toContain(p("wi-2"));
  });
});

// ─── CHECK: Circular Reference ─────────────────────────────────────────

describe("Circular Reference", () => {
  it("detects circular parent chain", () => {
    const data = baseData();
    data.workItems[p("wi-2")] = makeWi({ id: p("wi-2"), title: "Item 2", parentId: p("wi-1") });
    data.workItems[p("wi-1")].parentId = p("wi-2");
    data.workItems[p("wi-1")].childrenIds = [p("wi-2")];
    data.workItems[p("wi-2")].childrenIds = [p("wi-1")];
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Circular Reference")).toBe(true);
  });

  it("cleanse breaks circular reference", () => {
    const data = baseData();
    data.workItems[p("wi-2")] = makeWi({ id: p("wi-2"), title: "Item 2", parentId: p("wi-1") });
    data.workItems[p("wi-1")].parentId = p("wi-2");
    const result = cleanseData(data);
    // At least one item should have null parentId to break cycle
    const items = Object.values(result.data.workItems);
    const hasRoot = items.some((wi) => wi.parentId === null);
    expect(hasRoot).toBe(true);
  });
});

// ─── CHECK: Backlog Displacement ───────────────────────────────────────

describe("Backlog Displacement", () => {
  it("detects assignment to missing backlog", () => {
    const data = baseData();
    data.workItems[p("wi-1")].backlogAssignments = { [p("bt-1")]: p("bl-missing") };
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Backlog Displacement")).toBe(true);
  });

  it("detects assignment to missing tree", () => {
    const data = baseData();
    data.workItems[p("wi-1")].backlogAssignments = { [p("bt-missing")]: p("bl-1") };
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Backlog Displacement")).toBe(true);
  });

  it("detects fully orphaned work item (no assignments)", () => {
    const data = baseData();
    data.workItems[p("wi-1")].backlogAssignments = {};
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Backlog Displacement" && i.detail.includes("fully orphaned"))).toBe(true);
  });

  it("cleanse removes work item with no valid assignments", () => {
    const data = baseData();
    data.workItems[p("wi-1")].backlogAssignments = { [p("bt-missing")]: p("bl-missing") };
    const result = cleanseData(data);
    expect(result.data.workItems[p("wi-1")]).toBeUndefined();
  });
});

// ─── CHECK: Tree-Backlog Desync ────────────────────────────────────────

describe("Tree-Backlog Desync", () => {
  it("detects root backlog missing from tree rootBacklogIds", () => {
    const data = baseData();
    data.backlogTrees[p("bt-1")].rootBacklogIds = [];
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Tree-Backlog Desync")).toBe(true);
  });

  it("cleanse adds missing root backlog to tree", () => {
    const data = baseData();
    data.backlogTrees[p("bt-1")].rootBacklogIds = [];
    const result = cleanseData(data);
    expect(result.data.backlogTrees[p("bt-1")].rootBacklogIds).toContain(p("bl-1"));
  });

  it("detects stale rootBacklogId", () => {
    const data = baseData();
    data.backlogTrees[p("bt-1")].rootBacklogIds.push(p("bl-nonexistent"));
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Tree-Backlog Desync" && i.type === "backlog_tree")).toBe(true);
  });
});

// ─── CHECK: Duplicate Rank ─────────────────────────────────────────────

describe("Duplicate Rank", () => {
  it("detects duplicate ranks among siblings", () => {
    const data = baseData();
    data.workItems[p("wi-2")] = makeWi({ id: p("wi-2"), title: "Item 2", rank: 0 });
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Duplicate Rank")).toBe(true);
  });

  it("cleanse re-ranks siblings", () => {
    const data = baseData();
    data.workItems[p("wi-2")] = makeWi({ id: p("wi-2"), title: "Item 2", rank: 0 });
    const result = cleanseData(data);
    const ranks = Object.values(result.data.workItems).map((wi) => wi.rank);
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});

// ─── CHECK: Cross-Org Pollution ────────────────────────────────────────

describe("Cross-Org Pollution", () => {
  it("detects cross-org backlog assignment when backlog is missing from store", () => {
    const data = baseData();
    // Tree from another org exists in store, but the assigned backlog does NOT –
    // this is a genuinely dangling / polluted assignment.
    data.workItems[p("wi-1")].backlogAssignments = { ["other-org::bt-1"]: "other-org::bl-nonexistent" };
    data.backlogTrees["other-org::bt-1"] = { id: "other-org::bt-1", name: "Other Tree", rootBacklogIds: [], rank: 0 };
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Cross-Org Pollution")).toBe(true);
  });

  it("cleanse removes cross-org assignments where backlog is dangling", () => {
    const data = baseData();
    // Valid assignment + dangling cross-org assignment (tree exists, backlog does NOT)
    data.workItems[p("wi-1")].backlogAssignments = {
      [p("bt-1")]: p("bl-1"),
      ["other-org::bt-x"]: "other-org::bl-nonexistent",
    };
    data.backlogTrees["other-org::bt-x"] = { id: "other-org::bt-x", name: "X", rootBacklogIds: [], rank: 0 };
    const result = cleanseData(data);
    const wi = result.data.workItems[p("wi-1")];
    expect(wi).toBeDefined();
    expect(wi.backlogAssignments["other-org::bt-x"]).toBeUndefined();
  });

  it("does NOT flag partner-org items contributed to a shared tree (outgoing share)", () => {
    // Scenario: active org owns bt-1/bl-1, partner org created an item assigned there.
    // This is a legitimate outgoing-share contribution and must NOT be flagged.
    const data = baseData();
    const PARTNER = "partner-org";
    data.workItems[`${PARTNER}::wi-shared`] = {
      id: `${PARTNER}::wi-shared`, title: "Shared item", status: "not_started" as const,
      parentId: null, childrenIds: [],
      backlogAssignments: { [p("bt-1")]: p("bl-1") },
      rank: 5,
    };
    const issues = checkDataIntegrity(data);
    expect(
      issues.filter((i) => i.id === `${PARTNER}::wi-shared` && i.category === "Cross-Org Pollution")
    ).toHaveLength(0);
  });

  it("cleanse preserves partner-org items in shared trees (outgoing share)", () => {
    const data = baseData();
    const PARTNER = "partner-org";
    data.workItems[`${PARTNER}::wi-shared`] = {
      id: `${PARTNER}::wi-shared`, title: "Shared", status: "not_started" as const,
      parentId: null, childrenIds: [],
      backlogAssignments: { [p("bt-1")]: p("bl-1") },
      rank: 5,
    };
    const result = cleanseData(data);
    expect(result.data.workItems[`${PARTNER}::wi-shared`]).toBeDefined();
    expect(result.data.workItems[`${PARTNER}::wi-shared`].backlogAssignments[p("bt-1")]).toBe(p("bl-1"));
  });
});

// ─── CHECK: Zombie Assignment ──────────────────────────────────────────

describe("Zombie Assignment", () => {
  it("detects backlog assigned via wrong tree", () => {
    const data = baseData();
    data.backlogTrees[p("bt-2")] = { id: p("bt-2"), name: "Tree 2", rootBacklogIds: [], rank: 1 };
    // wi-1 assigned to bt-2 -> bl-1, but bl-1 belongs to bt-1
    data.workItems[p("wi-1")].backlogAssignments[p("bt-2")] = p("bl-1");
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Zombie Assignment")).toBe(true);
  });

  it("cleanse removes zombie assignments", () => {
    const data = baseData();
    data.backlogTrees[p("bt-2")] = { id: p("bt-2"), name: "Tree 2", rootBacklogIds: [], rank: 1 };
    data.workItems[p("wi-1")].backlogAssignments[p("bt-2")] = p("bl-1");
    const result = cleanseData(data);
    expect(result.data.workItems[p("wi-1")].backlogAssignments[p("bt-2")]).toBeUndefined();
    expect(result.data.workItems[p("wi-1")].backlogAssignments[p("bt-1")]).toBe(p("bl-1"));
  });
});

// ─── CHECK: Malformed IDs ──────────────────────────────────────────────

describe("Malformed IDs", () => {
  it("detects IDs with multiple :: separators", () => {
    const data = baseData();
    const badId = `${ORG}::${ORG}::wi-bad`;
    data.workItems[badId] = makeWi({ id: badId, title: "Bad", backlogAssignments: { [p("bt-1")]: p("bl-1") } });
    const issues = checkDataIntegrity(data);
    expect(issues.some((i) => i.category === "Malformed ID")).toBe(true);
  });

  it("cleanse removes malformed IDs", () => {
    const data = baseData();
    const badId = `${ORG}::${ORG}::wi-bad`;
    data.workItems[badId] = makeWi({ id: badId, title: "Bad" });
    const result = cleanseData(data);
    expect(result.data.workItems[badId]).toBeUndefined();
  });
});

// ─── Clean data stays clean ────────────────────────────────────────────

describe("Clean data", () => {
  it("reports no issues for valid data", () => {
    const data = baseData();
    data.backlogTrees[p("bt-1")].rootBacklogIds = [p("bl-1")];
    const issues = checkDataIntegrity(data);
    expect(issues).toHaveLength(0);
  });

  it("cleanse makes no changes to valid data", () => {
    const data = baseData();
    const result = cleanseData(data);
    expect(result.removed).toHaveLength(0);
    expect(result.fixed).toHaveLength(0);
  });
});
