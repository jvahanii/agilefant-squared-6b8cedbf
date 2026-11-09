/**
 * The store's selection and expansion actions, and what it does with each
 * kind of live update — recorded as they behave, step by step, so that moving
 * them out of appStore.ts into slices of their own changes none of it.
 *
 * Each step records what the reader would see: the selection and what is
 * open, and what this browser keeps of the selection; for a live update, the
 * items, lists, trees and links after it, and whether it left them untouched
 * (an echo of what is held already must not redraw anything).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore, resetRankEchoSuppression } from "@/store/appStore";
import { markWorkItemsDeleted, forgetDeletedWorkItems } from "@/store/deletedWorkItems";
import type { Backlog, BacklogTree, Hyperlink, WorkItem } from "@/types/models";

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

const ORG = "slices-org";

function item(id: string, over: Partial<WorkItem> = {}): WorkItem {
  return {
    id, title: id, status: "not_started", parentId: null, childrenIds: [],
    backlogAssignments: { t1: "b1" }, ranks: { b1: 0 }, boardRanks: {}, organizationId: ORG,
    ...over,
  } as WorkItem;
}

/**
 * Two trees. Tree one: b1 with b1a and b1b under it, b1a with b1a1 under it,
 * and b2 beside b1. Tree two: b3. Items w1 > w2 > w3 in b1, w4 > w5 in b1 and
 * b3, w5 put under w1 in tree two, w6 alone in b2.
 */
function world() {
  const backlogs: Record<string, Backlog> = {
    b1: { id: "b1", name: "B1", parentId: null, childrenIds: ["b1a", "b1b"], treeId: "t1", rank: 0 } as Backlog,
    b1a: { id: "b1a", name: "B1a", parentId: "b1", childrenIds: ["b1a1"], treeId: "t1", rank: 0 } as Backlog,
    b1a1: { id: "b1a1", name: "B1a1", parentId: "b1a", childrenIds: [], treeId: "t1", rank: 0 } as Backlog,
    b1b: { id: "b1b", name: "B1b", parentId: "b1", childrenIds: [], treeId: "t1", rank: 1 } as Backlog,
    b2: { id: "b2", name: "B2", parentId: null, childrenIds: [], treeId: "t1", rank: 1 } as Backlog,
    b3: { id: "b3", name: "B3", parentId: null, childrenIds: [], treeId: "t2", rank: 0 } as Backlog,
  };
  const backlogTrees: Record<string, BacklogTree> = {
    t1: { id: "t1", name: "T1", rank: 0, rootBacklogIds: ["b1", "b2"] } as BacklogTree,
    t2: { id: "t2", name: "T2", rank: 1, rootBacklogIds: ["b3"] } as BacklogTree,
  };
  const workItems: Record<string, WorkItem> = {
    w1: item("w1", { childrenIds: ["w2", "w5"], ranks: { b1: 0 } }),
    w2: item("w2", { parentId: "w1", childrenIds: ["w3"], ranks: { b1: 1 } }),
    w3: item("w3", { parentId: "w2", ranks: { b1: 2 } }),
    w4: item("w4", { childrenIds: ["w5"], backlogAssignments: { t1: "b1", t2: "b3" }, ranks: { b1: 3, b3: 0 }, boardRanks: { b1: 5 } }),
    w5: item("w5", { parentId: "w4", parentIds: { t2: "w1" }, backlogAssignments: { t1: "b1", t2: "b3" }, ranks: { b1: 4, b3: 1 } }),
    w6: item("w6", { backlogAssignments: { t1: "b2" }, ranks: { b2: 0 } }),
  };
  const hyperlinks: Record<string, Hyperlink[]> = {
    w1: [
      { id: "h1", workItemId: "w1", url: "https://a.example", altText: "A", rank: 0 },
      { id: "h2", workItemId: "w1", url: "https://b.example", altText: "B", rank: 1 },
    ],
  };
  return { workItems, backlogs, backlogTrees, hyperlinks };
}

