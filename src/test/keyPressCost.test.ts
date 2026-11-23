/**
 * What a key press costs in a large organisation (2026-11-23): a reorder
 * touches only the items whose place changes, and the checks every change to
 * the store asks again do not go through every item each time.
 *
 * Timed in the production build on 7 500 items, a status change took about
 * twice as long as now, and a step up or down in a list of 1 500 gave all
 * 1 500 items new objects and saved 1 500 rank rows.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useAppStore } from "@/store/appStore";
import * as sync from "@/store/supabaseSync";
import { noItems } from "@/components/listPanel/useOrgIsEmpty";
import { gettingStartedSteps, NEW_ORG_DAYS } from "@/components/listPanel/startSteps";
import { toIsoDate } from "@/lib/deadlineFormat";
import type { WorkItem } from "@/types/models";

vi.mock("@/store/supabaseSync", () => ({
  loadFromSupabase: vi.fn().mockResolvedValue({ workItems: {}, backlogs: {}, backlogTrees: {} }),
  upsertWorkItem: vi.fn().mockResolvedValue(true),
  upsertWorkItems: vi.fn().mockResolvedValue(true),
  upsertWorkItemBacklogRankRows: vi.fn().mockResolvedValue(true),
  upsertWorkItemBacklogRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
  upsertWorkItemBoardRankRows: vi.fn().mockResolvedValue(true),
  upsertWorkItemBoardRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
  registerWorkItemRenameCallback: vi.fn(),
}));

const ORG = "cost-org";
const TREE = `${ORG}::t1`;
const LIST = `${ORG}::b1`;
const W = (n: number) => `${ORG}::w${n}`;

function list(ranks: number[]) {
  const workItems: Record<string, WorkItem> = {};
  ranks.forEach((rank, n) => {
    workItems[W(n)] = {
      id: W(n), title: `w${n}`, status: "not_started", parentId: null, childrenIds: [],
      backlogAssignments: { [TREE]: LIST }, ranks: { [LIST]: rank }, boardRanks: {}, organizationId: ORG,
    } as WorkItem;
  });
  useAppStore.setState({
    organizationId: ORG,
    workItems,
    backlogs: { [LIST]: { id: LIST, name: "B1", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
    backlogTrees: { [TREE]: { id: TREE, name: "T1", rank: 0, rootBacklogIds: [LIST] } },
    selectedWorkItemIds: [],
    undoStack: [],
    redoStack: [],
  } as never);
  return workItems;
}

const savedRanks = () =>
  vi.mocked(sync.upsertWorkItemBacklogRankRowsDetailed).mock.calls.flatMap(([rows]) => rows.map((r) => `${r.workItemId.split("::")[1]}=${r.rank}`));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("a reorder in a long list", () => {
  it("gives new objects to, and saves, only the items whose place changes", () => {
    const before = list(Array.from({ length: 1500 }, (_, i) => i));
    useAppStore.getState().reorderWorkItemAmongSiblings(W(700), 699, TREE, [LIST]);

    const after = useAppStore.getState().workItems;
    const changed = Object.keys(after).filter((id) => after[id] !== before[id]);
    expect(changed.sort()).toEqual([W(699), W(700)]);
    expect(after[W(700)].ranks[LIST]).toBe(699);
    expect(after[W(699)].ranks[LIST]).toBe(700);
    expect(savedRanks().sort()).toEqual(["w699=700", "w700=699"]);
  });

  it("still renumbers, and saves, ranks that had gaps", () => {
    list([0, 10, 20, 30]);
    useAppStore.getState().reorderWorkItemAmongSiblings(W(3), 0, TREE, [LIST]);
    const ranks = Object.fromEntries(Object.values(useAppStore.getState().workItems).map((w) => [w.title, w.ranks[LIST]]));
    expect(ranks).toEqual({ w3: 0, w0: 1, w1: 2, w2: 3 });
    // w3 was not at 0 before; w0 was at 0 and is now at 1, and so on: all four moved.
    expect(savedRanks().sort()).toEqual(["w0=1", "w1=2", "w2=3", "w3=0"]);
  });

  it("changes and saves nothing when nothing moves", () => {
    const before = list([0, 1, 2]);
    useAppStore.getState().reorderWorkItemAmongSiblings(W(1), 1, TREE, [LIST]);
    const after = useAppStore.getState().workItems;
    expect(Object.keys(after).every((id) => after[id] === before[id])).toBe(true);
    expect(savedRanks()).toEqual([]);
  });
});

describe("whether the organisation has no items", () => {
  it("answers without listing the items, and stays right as they come and go", () => {
    const items = { a: { id: "a" }, b: { id: "b" } } as unknown as Record<string, WorkItem>;
    expect(noItems(items)).toBe(false);
    // The item it found is deleted: it looks again.
    const { a: _a, ...withoutA } = items;
    expect(noItems(withoutA)).toBe(false);
    const { b: _b, ...none } = withoutA;
    expect(noItems(none)).toBe(true);
    expect(noItems({ c: { id: "c" } } as unknown as Record<string, WorkItem>)).toBe(false);
  });
});

describe("whether the organisation is new", () => {
  const today = new Date("2026-11-23T12:00:00");
  const daysAgo = (n: number) => toIsoDate(new Date(today.getTime() - n * 86_400_000));
  const at = (id: string, createdOn: string, extra: Partial<WorkItem> = {}) =>
    ({ id, createdOn, parentId: null, status: "not_started", ...extra }) as WorkItem;

  it("settles on an old item, and looks again once it is gone or no longer old", () => {
    const old = at("old", daysAgo(NEW_ORG_DAYS + 30));
    const fresh = { n1: at("n1", daysAgo(1)), n2: at("n2", daysAgo(2), { status: "done" }), n3: at("n3", daysAgo(3)) };
    expect(gettingStartedSteps({ ...fresh, old }, today)).toBeNull();
    // Asked again with the same old item there: still not new.
    expect(gettingStartedSteps({ ...fresh, old }, today)).toBeNull();
    // The old item deleted: new after all.
    expect(gettingStartedSteps(fresh, today)).toEqual([
      { key: "more", done: true },
      { key: "nest", done: false },
      { key: "done", done: true },
    ]);
    // Found old again, then its date changed to a recent one.
    expect(gettingStartedSteps({ ...fresh, old }, today)).toBeNull();
    expect(gettingStartedSteps({ ...fresh, old: { ...old, createdOn: daysAgo(4) } }, today)?.length).toBe(3);
  });
});
