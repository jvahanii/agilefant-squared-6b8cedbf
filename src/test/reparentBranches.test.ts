/**
 * Every way reparentWorkItem can go, pinned as it behaves: what each item's
 * parent, lists and ranks become, and what is sent to be saved.
 *
 * Written before the function was taken apart into helpers (nextRankAmongSiblings,
 * moveDescendantsToList, spreadMergedSiblingRanks), so that taking it apart
 * changes nothing: the snapshots are of the function as it was.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertWorkItems = vi.fn();
vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: (...args: unknown[]) => upsertWorkItems(...args),
}));

import { useAppStore } from "@/store/appStore";
import type { WorkItem } from "@/types/models";

const ORG = "org";
const T1 = `${ORG}::bt-1`;
const T2 = `${ORG}::bt-2`;
const A = `${ORG}::bl-a`;
const B = `${ORG}::bl-b`;
const C = `${ORG}::bl-c`;

const item = (id: string, over: Partial<WorkItem>): WorkItem =>
  ({ id, title: id, status: "not_started", parentId: null, childrenIds: [], backlogAssignments: {}, ranks: {}, ...over }) as WorkItem;

/**
 * Tree 1, list A:  p (0) › kid1 (0), kid2 (1) › grand (0) ;  q (1)
 * Tree 1, list B:  r (0) › r1 (0), r2 (3)
 * Tree 2, list C:  p as well (multi-tree), and s (0)
 */
function seed() {
  const items: WorkItem[] = [
    item("p", { backlogAssignments: { [T1]: A, [T2]: C }, ranks: { [A]: 0, [C]: 5 }, childrenIds: ["kid1", "kid2"] }),
    item("kid1", { parentId: "p", backlogAssignments: { [T1]: A }, ranks: { [A]: 0 } }),
    item("kid2", { parentId: "p", backlogAssignments: { [T1]: A }, ranks: { [A]: 1 }, childrenIds: ["grand"] }),
    item("grand", { parentId: "kid2", backlogAssignments: { [T1]: A }, ranks: { [A]: 0 } }),
    item("q", { backlogAssignments: { [T1]: A }, ranks: { [A]: 1 } }),
    item("r", { backlogAssignments: { [T1]: B }, ranks: { [B]: 0 }, childrenIds: ["r1", "r2"] }),
    item("r1", { parentId: "r", backlogAssignments: { [T1]: B }, ranks: { [B]: 0 } }),
    item("r2", { parentId: "r", backlogAssignments: { [T1]: B }, ranks: { [B]: 3 } }),
    item("s", { backlogAssignments: { [T2]: C }, ranks: { [C]: 0 } }),
    // A single-tree item with children, to move between lists.
    item("solo", { backlogAssignments: { [T1]: A }, ranks: { [A]: 2 }, childrenIds: ["solo1", "solo2"] }),
    item("solo1", { parentId: "solo", backlogAssignments: { [T1]: A }, ranks: { [A]: 4 } }),
    item("solo2", { parentId: "solo", backlogAssignments: { [T1]: A }, ranks: { [A]: 4 } }),
  ];
  useAppStore.setState({
    organizationId: ORG,
    workItems: Object.fromEntries(items.map((i) => [i.id, i])),
    backlogTrees: {
      [T1]: { id: T1, name: "One", rootBacklogIds: [A, B], rank: 0 },
      [T2]: { id: T2, name: "Two", rootBacklogIds: [C], rank: 1 },
    },
    backlogs: {
      [A]: { id: A, name: "A", parentId: null, childrenIds: [], treeId: T1, rank: 0 },
      [B]: { id: B, name: "B", parentId: null, childrenIds: [], treeId: T1, rank: 1 },
      [C]: { id: C, name: "C", parentId: null, childrenIds: [], treeId: T2, rank: 0 },
    },
    undoStack: [],
    redoStack: [],
  } as never);
}

/** What the store holds afterwards, item by item, and what was sent to be saved. */
function outcome() {
  const items = useAppStore.getState().workItems;
  const shape = Object.fromEntries(
    Object.values(items)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((w) => [
        w.id,
        {
          parentId: w.parentId,
          parentIds: w.parentIds ?? null,
          lists: w.backlogAssignments,
          ranks: w.ranks,
          children: [...w.childrenIds].sort(),
        },
      ]),
  );
  const saved = upsertWorkItems.mock.calls.flatMap(([many]) => (many as WorkItem[]).map((w) => w.id)).sort();
  return { items: shape, saved };
}

beforeEach(() => {
  upsertWorkItems.mockReset();
  seed();
});

describe("reparentWorkItem, branch by branch", () => {
  it("within one tree and one list, for a single-tree item", () => {
    useAppStore.getState().reparentWorkItem("q", "p", T1, A);
    expect(outcome()).toMatchSnapshot();
  });

  it("within one tree and one list, at a given rank", () => {
    useAppStore.getState().reparentWorkItem("q", "p", T1, A, undefined, 1);
    expect(outcome()).toMatchSnapshot();
  });

  it("within one tree into another list, taking the descendants along", () => {
    useAppStore.getState().reparentWorkItem("solo", "r", T1, B);
    expect(outcome()).toMatchSnapshot();
  });

  it("within one tree and one list, for a multi-tree item", () => {
    useAppStore.getState().reparentWorkItem("p", "q", T1, A);
    expect(outcome()).toMatchSnapshot();
  });

  it("within one tree into another list, for a multi-tree item", () => {
    useAppStore.getState().reparentWorkItem("p", "r", T1, B);
    expect(outcome()).toMatchSnapshot();
  });

  it("to the top of a tree", () => {
    useAppStore.getState().reparentWorkItem("kid2", null, T1, A);
    expect(outcome()).toMatchSnapshot();
  });

  it("moved to another tree, descendants and all", () => {
    useAppStore.getState().reparentWorkItem("solo", "s", T2, C, "move-to-tree");
    expect(outcome()).toMatchSnapshot();
  });

  it("mirrored into another tree", () => {
    useAppStore.getState().reparentWorkItem("q", "s", T2, C, "mirror");
    expect(outcome()).toMatchSnapshot();
  });
});
