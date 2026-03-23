import { WorkItem, Backlog, BacklogTree } from "@/types/models";

export function generateMockData() {
  const backlogTrees: Record<string, BacklogTree> = {};
  const backlogs: Record<string, Backlog> = {};
  const workItems: Record<string, WorkItem> = {};

  // Tree 1: Product
  backlogTrees["tree-product"] = {
    id: "tree-product",
    name: "VALUE STREAMS\n",
    rootBacklogIds: ["bl-product", "bl-b2c"],
    rank: 0,
  };

  backlogs["bl-b2c"] = {
    id: "bl-b2c",
    name: "B2C\n",
    parentId: null,
    childrenIds: [],
    treeId: "tree-product",
    rank: 1,
  };

  backlogs["bl-product"] = {
    id: "bl-product",
    name: "Streaming service",
    parentId: ["bl-b2c"],
    childrenIds: ["bl-release-1", "bl-release-2"],
    treeId: "tree-product",
    rank: 0,
  };
  backlogs["bl-release-1"] = {
    id: "bl-release-1",
    name: "MVP",
    parentId: "bl-product",
    childrenIds: ["bl-sprint-1", "bl-sprint-2"],
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
  backlogs["bl-sprint-1"] = {
    id: "bl-sprint-1",
    name: "Sprint 1",
    parentId: "bl-release-1",
    childrenIds: [],
    treeId: "tree-product",
    rank: 0,
  };
  backlogs["bl-sprint-2"] = {
    id: "bl-sprint-2",
    name: "Sprint 2",
    parentId: "bl-release-1",
    childrenIds: [],
    treeId: "tree-product",
    rank: 1,
  };

  // Tree 2: Team
  backlogTrees["tree-team"] = {
    id: "tree-team",
    name: "TEAMS",
    rootBacklogIds: ["bl-team"],
    rank: 1,
  };

  backlogs["bl-team"] = {
    id: "bl-team",
    name: "Q1",
    parentId: null,
    childrenIds: ["bl-frontend", "bl-backend"],
    treeId: "tree-team",
    rank: 0,
  };
  backlogs["bl-frontend"] = {
    id: "bl-frontend",
    name: "Hawk sprint 1",
    parentId: "bl-team",
    childrenIds: [],
    treeId: "tree-team",
    rank: 0,
  };
  backlogs["bl-backend"] = {
    id: "bl-backend",
    name: "Falcon sprint 1\n",
    parentId: "bl-team",
    childrenIds: [],
    treeId: "tree-team",
    rank: 1,
  };

  // Work items with points
  const items: Array<Omit<WorkItem, "rank"> & { rank?: number }> = [
    {
      id: "wi-1",
      title: "User authentication flow",
      points: 13,
      parentId: null,
      childrenIds: ["wi-1a", "wi-1b"],
      backlogAssignments: { "tree-product": "bl-sprint-1", "tree-team": "bl-backend" },
    },
    {
      id: "wi-1a",
      title: "Login page UI",
      points: 5,
      parentId: "wi-1",
      childrenIds: [],
      backlogAssignments: { "tree-product": "bl-sprint-1", "tree-team": "bl-frontend" },
    },
    {
      id: "wi-1b",
      title: "JWT token handling",
      points: 8,
      parentId: "wi-1",
      childrenIds: [],
      backlogAssignments: { "tree-product": "bl-sprint-1", "tree-team": "bl-backend" },
    },
    {
      id: "wi-2",
      title: "Dashboard layout",
      points: 8,
      parentId: null,
      childrenIds: ["wi-2a"],
      backlogAssignments: { "tree-product": "bl-sprint-1", "tree-team": "bl-frontend" },
    },
    {
      id: "wi-2a",
      title: "Sidebar navigation",
      points: 3,
      parentId: "wi-2",
      childrenIds: [],
      backlogAssignments: { "tree-product": "bl-sprint-1", "tree-team": "bl-frontend" },
    },
    {
      id: "wi-3",
      title: "API rate limiting",
      points: 5,
      parentId: null,
      childrenIds: [],
      backlogAssignments: { "tree-product": "bl-sprint-2", "tree-team": "bl-backend" },
    },
    {
      id: "wi-4",
      title: "Database migration tool",
      points: 13,
      parentId: null,
      childrenIds: ["wi-4a", "wi-4b"],
      backlogAssignments: { "tree-product": "bl-sprint-2", "tree-team": "bl-backend" },
    },
    {
      id: "wi-4a",
      title: "Schema diff engine",
      points: 8,
      parentId: "wi-4",
      childrenIds: [],
      backlogAssignments: { "tree-product": "bl-sprint-2", "tree-team": "bl-backend" },
    },
    {
      id: "wi-4b",
      title: "Rollback support",
      points: 5,
      parentId: "wi-4",
      childrenIds: [],
      backlogAssignments: { "tree-product": "bl-sprint-2", "tree-team": "bl-backend" },
    },
    {
      id: "wi-5",
      title: "Search functionality",
      points: 8,
      parentId: null,
      childrenIds: [],
      backlogAssignments: { "tree-product": "bl-release-2", "tree-team": "bl-frontend" },
    },
    {
      id: "wi-6",
      title: "Performance monitoring",
      points: 5,
      parentId: null,
      childrenIds: [],
      backlogAssignments: { "tree-product": "bl-release-2", "tree-team": "bl-backend" },
    },
  ];

  items.forEach((item, i) => {
    workItems[item.id] = { ...item, rank: item.rank ?? i } as WorkItem;
  });

  return { backlogTrees, backlogs, workItems };
}