function reset(orgId: string | null = ORG) {
  localStorage.clear();
  resetRankEchoSuppression();
  useAppStore.setState({
    ...world(),
    organizationId: orgId, userId: null, userEmail: null,
    selectedTreeId: null, selectedBacklogIds: [], selectedWorkItemIds: [],
    expandedWorkItems: new Set(), expandedBacklogs: new Set(),
    undoStack: [], redoStack: [], changeLog: [], isLoading: false,
  } as never);
}

function kept() {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith("selection_")) out[k] = localStorage.getItem(k);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

function selection() {
  const s = useAppStore.getState();
  return {
    tree: s.selectedTreeId,
    lists: s.selectedBacklogIds,
    items: s.selectedWorkItemIds,
    openItems: [...s.expandedWorkItems],
    openLists: [...s.expandedBacklogs],
    kept: kept(),
  };
}

beforeEach(() => reset());

describe("selection and expansion", () => {
  it("step by step, with an organization", () => {
    const a = () => useAppStore.getState();
    const steps: [string, () => void][] = [
      ["select tree t2", () => a().selectTree("t2")],
      ["select list b1 of t1", () => a().selectBacklog("b1", "t1")],
      ["ctrl-select b2", () => a().selectBacklog("b2", "t1", true)],
      ["ctrl-select b1 again (drops it)", () => a().selectBacklog("b1", "t1", true)],
      ["ctrl-select b3 of the other tree", () => a().selectBacklog("b3", "t2", true)],
      ["select w1", () => a().selectWorkItem("w1")],
      ["ctrl-select w2", () => a().selectWorkItem("w2", true)],
      ["ctrl-select w1 again (drops it)", () => a().selectWorkItem("w1", true)],
      ["select nothing", () => a().selectWorkItem(null)],
      ["select range w1..w3", () => a().selectWorkItemRange(["w1", "w2", "w3"], false)],
      ["add range w3, w4, w4", () => a().selectWorkItemRange(["w3", "w4", "w4"], true)],
      ["select list b1 (clears the items)", () => a().selectBacklog("b1", "t1")],
      ["select range w6", () => a().selectWorkItemRange(["w6"], false)],
      ["clear item selection", () => a().clearWorkItemSelection()],
      ["select tree t1 (clears all)", () => a().selectTree("t1")],
      ["toggle w1 open", () => a().toggleWorkItemExpand("w1")],
      ["toggle w4 open", () => a().toggleWorkItemExpand("w4")],
      ["toggle w1 shut", () => a().toggleWorkItemExpand("w1")],
      ["open all under w1", () => a().expandWorkItemsRecursive("w1")],
      ["open all under w3 (a leaf)", () => a().expandWorkItemsRecursive("w3")],
      ["shut all under w2", () => a().collapseWorkItemsRecursive("w2")],
      ["shut all under w1", () => a().collapseWorkItemsRecursive("w1")],
      ["toggle b1 open", () => a().toggleBacklogExpand("b1")],
      ["toggle b1 shut", () => a().toggleBacklogExpand("b1")],
      ["open all under b1", () => a().expandBacklogsRecursive("b1")],
      ["open all under b2 (a leaf)", () => a().expandBacklogsRecursive("b2")],
      ["shut all under b1a", () => a().collapseBacklogsRecursive("b1a")],
      ["shut all under b1", () => a().collapseBacklogsRecursive("b1")],
      ["open all under an unknown item", () => a().expandWorkItemsRecursive("nope")],
      ["shut all under an unknown list", () => a().collapseBacklogsRecursive("nope")],
    ];
    const record = steps.map(([name, run]) => {
      run();
      return { step: name, ...selection() };
    });
    expect(record).toMatchSnapshot();
  });

  it("step by step, before an organization is known: nothing is kept in the browser", () => {
    reset(null);
    const a = () => useAppStore.getState();
    a().selectTree("t1");
    a().selectBacklog("b1", "t1");
    a().selectWorkItem("w1");
    a().selectWorkItem("w2", true);
    a().selectWorkItemRange(["w3"], true);
    expect(selection()).toMatchSnapshot();
    a().selectWorkItem(null);
    a().clearWorkItemSelection();
    expect(selection()).toMatchSnapshot();
  });
});

