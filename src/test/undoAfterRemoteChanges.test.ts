/**
 * Undo takes back what was done on this page, and nothing that arrived from
 * elsewhere meanwhile.
 *
 * Undo goes back to a copy of the data taken before the edit. Changes made
 * elsewhere after the copy was taken — another person, another tab — are not
 * in it, so going back to it took them back too, and saved that: an item added
 * in another tab pushed the items below it down a place, and an undo here put
 * them back on top of it; a list added under another one dropped out of the
 * tree on this page until the next load. Now each change that arrives is
 * carried into the copies too, and undo leaves it alone. Where the same item
 * was changed both here and elsewhere, undo takes back only the fields changed
 * here — and not even those where someone else has since changed them again.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore, resetRankEchoSuppression } from "@/store/appStore";
import * as sync from "@/store/supabaseSync";
import type { Backlog, BacklogTree, WorkItem } from "@/types/models";

vi.mock("@/store/supabaseSync", () => ({
  loadFromSupabase: vi.fn().mockResolvedValue({ workItems: {}, backlogs: {}, backlogTrees: {} }),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn().mockResolvedValue(true),
  upsertWorkItemBacklogRankRows: vi.fn().mockResolvedValue(true),
  upsertWorkItemBacklogRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
  upsertWorkItemBoardRankRows: vi.fn().mockResolvedValue(true),
  upsertWorkItemBoardRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
  deleteWorkItemBoardRanks: vi.fn().mockResolvedValue(undefined),
  deleteWorkItems: vi.fn().mockResolvedValue(undefined),
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
  updateBacklogRatingsEnabled: vi.fn(),
  updateBacklogCreatedDatesEnabled: vi.fn(),
  updateBacklogStartEndDatesEnabled: vi.fn(),
  updateBacklogPoints: vi.fn(),
  updateBacklogViewMode: vi.fn(),
}));

const ORG = "undo-remote-org";
const id = (x: string) => `${ORG}::${x}`;
const T = id("t1");
const B = id("b1");

function item(x: string, rank: number, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id: id(x), title: x, status: "not_started", parentId: null, childrenIds: [],
    backlogAssignments: { [T]: B }, ranks: { [B]: rank }, boardRanks: {}, organizationId: ORG, ...over,
  } as WorkItem;
}

/** A row as the database sends it for an item of list b1. */
function row(x: string, over: Record<string, unknown> = {}) {
  const wi = useAppStore.getState().workItems[id(x)];
  return {
    id: id(x), title: wi?.title ?? x, status: wi?.status ?? "not_started", parent_id: null,
    backlog_assignments: { [T]: B }, organization_id: ORG, ...over,
  };
}

const s = () => useAppStore.getState();
const order = () =>
  Object.values(s().workItems)
    .filter((w) => w.backlogAssignments[T] === B && !w.parentId)
    .sort((a, b) => a.ranks[B] - b.ranks[B])
    .map((w) => `${w.title}@${w.ranks[B]}`);
const saved = () => vi.mocked(sync.upsertWorkItems).mock.calls.flatMap(([items]) => items.map((w) => w.title));

beforeEach(() => {
  resetRankEchoSuppression();
  localStorage.clear();
  useAppStore.setState({
    organizationId: ORG, userId: null, userEmail: null,
    backlogs: { [B]: { id: B, name: "B1", parentId: null, childrenIds: [], treeId: T, rank: 0 } as Backlog },
    backlogTrees: { [T]: { id: T, name: "T1", rank: 0, rootBacklogIds: [B] } as BacklogTree },
    workItems: { [id("a")]: item("a", 0), [id("b")]: item("b", 1), [id("c")]: item("c", 2) },
    hyperlinks: {},
    selectedTreeId: T, selectedBacklogIds: [B], selectedWorkItemIds: [],
    expandedWorkItems: new Set(), expandedBacklogs: new Set(),
    undoStack: [], redoStack: [], changeLog: [], isLoading: false,
  } as never);
});

/** The calls the undo makes, without those of the edit before it. */
function undoNow() {
  vi.clearAllMocks();
  s().undo();
}

