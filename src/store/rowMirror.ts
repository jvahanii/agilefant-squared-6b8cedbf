/**
 * The organization's own items, ranks and links as the database has them,
 * kept in the browser so that a load asks only for what changed.
 *
 * Every start and every catch-up used to download all of it again — some 7 MB
 * in forty requests, about three times an hour — and while that burst ran the
 * database kept every other request waiting seconds. Nearly all of it was rows
 * the browser already had.
 *
 * Now the first load reads everything, as before, and notes the database's
 * time. Later loads ask get_org_changes (20261105090000) for the rows changed
 * since then, a few minutes' overlap included, and the keys deleted since;
 * merge them in; and check the result against the database's own counts. Any
 * doubt — counts that disagree, a copy older than the deletions are kept for,
 * an error — and the load is a full one again.
 *
 * Only the active organization's rows: a partner's are few and read in full.
 */
import { supabase } from "@/integrations/supabase/client";

export type RankMap = Record<string, Record<string, number>>;

export interface HyperlinkRow {
  id: string;
  work_item_id: string;
  url: string;
  alt_text: string | null;
  rank: number | null;
}

export interface OrgRows {
  /** work_items rows, as the API returns them. */
  items: Record<string, unknown>[];
  ranks: { backlog: RankMap; board: RankMap };
  /** In rank order, then by id, as the full read returns them. */
  hyperlinks: HyperlinkRow[];
}

/** How each part is read in full. */
export interface FullReads {
  items: () => Promise<Record<string, unknown>[]>;
  ranks: () => Promise<{ backlog: RankMap; board: RankMap }>;
  hyperlinks: () => Promise<HyperlinkRow[]>;
}

interface Counts {
  items: number;
  backlogRanks: number;
  boardRanks: number;
  hyperlinks: number;
}

interface Changes {
  now: string;
  counts: Counts;
  items: Record<string, unknown>[] | null;
  backlogRanks: Array<[string, string, number]> | null;
  boardRanks: Array<[string, string, number]> | null;
  hyperlinks: HyperlinkRow[] | null;
  deleted: Array<[string, string]> | null;
}

export interface Mirror {
  version: number;
  orgId: string;
  /** The database's time the copy is complete up to. */
  snapshotAt: string;
  items: Record<string, Record<string, unknown>>;
  backlogRanks: RankMap;
  boardRanks: RankMap;
  hyperlinks: Record<string, HyperlinkRow>;
}

export type ChangesRpc = (orgId: string, since: string | null) => Promise<Changes>;

const VERSION = 1;

/**
 * Asked for again: rows written in a transaction that began before the copy's
 * time but ended after it carry the earlier time, and would otherwise be missed.
 */
export const CHANGES_OVERLAP_MS = 5 * 60_000;

/** The database keeps deletions thirty days; a copy older than this is read in full. */
export const MIRROR_MAX_AGE_MS = 25 * 24 * 60 * 60_000;

const memory = new Map<string, Mirror>();
const inFlight = new Map<string, Promise<OrgRows>>();

const defaultRpc: ChangesRpc = async (orgId, since) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc("get_org_changes", { _org_id: orgId, _since: since });
  if (error) throw error;
  if (!data || typeof data !== "object" || !("counts" in data)) throw new Error("get_org_changes: no answer");
  return data as Changes;
};

/**
 * The organization's rows, fetched as lightly as can be. Calls made while one
 * is under way share it: a load asks for items and ranks, and for links in a
 * separate call, at the same moment.
 */
export function loadOrgRows(orgId: string, full: FullReads, rpc: ChangesRpc = defaultRpc): Promise<OrgRows> {
  const running = inFlight.get(orgId);
  if (running) return running;
  const promise = refresh(orgId, full, rpc).finally(() => inFlight.delete(orgId));
  inFlight.set(orgId, promise);
  return promise;
}

async function refresh(orgId: string, full: FullReads, rpc: ChangesRpc): Promise<OrgRows> {
  const kept = memory.get(orgId) ?? (await readStored(orgId));
  if (kept && Date.now() - Date.parse(kept.snapshotAt) < MIRROR_MAX_AGE_MS) {
    try {
      const since = new Date(Date.parse(kept.snapshotAt) - CHANGES_OVERLAP_MS).toISOString();
      const changes = await rpc(orgId, since);
      const { mirror, changed } = applyChanges(kept, changes);
      if (countsMatch(mirror, changes.counts)) {
        memory.set(orgId, mirror);
        if (changed) store(mirror);
        return rowsOf(mirror);
      }
      console.warn("rowMirror: the merged copy does not add up; loading everything", countsOf(mirror), changes.counts);
    } catch (err) {
      console.warn("rowMirror: changes unavailable; loading everything", err);
    }
  }
  return loadEverything(orgId, full, rpc);
}

async function loadEverything(orgId: string, full: FullReads, rpc: ChangesRpc): Promise<OrgRows> {
  // The time first: whatever changes while the reads run is asked for again next time.
  const start = await rpc(orgId, null).catch(() => null);
  const [items, ranks, hyperlinks] = await Promise.all([full.items(), full.ranks(), full.hyperlinks()]);
  const mirror: Mirror = {
    version: VERSION,
    orgId,
    snapshotAt: start?.now ?? "",
    items: Object.fromEntries(items.map((row) => [row.id as string, row])),
    backlogRanks: copyRanks(ranks.backlog),
    boardRanks: copyRanks(ranks.board),
    hyperlinks: Object.fromEntries(hyperlinks.map((link) => [link.id, link])),
  };
  if (start) {
    memory.set(orgId, mirror);
    store(mirror);
  } else {
    // Without the database's time the copy cannot be brought up to date: next time reads all again.
    memory.delete(orgId);
  }
  return rowsOf(mirror);
}