type Event = [string, () => void];

function data() {
  const s = useAppStore.getState();
  return { workItems: s.workItems, backlogs: s.backlogs, backlogTrees: s.backlogTrees, hyperlinks: s.hyperlinks };
}

/** What changed in one map: the entries added, changed (as they are after) and removed. */
function changes<T>(before: Record<string, T>, after: Record<string, T>) {
  const out: { added?: Record<string, T>; changed?: Record<string, T>; removed?: string[] } = {};
  for (const [k, v] of Object.entries(after)) {
    if (!(k in before)) (out.added ??= {})[k] = v;
    else if (JSON.stringify(before[k]) !== JSON.stringify(v)) (out.changed ??= {})[k] = v;
  }
  for (const k of Object.keys(before)) if (!(k in after)) (out.removed ??= []).push(k);
  return out;
}

/** Runs each event and records what it changed, and which maps it left as they were. */
async function play(events: Event[]) {
  const out: unknown[] = [];
  for (const [name, run] of events) {
    const before = data();
    run();
    // Rank events re-sort the children a microtask later.
    await Promise.resolve();
    await Promise.resolve();
    const after = data();
    const keys = Object.keys(before) as (keyof typeof before)[];
    const changed: Record<string, unknown> = {};
    for (const k of keys) {
      const c = changes(before[k] as Record<string, unknown>, after[k] as Record<string, unknown>);
      if (Object.keys(c).length > 0) changed[k] = c;
    }
    out.push(JSON.parse(JSON.stringify({
      event: name,
      untouched: keys.filter((k) => before[k] === after[k]),
      ...changed,
    })));
  }
  return out;
}

const a = () => useAppStore.getState();

