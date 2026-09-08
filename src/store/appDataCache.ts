/**
 * Offline snapshot of an org's app data, kept in IndexedDB.
 *
 * This used to live in localStorage, which meant a JSON.stringify of the whole
 * snapshot — several megabytes for a large org — plus a blocking disk write, on
 * the main thread, every time the cache was touched. That included every
 * work-item add, which did a full parse *and* a full re-stringify to patch a
 * couple of entries. IndexedDB stores the object graph by structured clone, so
 * there is no serialization step at all and the write happens off-thread.
 *
 * Every operation degrades to a no-op when IndexedDB is unavailable (private
 * windows, jsdom under test, storage disabled): the cache is an optimisation,
 * never a source of truth, so callers just fall through to the network.
 */
import type { WorkItem, Backlog, BacklogTree, Hyperlink } from "@/types/models";
import type { ChangeLogEntry } from "./changeLog";

export interface CachedAppData {
  orgId: string;
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
  hyperlinks: Record<string, Hyperlink[]>;
  changeLog: ChangeLogEntry[];
  selectedBacklogIds: string[];
  selectedTreeId: string | null;
  selectedWorkItemIds: string[];
  timestamp: number;
}

const DB_NAME = "agilefant-app-cache";
const STORE = "orgSnapshots";
const LEGACY_KEY_PREFIX = "cached_app_data_";

export const DATA_CACHE_TTL_MS = 30 * 60 * 1000; // stale-while-revalidate

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function idbGet(db: IDBDatabase, key: string): Promise<CachedAppData | null> {
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as CachedAppData) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function idbPut(db: IDBDatabase, key: string, value: CachedAppData): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      // Quota exceeded and friends: the snapshot simply is not cached.
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Reads whatever the previous localStorage-backed cache left behind, so an
 * existing user gets one migrated load instead of a cold network fetch.
 *
 * `consume` is only set once the snapshot has somewhere to go: dropping the
 * entry frees up several megabytes of the origin's localStorage quota, but
 * doing that with no IndexedDB to migrate into would throw away the only cache
 * such a browser has.
 */
function readLegacySnapshot(orgId: string, consume: boolean): CachedAppData | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY_PREFIX + orgId);
    if (consume) localStorage.removeItem(LEGACY_KEY_PREFIX + orgId);
    return raw ? (JSON.parse(raw) as CachedAppData) : null;
  } catch {
    return null;
  }
}

function usable(snapshot: CachedAppData | null, orgId: string): CachedAppData | null {
  if (!snapshot?.workItems || !snapshot.timestamp || snapshot.orgId !== orgId) return null;
  return Date.now() - snapshot.timestamp > DATA_CACHE_TTL_MS ? null : snapshot;
}

// Writes for one org are chained so a read-modify-write patch cannot lose an
// update to a write that started while it was in flight.
const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite(orgId: string, task: () => Promise<void>): void {
  const previous = writeQueues.get(orgId) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task).catch(() => undefined);
  writeQueues.set(orgId, next);
  next.finally(() => {
    if (writeQueues.get(orgId) === next) writeQueues.delete(orgId);
  });
}

/** Resolves once every write queued for `orgId` has been applied. */
export function flushCachedWrites(orgId: string): Promise<void> {
  return (writeQueues.get(orgId) ?? Promise.resolve()).catch(() => undefined);
}

/** Drops every cached snapshot. */
export async function clearAllCachedAppData(): Promise<void> {
  await Promise.all([...writeQueues.values()].map((p) => p.catch(() => undefined)));
  writeQueues.clear();
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function readCachedAppData(orgId: string): Promise<CachedAppData | null> {
  const db = await openDb();
  if (!db) return usable(readLegacySnapshot(orgId, false), orgId);

  const cached = usable(await idbGet(db, orgId), orgId);
  if (cached) return cached;

  const migrated = usable(readLegacySnapshot(orgId, true), orgId);
  // Carry it into IndexedDB so the next read skips the JSON parse entirely.
  if (migrated) enqueueWrite(orgId, () => idbPut(db, orgId, migrated));
  return migrated;
}

/** Fire-and-forget: callers never wait on the cache being persisted. */
export function writeCachedAppData(
  orgId: string,
  data: Omit<CachedAppData, "orgId" | "timestamp">,
): void {
  // Only cache if there's actual data to show.
  if (Object.keys(data.workItems).length === 0 && Object.keys(data.backlogs).length === 0) return;
  const snapshot: CachedAppData = { orgId, ...data, timestamp: Date.now() };
  enqueueWrite(orgId, async () => {
    const db = await openDb();
    if (db) await idbPut(db, orgId, snapshot);
  });
}

/** Fire-and-forget patch of just the work items that changed. */
export function patchCachedWorkItems(
  orgId: string,
  workItemsPatch: Record<string, WorkItem>,
  selectedWorkItemIds?: string[],
): void {
  enqueueWrite(orgId, async () => {
    const db = await openDb();
    if (!db) return;
    const existing = await idbGet(db, orgId);
    if (!existing) return;
    await idbPut(db, orgId, {
      ...existing,
      workItems: { ...existing.workItems, ...workItemsPatch },
      selectedWorkItemIds: selectedWorkItemIds ?? existing.selectedWorkItemIds,
      timestamp: Date.now(),
    });
  });
}
