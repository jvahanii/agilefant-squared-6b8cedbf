/**
 * Loading repairs shared list ranks (sanitizeData → dedupWorkItemRanksInPlace)
 * and must save what it repaired. It did not: the repair stayed in memory, and
 * healDuplicateRanks — which does save — ran after it and found nothing left
 * to heal. The page then showed 2, 3, 4 where the database said 2, 2, 3, and
 * any later write of only the ranks it changed could land on a stale value
 * and share it again (seen live on 2026-11-08 in the test list).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  loadFromSupabase: vi.fn(),
  loadHyperlinksForWorkItems: vi.fn().mockResolvedValue({}),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn().mockResolvedValue(true),
  upsertWorkItemBacklogRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
  upsertWorkItemBoardRankRowsDetailed: vi.fn().mockResolvedValue({ ok: true, missingWorkItemIds: [] }),
}));
vi.mock("@/store/changeLog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/changeLog")>()),
  loadChangeLog: vi.fn().mockResolvedValue([]),
  insertChangeLogEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/store/appDataCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/appDataCache")>()),
  readCachedAppData: vi.fn().mockResolvedValue(null),
  writeCachedAppData: vi.fn(),
}));

import { useAppStore } from "@/store/appStore";
import { loadFromSupabase, upsertWorkItemBacklogRankRowsDetailed } from "@/store/supabaseSync";
import { readCachedAppData } from "@/store/appDataCache";
import type { WorkItem } from "@/types/models";

const ORG = "org";
const OTHER_ORG = "zzz";
const BT = `${ORG}::bt-1`;
const BL = `${ORG}::bl-1`;
const A = `${ORG}::wi-a`;
const B = `${ORG}::wi-b`;
const C = `${ORG}::wi-c`;
const E = `${ORG}::wi-e`;
const SHARED = `${OTHER_ORG}::wi-d`;

const item = (id: string, rank: number | undefined, organizationId = ORG, parentId: string | null = null): WorkItem =>
  ({
    id, title: id, status: "not_started", parentId, childrenIds: [], organizationId,
    backlogAssignments: { [BT]: BL },
    ranks: rank === undefined ? {} : { [BL]: rank },
  }) as WorkItem;

/** In the database: A and B share 2; E (under P) and another org's item with
 *  no rank row share 0. */
function rawData() {
  return {
    workItems: {
      [A]: item(A, 2),
      [B]: item(B, 2),
      [C]: item(C, 3),
      [`${ORG}::wi-p`]: { ...item(`${ORG}::wi-p`, 9), childrenIds: [E, SHARED] },
      [E]: item(E, 0, ORG, `${ORG}::wi-p`),
      [SHARED]: item(SHARED, undefined, OTHER_ORG, `${ORG}::wi-p`),
    },
    backlogs: { [BL]: { id: BL, name: "List", parentId: null, childrenIds: [], treeId: BT, rank: 0 } },
    backlogTrees: { [BT]: { id: BT, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
  };
}

const written = () =>
  new Map(
    vi.mocked(upsertWorkItemBacklogRankRowsDetailed).mock.calls
      .flatMap(([rows]) => rows)
      .map((r) => [r.workItemId, r.rank]),
  );

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  vi.mocked(upsertWorkItemBacklogRankRowsDetailed).mockClear();
  vi.mocked(loadFromSupabase).mockReset();
  vi.mocked(loadFromSupabase).mockResolvedValue(rawData() as never);
  vi.mocked(readCachedAppData).mockResolvedValue(null);
  useAppStore.setState({
    organizationId: ORG, isLoading: false, workItems: {}, backlogs: {}, backlogTrees: {},
    selectedWorkItemIds: [], undoStack: [], redoStack: [],
  } as never);
});

function expectRepairSaved() {
  const { workItems } = useAppStore.getState();
  // The page holds distinct ranks...
  expect(workItems[A].ranks[BL]).toBe(2);
  expect(workItems[B].ranks[BL]).toBe(3);
  expect(workItems[C].ranks[BL]).toBe(4);
  // ...and the ones it repaired are saved, so the database says the same.
  const rows = written();
  expect(rows.get(B)).toBe(3);
  expect(rows.get(C)).toBe(4);
  // Another organization's item without a rank row is repaired on the page
  // only: creating its row is not this organization's to do.
  expect(workItems[SHARED].ranks[BL]).toBe(1);
  expect(rows.has(SHARED)).toBe(false);
}

describe("loading saves the list ranks it repairs", () => {
  it("on a load with nothing cached", async () => {
    await useAppStore.getState().loadFromSupabase();
    await settle();
    expectRepairSaved();
  });

  it("on the refresh behind a cached copy", async () => {
    const data = rawData();
    vi.mocked(readCachedAppData).mockResolvedValue({
      orgId: ORG, ...data, hyperlinks: {}, changeLog: [],
      selectedBacklogIds: [], selectedTreeId: null, selectedWorkItemIds: [],
      timestamp: Date.now(),
    } as never);
    await useAppStore.getState().loadFromSupabase();
    await settle();
    expectRepairSaved();
  });

  it("saves nothing when no ranks are shared", async () => {
    const data = rawData();
    data.workItems[B] = item(B, 5);
    data.workItems[SHARED] = item(SHARED, 1, OTHER_ORG, `${ORG}::wi-p`);
    vi.mocked(loadFromSupabase).mockResolvedValue(data as never);
    await useAppStore.getState().loadFromSupabase();
    await settle();
    expect(written().size).toBe(0);
  });
});
