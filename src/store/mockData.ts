import { WorkItem, Backlog, BacklogTree } from "@/types/models";

export function generateMockData() {
  const backlogTrees: Record<string, BacklogTree> = {};
  const backlogs: Record<string, Backlog> = {};
  const workItems: Record<string, WorkItem> = {};

  // --- 1. TREE DEFINITIONS ---
  backlogTrees["tree-product"] = {
    id: "tree-product",
    name: "VALUE STREAMS",
    rootBacklogIds: ["bl-b2c"],
    rank: 0,
  };

  backlogTrees["tree-team"] = {
    id: "tree-team",
    name: "TEAMS",
    rootBacklogIds: ["bl-team"],
    rank: 1,
  };

  // --- 2. BACKLOG HIERARCHY ---

  // Root
  backlogs["bl-b2c"] = {
    id: "bl-b2c",
    name: "B2C",
    parentId: null,
    childrenIds: ["bl-entertainment"],
    treeId: "tree-product",
    rank: 0,
  };

  // Middle Layer
  backlogs["bl-entertainment"] = {
    id: "bl-entertainment",
    name: "Entertainment",
    parentId: "bl-b2c",
    childrenIds: ["bl-product"],
    treeId: "tree-product",
    rank: 0,
  };

  // Service Layer
  backlogs["bl-product"] = {
    id: "bl-product",
    name: "Streaming service",
    parentId: "bl-entertainment",
    childrenIds: ["bl-release-1", "bl-release-2"],
    treeId: "tree-product",
    rank: 0,
  };

  // Release Layer (MVP & Desired)
  backlogs["bl-release-1"] = {
    id: "bl-release-1",
    name: "MVP",
    parentId: "bl-product",
    childrenIds: [], // Sprints removed as requested
    treeId: "tree-product",
    rank: 0,
  };

  backlogs["bl-release-2"] = {
    id: "bl-release-2",
    name: "Desired for launch",
    parentId: "bl-product",
    childrenIds: [],
    treeId: "tree-product",
    rank: 1,
  };

  // Team Backlog
  backlogs["bl-team"] = {
    id: "bl-team",
    name: "Q1",
    parentId: null,
    childrenIds: [],
    treeId: "tree-team",
    rank: 0,
  };

  // --- 3. WORK ITEMS (M1 to M20) ---
  const mItemTitles = [
    "M1: Basic pkg order (A)",
    "M2: Multi‑subs allowed",
    "M3: Show base price (A)",
    "M4: Activation msg",
    "M5: Order conf (A)",
    "M6: Basic pkg order (C)",
    "M7: Activation info (C)",
    "M8: Guide to config",
    "M9: View base product (A)",
    "M10: View selections (A)",
    "M11: View locks (A)",
    "M12: View base product (C)",
    "M13: View selections (C)",
    "M14: View locks (C)",
    "M15: Service links",
    "M16: Activation state (C)",
    "M17: Change services (C)",
    "M18: Cancel base (C)",
    "M19: Basic reporting",
    "M20: Validation core (part1)",
  ];

  mItemTitles.forEach((title, index) => {
    const id = `wi-m${index + 1}`;
    workItems[id] = {
      id,
      title,
      points: 5,
      parentId: null,
      childrenIds: [],
      rank: index,
      backlogAssignments: {
        "tree-product": "bl-release-1", // All assigned to MVP
        "tree-team": "bl-team",
      },
    };
  });

  return { backlogTrees, backlogs, workItems };
}