describe("an undo after changes from elsewhere", () => {
  it("leaves an item added elsewhere where it was put, and the items it pushed down", () => {
    s().setWorkItemStatus(id("a"), "in_progress");
    // Another tab adds n below a: b and c move down a place to make room.
    s().applyRealtimeWorkItem("INSERT", row("n", { title: "n" }));
    s().applyRealtimeWorkItemRank("INSERT", { work_item_id: id("n"), backlog_id: B, rank: 1 });
    s().applyRealtimeWorkItemRank("UPDATE", { work_item_id: id("b"), backlog_id: B, rank: 2 });
    s().applyRealtimeWorkItemRank("UPDATE", { work_item_id: id("c"), backlog_id: B, rank: 3 });
    expect(order()).toEqual(["a@0", "n@1", "b@2", "c@3"]);

    undoNow();

    expect(s().workItems[id("a")].status).toBe("not_started");
    expect(order()).toEqual(["a@0", "n@1", "b@2", "c@3"]);
    // Only what was undone is saved: b and c keep the places given them elsewhere.
    expect(saved()).toEqual(["a"]);
    expect(sync.deleteWorkItems).not.toHaveBeenCalledWith(expect.arrayContaining([id("n")]));
  });

  it("keeps a list added elsewhere in the tree", () => {
    s().renameWorkItem(id("a"), "a here");
    const L = id("bl-new");
    s().applyRealtimeBacklog("INSERT", { id: L, name: "Added elsewhere", parent_id: B, tree_id: T, rank: 0 });
    expect(s().backlogs[B].childrenIds).toEqual([L]);

    undoNow();

    expect(s().workItems[id("a")].title).toBe("a");
    expect(s().backlogs[L]?.name).toBe("Added elsewhere");
    expect(s().backlogs[B].childrenIds).toEqual([L]);
    expect(sync.deleteBacklogs).not.toHaveBeenCalledWith(expect.arrayContaining([L]));
  });

  it("keeps a tree's list added elsewhere at its root", () => {
    s().renameWorkItem(id("a"), "a here");
    const L = id("bl-root");
    s().applyRealtimeBacklog("INSERT", { id: L, name: "Root elsewhere", parent_id: null, tree_id: T, rank: 1 });
    undoNow();
    expect(s().backlogTrees[T].rootBacklogIds).toEqual([B, L]);
  });

  it("keeps the name given elsewhere to another item", () => {
    s().setWorkItemStatus(id("a"), "done");
    s().applyRealtimeWorkItem("UPDATE", row("b", { title: "b renamed elsewhere" }));
    undoNow();
    expect(s().workItems[id("a")].status).toBe("not_started");
    expect(s().workItems[id("b")].title).toBe("b renamed elsewhere");
    expect(saved()).toEqual(["a"]);
  });

  it("takes back only what was changed here, where the same item was changed elsewhere too", () => {
    s().setWorkItemStatus(id("a"), "in_progress");
    // The row carries the status saved from here, and a new name given elsewhere.
    s().applyRealtimeWorkItem("UPDATE", row("a", { title: "a renamed elsewhere", status: "in_progress" }));
    undoNow();
    expect(s().workItems[id("a")]).toMatchObject({ status: "not_started", title: "a renamed elsewhere" });
    expect(vi.mocked(sync.upsertWorkItems).mock.calls.flatMap(([items]) => items)).toEqual([
      expect.objectContaining({ id: id("a"), status: "not_started", title: "a renamed elsewhere" }),
    ]);
  });

  it("leaves a field changed here and then elsewhere as it was set elsewhere", () => {
    s().setWorkItemStatus(id("a"), "in_progress");
    s().applyRealtimeWorkItem("UPDATE", row("a", { title: "a renamed elsewhere", status: "blocked" }));
    undoNow();
    expect(s().workItems[id("a")]).toMatchObject({ status: "blocked", title: "a renamed elsewhere" });
    // What is saved is what this page did besides — the status change also
    // gave the item a place on the board — and not the status or the name.
    for (const [items] of vi.mocked(sync.upsertWorkItems).mock.calls) {
      for (const w of items) expect(w).toMatchObject({ status: "blocked", title: "a renamed elsewhere" });
    }
  });

  it("does not bring back an item deleted elsewhere", () => {
    s().setWorkItemStatus(id("a"), "done");
    s().applyRealtimeWorkItem("DELETE", { id: id("c") });
    undoNow();
    expect(s().workItems[id("c")]).toBeUndefined();
    expect(sync.restoreWorkItems).not.toHaveBeenCalled();
  });

  it("does not bring back an item deleted elsewhere that was changed here", () => {
    s().setWorkItemStatus(id("c"), "done");
    s().applyRealtimeWorkItem("DELETE", { id: id("c") });
    undoNow();
    expect(s().workItems[id("c")]).toBeUndefined();
    expect(sync.restoreWorkItems).not.toHaveBeenCalled();
  });

  it("still takes back an item made here, and brings back one deleted here", () => {
    s().addWorkItem("made here", null, B, T);
    const made = Object.values(s().workItems).find((w) => w.title === "made here")!;
    s().applyRealtimeWorkItem("UPDATE", row("b", { title: "b renamed elsewhere" }));
    undoNow();
    expect(s().workItems[made.id]).toBeUndefined();
    expect(s().workItems[id("b")].title).toBe("b renamed elsewhere");

    s().deleteWorkItem(id("c"));
    s().applyRealtimeWorkItem("UPDATE", row("a", { title: "a renamed elsewhere" }));
    undoNow();
    expect(s().workItems[id("c")]?.title).toBe("c");
    expect(s().workItems[id("a")].title).toBe("a renamed elsewhere");
  });

  it("goes back further than one edit the same way", () => {
    s().setWorkItemStatus(id("a"), "in_progress");
    s().setWorkItemStatus(id("b"), "in_progress");
    s().applyRealtimeWorkItem("UPDATE", row("c", { title: "c renamed elsewhere" }));
    undoNow();
    undoNow();
    expect(s().workItems[id("a")].status).toBe("not_started");
    expect(s().workItems[id("b")].status).toBe("not_started");
    expect(s().workItems[id("c")].title).toBe("c renamed elsewhere");
    expect(saved()).toEqual(["a"]);
  });

  it("keeps changes from elsewhere through a redo", () => {
    s().setWorkItemStatus(id("a"), "in_progress");
    undoNow();
    s().applyRealtimeWorkItem("UPDATE", row("b", { title: "b renamed elsewhere" }));
    vi.clearAllMocks();
    s().redo();
    expect(s().workItems[id("a")].status).toBe("in_progress");
    expect(s().workItems[id("b")].title).toBe("b renamed elsewhere");
    expect(saved()).toEqual(["a"]);
  });

  it("keeps a link added elsewhere", () => {
    s().setWorkItemStatus(id("a"), "done");
    s().applyRealtimeHyperlink("INSERT", { id: "h1", work_item_id: id("b"), url: "https://x.example", alt_text: "X", rank: 0 });
    undoNow();
    expect(s().hyperlinks[id("b")]?.map((l) => l.id)).toEqual(["h1"]);
    expect(sync.deleteHyperlink).not.toHaveBeenCalled();
  });
});