/** The copy with the changes in: deletions first, then the rows as they are now. */
export function applyChanges(kept: Mirror, changes: Changes): { mirror: Mirror; changed: boolean } {
  const mirror: Mirror = {
    ...kept,
    snapshotAt: changes.now,
    items: { ...kept.items },
    backlogRanks: { ...kept.backlogRanks },
    boardRanks: { ...kept.boardRanks },
    hyperlinks: { ...kept.hyperlinks },
  };
  let changed = false;
  const dropRank = (map: RankMap, key: string) => {
    const bar = key.indexOf("|");
    if (bar < 0) return;
    const item = key.slice(0, bar);
    const list = key.slice(bar + 1);
    if (!map[item] || !(list in map[item])) return;
    const { [list]: _gone, ...rest } = map[item];
    if (Object.keys(rest).length === 0) delete map[item];
    else map[item] = rest;
    changed = true;
  };
  for (const [kind, key] of changes.deleted ?? []) {
    if (kind === "item" && key in mirror.items) {
      delete mirror.items[key];
      changed = true;
    } else if (kind === "hyperlink" && key in mirror.hyperlinks) {
      delete mirror.hyperlinks[key];
      changed = true;
    } else if (kind === "backlog_rank") dropRank(mirror.backlogRanks, key);
    else if (kind === "board_rank") dropRank(mirror.boardRanks, key);
  }
  for (const row of changes.items ?? []) {
    mirror.items[row.id as string] = row;
    changed = true;
  }
  const setRank = (map: RankMap, [item, list, rank]: [string, string, number]) => {
    map[item] = { ...map[item], [list]: rank };
    changed = true;
  };
  for (const rank of changes.backlogRanks ?? []) setRank(mirror.backlogRanks, rank);
  for (const rank of changes.boardRanks ?? []) setRank(mirror.boardRanks, rank);
  for (const link of changes.hyperlinks ?? []) {
    mirror.hyperlinks[link.id] = link;
    changed = true;
  }
  return { mirror, changed };
}

function countsOf(mirror: Mirror): Counts {
  const rankRows = (map: RankMap) => Object.values(map).reduce((sum, ranks) => sum + Object.keys(ranks).length, 0);
  return {
    items: Object.keys(mirror.items).length,
    backlogRanks: rankRows(mirror.backlogRanks),
    boardRanks: rankRows(mirror.boardRanks),
    hyperlinks: Object.keys(mirror.hyperlinks).length,
  };
}

export function countsMatch(mirror: Mirror, counts: Counts): boolean {
  const mine = countsOf(mirror);
  return (
    mine.items === Number(counts.items) &&
    mine.backlogRanks === Number(counts.backlogRanks) &&
    mine.boardRanks === Number(counts.boardRanks) &&
    mine.hyperlinks === Number(counts.hyperlinks)
  );
}

function copyRanks(map: RankMap): RankMap {
  const out: RankMap = {};
  for (const [item, ranks] of Object.entries(map)) out[item] = { ...ranks };
  return out;
}

/**
 * Handed out as copies where the app might change them in place: the copy has
 * to stay exactly what the database has.
 */
function rowsOf(mirror: Mirror): OrgRows {
  const items = Object.values(mirror.items).map((row) => {
    const overrides = row.parent_id_overrides;
    return overrides && typeof overrides === "object" ? { ...row, parent_id_overrides: { ...(overrides as object) } } : { ...row };
  });
  const hyperlinks = Object.values(mirror.hyperlinks)
    .map((link) => ({ ...link }))
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { items, ranks: { backlog: copyRanks(mirror.backlogRanks), board: copyRanks(mirror.boardRanks) }, hyperlinks };
}

/** Forget every kept copy (between tests). */
export async function forgetRowMirrors(): Promise<void> {
  memory.clear();
  inFlight.clear();
  pendingStores.clear();
  if (storeTimer) clearTimeout(storeTimer);
  storeTimer = null;
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

// ─── Kept across visits, in IndexedDB ───────────────────────────────────────

const DB_NAME = "agilefant-row-mirror";
const STORE = "orgs";
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
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

async function readStored(orgId: string): Promise<Mirror | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(orgId);
      request.onsuccess = () => {
        const value = request.result as Mirror | undefined;
        resolve(value && value.version === VERSION && value.orgId === orgId && value.snapshotAt ? value : null);
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

const pendingStores = new Map<string, Mirror>();
let storeTimer: ReturnType<typeof setTimeout> | null = null;

/** Written a moment later, the latest copy only: copying it for storage takes the page a few milliseconds. */
function store(mirror: Mirror): void {
  pendingStores.set(mirror.orgId, mirror);
  if (storeTimer) return;
  storeTimer = setTimeout(() => void writePending(), 2000);
}

async function writePending(): Promise<void> {
  if (storeTimer) clearTimeout(storeTimer);
  storeTimer = null;
  const batch = [...pendingStores.values()];
  pendingStores.clear();
  if (batch.length === 0) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const objects = tx.objectStore(STORE);
      for (const m of batch) objects.put(m, m.orgId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      // Storage full or unavailable: the copy in memory still serves this visit.
      resolve();
    }
  });
}

/** For tests: write what is waiting, and forget the copies in memory as a new visit would. */
export const rowMirrorTesting = {
  writePending,
  forgetMemory: () => memory.clear(),
};
