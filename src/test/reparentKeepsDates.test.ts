/**
 * Reparenting an item must not cost it its dates.
 *
 * Pressing Tab on the timeline to put an item under the one above it left the
 * item without its start and end dates. Pinned here: every way of moving an
 * item to another parent keeps the dates it has — in the store, and in what is
 * sent to be saved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertWorkItem = vi.fn();
const upsertWorkItems = vi.fn();
vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: (...args: unknown[]) => upsertWorkItem(...args),
  upsertWorkItems: (...args: unknown[]) => upsertWorkItems(...args),
}));

import { useAppStore } from "@/store/appStore";
import type { WorkItem } from "@/types/models";

const ORG = "test-org";
const TREE = `${ORG}::bt-1`;
const BL = `${ORG}::bl-1`;
const DATES = { startedOn: "2026-10-01", endedOn: "2026-10-05", deadline: "2026-10-20", createdOn: "2026-09-28" };

const item = (id: string, rank: number, over: Partial<WorkItem> = {}): WorkItem => ({
  id,
  title: id,
  status: "not_started",
  parentId: null,
  childrenIds: [],
  backlogAssignments: { [TREE]: BL },
  ranks: { [BL]: rank },
  ...over,
});

/** Every item handed to a save, by id — whichever of the two calls carried it. */
const saved = (): Record<string, WorkItem> => {
  const out: Record<string, WorkItem> = {};
  for (const [one] of upsertWorkItem.mock.calls) out[(one as WorkItem).id] = one as WorkItem;
  for (const [many] of upsertWorkItems.mock.calls) for (const one of many as WorkItem[]) out[one.id] = one;
  return out;
};

beforeEach(() => {
  upsertWorkItem.mockReset();
  upsertWorkItems.mockReset();
  useAppStore.setState({
    organizationId: ORG,
    selectedTreeId: TREE,
    selectedBacklogIds: [BL],
    backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
    backlogs: { [BL]: { id: BL, name: "Work", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
    workItems: {
      above: item("above", 1),
      dated: item("dated", 2, DATES),
      child: item("child", 1, { parentId: "dated", startedOn: "2026-10-02" }),
    },
    selectedWorkItemIds: [],
    undoStack: [],
    redoStack: [],
  });
  useAppStore.setState((s) => ({ workItems: { ...s.workItems, dated: { ...s.workItems.dated, childrenIds: ["child"] } } }));
});

describe("reparenting", () => {
  it("keeps an item's dates when it is put under another item", () => {
    useAppStore.getState().reparentWorkItem("dated", "above", TREE, BL);
    const now = useAppStore.getState().workItems.dated;
    expect(now.parentId).toBe("above");
    expect(now).toMatchObject(DATES);
    expect(saved().dated).toMatchObject(DATES);
  });

  it("keeps them when it is moved back out", () => {
    useAppStore.getState().reparentWorkItem("dated", "above", TREE, BL);
    useAppStore.getState().reparentWorkItem("dated", null, TREE, BL, undefined, 5);
    expect(useAppStore.getState().workItems.dated).toMatchObject(DATES);
    expect(saved().dated).toMatchObject(DATES);
  });

  it("keeps the dates of what is under it, and of the item it is put under", () => {
    useAppStore.setState((s) => ({ workItems: { ...s.workItems, above: { ...s.workItems.above, endedOn: "2026-10-09" } } }));
    useAppStore.getState().reparentWorkItem("dated", "above", TREE, BL);
    const items = useAppStore.getState().workItems;
    expect(items.child.startedOn).toBe("2026-10-02");
    expect(items.above.endedOn).toBe("2026-10-09");
    for (const one of Object.values(saved())) {
      expect({ id: one.id, startedOn: one.startedOn, endedOn: one.endedOn }).toEqual({
        id: one.id,
        startedOn: items[one.id].startedOn,
        endedOn: items[one.id].endedOn,
      });
    }
  });

  it("keeps them through undo and redo", () => {
    useAppStore.getState().reparentWorkItem("dated", "above", TREE, BL);
    useAppStore.getState().undo();
    expect(useAppStore.getState().workItems.dated).toMatchObject({ ...DATES, parentId: null });
    useAppStore.getState().redo();
    expect(useAppStore.getState().workItems.dated).toMatchObject({ ...DATES, parentId: "above" });
  });
});
