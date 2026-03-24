// Auto-exported mock data

import { WorkItem, Backlog, BacklogTree } from "@/types/models";

export function generateMockData() {
  const workItems: Record<string, WorkItem> = {
    "wi-72e8a0ba": {
      id: "wi-72e8a0ba",

      title: "itemi",

      parentId: null,

      childrenIds: [],

      backlogAssignments: {
        "tree-product": "bl-entertainment",
      },

      rank: 0,
    },
  };

  const backlogs: Record<string, Backlog> = {
    "bl-b2c": {
      id: "bl-b2c",

      name: "B2C",

      parentId: null,

      childrenIds: ["bl-entertainment"],

      treeId: "tree-product",

      rank: 0,
    },

    "bl-entertainment": {
      id: "bl-entertainment",

      name: "Entertainment",

      parentId: "bl-b2c",

      childrenIds: [],

      treeId: "tree-product",

      rank: 0,
    },
  };

  const backlogTrees: Record<string, BacklogTree> = {
    "tree-product": {
      id: "tree-product",

      name: "VALUE STREAMS",

      rootBacklogIds: ["bl-b2c"],

      rank: 0,
    },

    "tree-team": {
      id: "tree-team",

      name: "TEAMS",

      rootBacklogIds: [],

      rank: 1,
    },
  };

  return { workItems, backlogs, backlogTrees };
}
