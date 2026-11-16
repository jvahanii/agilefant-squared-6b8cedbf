import type { MockDataSnapshot } from "./sync/writes";

/**
 * What a new organisation starts with: one tree and two lists, and no items,
 * so the first thing on screen is the prompt to add an item of one's own.
 *
 * Until 2026-11-16 a new organisation got the tutorial set in mockData.ts
 * (2 trees, 9 lists named "It", "Can", "Contain"… and 4 tip items). Of the 34
 * people who signed up from August to mid-November, 15 never changed anything,
 * and 14 of the 15 who did began by renaming or deleting those lists rather
 * than adding work. mockData.ts stays as the test fixture and the reset data.
 */
export const starterContent: MockDataSnapshot = {
  workItems: {},
  backlogs: {
    "bl-5a7e0001": {
      id: "bl-5a7e0001",
      name: "Now",
      parentId: null,
      childrenIds: [],
      treeId: "bt-5a7e0000",
      rank: 0,
    },
    "bl-5a7e0002": {
      id: "bl-5a7e0002",
      name: "Later",
      parentId: null,
      childrenIds: [],
      treeId: "bt-5a7e0000",
      rank: 1,
    },
  },
  backlogTrees: {
    "bt-5a7e0000": {
      id: "bt-5a7e0000",
      name: "My work",
      rank: 0,
      rootBacklogIds: ["bl-5a7e0001", "bl-5a7e0002"],
    },
  },
};
