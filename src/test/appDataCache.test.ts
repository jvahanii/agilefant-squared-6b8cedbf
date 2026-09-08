/**
 * The app-data snapshot moved from localStorage to IndexedDB so that writing it
 * no longer costs a multi-megabyte JSON.stringify plus a blocking disk write on
 * the main thread. These tests cover the parts of that move that can silently
 * regress: the round trip, TTL expiry, the partial work-item patch, and the
 * one-time migration of snapshots left behind in localStorage.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  readCachedAppData,
  writeCachedAppData,
  patchCachedWorkItems,
  flushCachedWrites,
  clearAllCachedAppData,
  DATA_CACHE_TTL_MS,
  type CachedAppData,
} from "@/store/appDataCache";
import type { WorkItem } from "@/types/models";

const ORG = "cache-org";
const LEGACY_KEY = `cached_app_data_${ORG}`;

function item(id: string, title: string): WorkItem {
  return {
    id, title, status: "not_started", parentId: null, childrenIds: [],
    backlogAssignments: {}, ranks: {}, boardRanks: {}, organizationId: ORG,
  } as WorkItem;
}

function snapshotBody(workItems: Record<string, WorkItem>) {
  return {
    workItems,
    backlogs: { b1: { id: "b1", name: "B", parentId: null, childrenIds: [], treeId: "t1", rank: 0, boardHiddenStatusKeys: [], viewMode: "list" as const } },
    backlogTrees: { t1: { id: "t1", name: "T", rootBacklogIds: ["b1"], rank: 0, pointsEnabled: null } },
    hyperlinks: {},
    changeLog: [],
    selectedBacklogIds: ["b1"],
    selectedTreeId: "t1",
    selectedWorkItemIds: [],
  };
}

beforeEach(async () => {
  localStorage.clear();
  await clearAllCachedAppData();
});

describe("app data cache", () => {
  it("round-trips a snapshot", async () => {
    writeCachedAppData(ORG, snapshotBody({ a: item("a", "Alpha") }));
    await flushCachedWrites(ORG);

    const cached = await readCachedAppData(ORG);
    expect(cached?.orgId).toBe(ORG);
    expect(Object.keys(cached!.workItems)).toEqual(["a"]);
    expect(cached!.selectedTreeId).toBe("t1");
  });

  it("does not cache an empty snapshot", async () => {
    writeCachedAppData(ORG, { ...snapshotBody({}), backlogs: {}, backlogTrees: {} });
    await flushCachedWrites(ORG);
    expect(await readCachedAppData(ORG)).toBeNull();
  });

  it("ignores a snapshot belonging to another org", async () => {
    writeCachedAppData(ORG, snapshotBody({ a: item("a", "Alpha") }));
    await flushCachedWrites(ORG);
    expect(await readCachedAppData("some-other-org")).toBeNull();
  });

  it("patches work items without disturbing the rest of the snapshot", async () => {
    writeCachedAppData(ORG, snapshotBody({ a: item("a", "Alpha") }));
    await flushCachedWrites(ORG);

    patchCachedWorkItems(ORG, { b: item("b", "Beta") }, ["b"]);
    await flushCachedWrites(ORG);

    const cached = await readCachedAppData(ORG);
    expect(Object.keys(cached!.workItems).sort()).toEqual(["a", "b"]);
    expect(cached!.selectedWorkItemIds).toEqual(["b"]);
    expect(cached!.backlogTrees.t1.rootBacklogIds).toEqual(["b1"]);
  });

  it("does not create a snapshot when patching with nothing cached", async () => {
    patchCachedWorkItems(ORG, { b: item("b", "Beta") });
    await flushCachedWrites(ORG);
    expect(await readCachedAppData(ORG)).toBeNull();
  });

  it("serialises overlapping patches so neither is lost", async () => {
    writeCachedAppData(ORG, snapshotBody({ a: item("a", "Alpha") }));
    patchCachedWorkItems(ORG, { b: item("b", "Beta") });
    patchCachedWorkItems(ORG, { c: item("c", "Gamma") });
    await flushCachedWrites(ORG);

    const cached = await readCachedAppData(ORG);
    expect(Object.keys(cached!.workItems).sort()).toEqual(["a", "b", "c"]);
  });

  it("treats a snapshot past its TTL as absent", async () => {
    const stale: CachedAppData = {
      orgId: ORG,
      ...snapshotBody({ a: item("a", "Alpha") }),
      timestamp: Date.now() - DATA_CACHE_TTL_MS - 1000,
    };
    localStorage.setItem(LEGACY_KEY, JSON.stringify(stale));
    expect(await readCachedAppData(ORG)).toBeNull();
  });

  it("migrates a localStorage snapshot and stops using localStorage for it", async () => {
    const legacy: CachedAppData = {
      orgId: ORG,
      ...snapshotBody({ a: item("a", "Legacy") }),
      timestamp: Date.now(),
    };
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));

    const migrated = await readCachedAppData(ORG);
    expect(Object.values(migrated!.workItems).map((w) => w.title)).toEqual(["Legacy"]);

    // The legacy entry is handed over, not left behind occupying quota.
    await flushCachedWrites(ORG);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();

    // ...and the snapshot is now served from IndexedDB.
    const fromIdb = await readCachedAppData(ORG);
    expect(Object.values(fromIdb!.workItems).map((w) => w.title)).toEqual(["Legacy"]);
  });

  it("survives malformed legacy JSON", async () => {
    localStorage.setItem(LEGACY_KEY, "{not valid json");
    expect(await readCachedAppData(ORG)).toBeNull();
  });
});