describe("live updates", () => {
  it("of items", async () => {
    markWorkItemsDeleted(["gone"]);
    const events: Event[] = [
      ["insert a new item, with the legacy rank", () => a().applyRealtimeWorkItem("INSERT", { id: "n1", title: "New", status: "in_progress", parent_id: null, backlog_assignments: { t1: "b2" }, rank: 7, organization_id: ORG, changed_at: "2026-11-01T10:00:00Z" })],
      ["insert a child under w6", () => a().applyRealtimeWorkItem("INSERT", { id: "n2", title: "Child", parent_id: "w6", backlog_assignments: { t1: "b2" }, organization_id: ORG })],
      ["the echo of n2 as it is", () => a().applyRealtimeWorkItem("UPDATE", { id: "n2", title: "Child", parent_id: "w6", backlog_assignments: { t1: "b2" }, organization_id: ORG, status: "not_started" })],
      ["insert of an item deleted here a moment ago", () => a().applyRealtimeWorkItem("INSERT", { id: "gone", title: "Gone", parent_id: null, backlog_assignments: { t1: "b1" }, organization_id: ORG })],
      ["w3 renamed, no assignments in the row", () => a().applyRealtimeWorkItem("UPDATE", { id: "w3", title: "W3 renamed", parent_id: "w2", organization_id: ORG, description: "d", points: 3, rating: 4, deadline: "2026-12-01", created_on: "2026-01-02", started_on: "2026-02-03" })],
      ["w4 with only tree two's assignment", () => a().applyRealtimeWorkItem("UPDATE", { id: "w4", title: "w4", parent_id: null, backlog_assignments: { t2: "b3" }, organization_id: ORG })],
      ["w4 with tree one's assignment emptied", () => a().applyRealtimeWorkItem("UPDATE", { id: "w4", title: "w4", parent_id: null, backlog_assignments: { t1: "" , t2: "b3" }, organization_id: ORG })],
      ["w6 in the legacy enriched form", () => a().applyRealtimeWorkItem("UPDATE", { id: "w6", title: "w6", parent_id: null, backlog_assignments: { t1: { backlogId: "b1" } }, organization_id: ORG })],
      ["w3 moved under w1", () => a().applyRealtimeWorkItem("UPDATE", { id: "w3", title: "W3 renamed", parent_id: "w1", organization_id: ORG })],
      ["w3 given w4 as parent in tree two", () => a().applyRealtimeWorkItem("UPDATE", { id: "w3", title: "W3 renamed", parent_id: "w1", parent_id_overrides: { t2: "w4", t3: 5 }, organization_id: ORG })],
      ["w3 without the overrides column (kept)", () => a().applyRealtimeWorkItem("UPDATE", { id: "w3", title: "W3 again", parent_id: "w1", organization_id: ORG, respawn_enabled: true, respawn_interval_days: 7, respawn_hour: 8, respawn_minute: 30 })],
      ["w3 with its overrides cleared", () => a().applyRealtimeWorkItem("UPDATE", { id: "w3", title: "W3 again", parent_id: "w1", parent_id_overrides: null, organization_id: ORG, started_on: null, ended_on: "2026-03-04" })],
      ["w5 overrides as an array (none)", () => a().applyRealtimeWorkItem("UPDATE", { id: "w5", title: "w5", parent_id: "w4", parent_id_overrides: ["x"], backlog_assignments: { t1: "b1", t2: "b3" }, organization_id: ORG })],
      ["w2 deleted: w3's old parent, now orphan-free", () => a().applyRealtimeWorkItem("DELETE", { id: "w2" })],
      ["w1 deleted: its children promoted to the root", () => a().applyRealtimeWorkItem("DELETE", { id: "w1" })],
      ["w4 given a parent, then w6 deleted with w4 under it", () => {
        a().applyRealtimeWorkItem("UPDATE", { id: "w4", title: "w4", parent_id: "w6", backlog_assignments: { t2: "b3" }, organization_id: ORG });
        a().applyRealtimeWorkItem("UPDATE", { id: "w6", title: "w6", parent_id: "n1", backlog_assignments: { t1: "b1" }, organization_id: ORG });
        a().applyRealtimeWorkItem("DELETE", { id: "w6" });
      }],
      ["delete of an unknown item", () => a().applyRealtimeWorkItem("DELETE", { id: "nope" })],
    ];
    const record = await play(events);
    forgetDeletedWorkItems(["gone"]);
    expect(record).toMatchSnapshot();
  });

  it("of ranks and board ranks", async () => {
    const events: Event[] = [
      ["w5 to the top of b1: its parent w4's children re-sorted", () => a().applyRealtimeWorkItemRank("UPDATE", { work_item_id: "w5", backlog_id: "b1", rank: -1 })],
      ["w2 below w5 in b1: w1's children re-sorted", () => a().applyRealtimeWorkItemRank("UPDATE", { work_item_id: "w2", backlog_id: "b1", rank: 9 })],
      ["a batch: w2 and w5 swapped in b3 of tree two", () => {
        a().applyRealtimeWorkItemRank("INSERT", { work_item_id: "w2", backlog_id: "b3", rank: 2 });
        a().applyRealtimeWorkItemRank("UPDATE", { work_item_id: "w5", backlog_id: "b3", rank: 3 });
      }],
      ["the same rank again", () => a().applyRealtimeWorkItemRank("UPDATE", { work_item_id: "w2", backlog_id: "b1", rank: 9 })],
      ["a rank without a number", () => a().applyRealtimeWorkItemRank("UPDATE", { work_item_id: "w3", backlog_id: "b1" })],
      ["a rank for an unknown list", () => a().applyRealtimeWorkItemRank("UPDATE", { work_item_id: "w3", backlog_id: "zz", rank: 1 })],
      ["a rank deleted", () => a().applyRealtimeWorkItemRank("DELETE", { work_item_id: "w2", backlog_id: "b3" })],
      ["a rank deleted that is not held", () => a().applyRealtimeWorkItemRank("DELETE", { work_item_id: "w2", backlog_id: "b3" })],
      ["a rank for an unknown item", () => a().applyRealtimeWorkItemRank("UPDATE", { work_item_id: "nope", backlog_id: "b1", rank: 1 })],
      ["a board rank", () => a().applyRealtimeWorkItemBoardRank("UPDATE", { work_item_id: "w1", backlog_id: "b1", rank: 2 })],
      ["the same board rank", () => a().applyRealtimeWorkItemBoardRank("INSERT", { work_item_id: "w1", backlog_id: "b1", rank: 2 })],
      ["a board rank without a number", () => a().applyRealtimeWorkItemBoardRank("UPDATE", { work_item_id: "w4", backlog_id: "b3" })],
      ["a board rank deleted", () => a().applyRealtimeWorkItemBoardRank("DELETE", { work_item_id: "w4", backlog_id: "b1" })],
      ["a board rank deleted that is not held", () => a().applyRealtimeWorkItemBoardRank("DELETE", { work_item_id: "w4", backlog_id: "b1" })],
      ["a board rank for an unknown item", () => a().applyRealtimeWorkItemBoardRank("UPDATE", { work_item_id: "nope", backlog_id: "b1", rank: 1 })],
    ];
    expect(await play(events)).toMatchSnapshot();
  });

  it("of ranks this page has just written: ignored for a moment", async () => {
    // The store's own actions work with ids that name their organization.
    const id = (x: string) => `${ORG}::${x}`;
    useAppStore.setState({
      backlogs: { [id("b1")]: { id: id("b1"), name: "B1", parentId: null, childrenIds: [], treeId: id("t1"), rank: 0 } as Backlog },
      backlogTrees: { [id("t1")]: { id: id("t1"), name: "T1", rank: 0, rootBacklogIds: [id("b1")] } as BacklogTree },
      workItems: {
        [id("w1")]: item(id("w1"), { backlogAssignments: { [id("t1")]: id("b1") }, ranks: { [id("b1")]: 0 } }),
        [id("w4")]: item(id("w4"), { backlogAssignments: { [id("t1")]: id("b1") }, ranks: { [id("b1")]: 1 } }),
        w6: item("w6", { backlogAssignments: { t1: "b2" }, ranks: { b2: 0 } }),
      },
    } as never);
    // w4 above w1: a local reorder writes ranks.
    a().reorderWorkItemAmongSiblings(id("w4"), 0, id("t1"), [id("b1")]);
    const after = useAppStore.getState().workItems;
    expect(after[id("w4")].ranks[id("b1")]).toBeLessThan(after[id("w1")].ranks[id("b1")]);
    a().applyRealtimeWorkItemRank("UPDATE", { work_item_id: id("w4"), backlog_id: id("b1"), rank: 100 });
    a().applyRealtimeWorkItemBoardRank("UPDATE", { work_item_id: "w6", backlog_id: "b2", rank: 100 });
    await Promise.resolve();
    expect(useAppStore.getState().workItems[id("w4")].ranks[id("b1")]).toBe(after[id("w4")].ranks[id("b1")]);
    // A board rank this page did not write comes through.
    expect(useAppStore.getState().workItems.w6.boardRanks?.b2).toBe(100);
  });

  it("of lists and trees", async () => {
    const events: Event[] = [
      ["a new list at the root of t2", () => a().applyRealtimeBacklog("INSERT", { id: "n1", name: "N1", parent_id: null, tree_id: "t2", rank: -1 })],
      ["a new list under b1, ranked between", () => a().applyRealtimeBacklog("INSERT", { id: "n2", name: "N2", parent_id: "b1", tree_id: "t1", rank: 0.5, view_mode: "board", board_hidden_status_keys: ["done"], ratings_enabled: true, points: 8 })],
      ["n2 renamed, the columns left out (kept)", () => a().applyRealtimeBacklog("UPDATE", { id: "n2", name: "N2b", parent_id: "b1", tree_id: "t1", rank: 0.5 })],
      ["n2 switches given (off, on, on), points cleared", () => a().applyRealtimeBacklog("UPDATE", { id: "n2", name: "N2b", parent_id: "b1", tree_id: "t1", rank: 0.5, ratings_enabled: null, created_dates_enabled: true, start_end_dates_enabled: true, points: null, view_mode: "timeline" })],
      ["b1b ranked first under b1", () => a().applyRealtimeBacklog("UPDATE", { id: "b1b", name: "B1b", parent_id: "b1", tree_id: "t1", rank: -5 })],
      ["b2 ranked first among t1's roots", () => a().applyRealtimeBacklog("UPDATE", { id: "b2", name: "B2", parent_id: null, tree_id: "t1", rank: -5 })],
      ["b1a moved under b2", () => a().applyRealtimeBacklog("UPDATE", { id: "b1a", name: "B1a", parent_id: "b2", tree_id: "t1", rank: 0 })],
      ["b2 moved to tree two's root", () => a().applyRealtimeBacklog("UPDATE", { id: "b2", name: "B2", parent_id: null, tree_id: "t2", rank: 3 })],
      ["b1a1 deleted (a child)", () => a().applyRealtimeBacklog("DELETE", { id: "b1a1" })],
      ["n1 deleted (a root)", () => a().applyRealtimeBacklog("DELETE", { id: "n1" })],
      ["an unknown list deleted", () => a().applyRealtimeBacklog("DELETE", { id: "nope" })],
      ["a new tree", () => a().applyRealtimeBacklogTree("INSERT", { id: "t3", name: "T3", rank: 2 })],
      ["t1 renamed, points on", () => a().applyRealtimeBacklogTree("UPDATE", { id: "t1", name: "T1b", rank: 0, points_enabled: true })],
      ["t3 deleted", () => a().applyRealtimeBacklogTree("DELETE", { id: "t3" })],
      ["an unknown tree deleted", () => a().applyRealtimeBacklogTree("DELETE", { id: "nope" })],
    ];
    expect(await play(events)).toMatchSnapshot();
  });

  it("of links", async () => {
    const events: Event[] = [
      ["a new link for w1, ranked first", () => a().applyRealtimeHyperlink("INSERT", { id: "h3", work_item_id: "w1", url: "https://c.example", alt_text: "C", rank: -1 })],
      ["h1 moved last, no alt text", () => a().applyRealtimeHyperlink("UPDATE", { id: "h1", work_item_id: "w1", url: "https://a2.example", rank: 5 })],
      ["a first link for w2, no rank", () => a().applyRealtimeHyperlink("INSERT", { id: "h4", work_item_id: "w2", url: "https://d.example", alt_text: "D" })],
      ["h2 deleted", () => a().applyRealtimeHyperlink("DELETE", { id: "h2", work_item_id: "w1" })],
      ["an unknown link deleted", () => a().applyRealtimeHyperlink("DELETE", { id: "nope", work_item_id: "w1" })],
      ["a link of an item without links deleted", () => a().applyRealtimeHyperlink("DELETE", { id: "nope", work_item_id: "w6" })],
    ];
    expect(await play(events)).toMatchSnapshot();
  });

  it("arrivals from elsewhere survive an undo of an edit made here", () => {
    a().renameWorkItem("w1", "Renamed here");
    a().applyRealtimeWorkItem("INSERT", { id: "r1", title: "Remote", parent_id: null, backlog_assignments: { t1: "b1" }, organization_id: ORG });
    a().applyRealtimeBacklog("INSERT", { id: "rb", name: "Remote list", parent_id: null, tree_id: "t1", rank: 9 });
    a().applyRealtimeBacklogTree("INSERT", { id: "rt", name: "Remote tree", rank: 9 });
    a().undo();
    const s = useAppStore.getState();
    expect(s.workItems.w1.title).toBe("w1");
    expect(s.workItems.r1?.title).toBe("Remote");
    expect(s.backlogs.rb?.name).toBe("Remote list");
    expect(s.backlogTrees.rt?.name).toBe("Remote tree");
  });
});
