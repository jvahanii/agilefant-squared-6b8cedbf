/**
 * Saving items and their ranks, and the queues in this browser that keep what
 * has not been saved yet until it is. Taken out of appStore.ts word for word,
 * but for reading the items the app holds, which the store hands in
 * (readHeldWorkItemsFrom) rather than this importing it.
 */
import type { Backlog, BacklogTree, WorkItem } from "@/types/models";
import {
  deleteWorkItems,
  upsertBacklogs,
  upsertBacklogTrees,
  upsertWorkItems,
  upsertWorkItemBacklogRankRowsDetailed,
  upsertWorkItemBoardRankRows,
  upsertWorkItemBoardRankRowsDetailed,
  type WorkItemBacklogRankUpsert,
  type WorkItemBoardRankUpsert,
} from "../supabaseSync";
import { isRecentlyDeletedContainer } from "../deletedContainers";
import { isRecentlyDeletedWorkItem } from "../deletedWorkItems";
import { notifyPersistDebug } from "@/lib/persistDebug";
import { recordRankWrite, recordBoardRankWrite } from "./rankEchoes";

/** The items the app holds now: the store's, once it has registered itself. */
let heldWorkItems: () => Record<string, WorkItem> = () => ({});
export function readHeldWorkItemsFrom(read: () => Record<string, WorkItem>): void {
  heldWorkItems = read;
}

export const PENDING_RANK_UPSERTS_KEY = "pending_work_item_rank_upserts";

export const PENDING_BOARD_RANK_UPSERTS_KEY = "pending_work_item_board_rank_upserts";

export const PENDING_WORK_ITEM_UPSERTS_KEY = "pending_work_item_upserts";

export type PendingWorkItemUpsert = {
  item: WorkItem;
  organizationId: string;
  updatedAt: number;
};

export type ContainerSnapshot = {
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
};

export function readPendingWorkItemUpserts(orgId: string): PendingWorkItemUpsert[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_WORK_ITEM_UPSERTS_KEY) ?? "[]");
    if (!Array.isArray(pending)) return [];
    return pending.filter((entry): entry is PendingWorkItemUpsert =>
      entry?.organizationId === orgId && entry?.item?.id && entry.item.backlogAssignments &&
      !isRecentlyDeletedWorkItem(entry.item.id),
    );
  } catch {
    return [];
  }
}

export function collectReferencedContainers(items: WorkItem[], fallback?: ContainerSnapshot): ContainerSnapshot {
  const backlogs: Record<string, Backlog> = {};
  const backlogTrees: Record<string, BacklogTree> = {};
  if (!fallback) return { backlogs, backlogTrees };

  const addTree = (treeId: string | null | undefined) => {
    if (!treeId || backlogTrees[treeId]) return;
    const tree = fallback.backlogTrees[treeId];
    if (tree && !isRecentlyDeletedContainer(treeId)) backlogTrees[treeId] = tree;
  };

  const addBacklog = (backlogId: string | null | undefined) => {
    if (!backlogId || backlogs[backlogId]) return;
    const backlog = fallback.backlogs[backlogId];
    if (!backlog || isRecentlyDeletedContainer(backlogId)) return;
    if (backlog.parentId) addBacklog(backlog.parentId);
    addTree(backlog.treeId);
    backlogs[backlogId] = backlog;
  };

  for (const item of items) {
    for (const [treeId, backlogId] of Object.entries(item.backlogAssignments ?? {})) {
      addTree(treeId);
      addBacklog(backlogId);
    }
  }

  return { backlogs, backlogTrees };
}

export async function persistReferencedContainersForItems(items: WorkItem[], organizationId: string, fallback?: ContainerSnapshot) {
  const containers = collectReferencedContainers(items, fallback);
  const trees = Object.values(containers.backlogTrees);
  const backlogsToPersist = Object.values(containers.backlogs);
  if (trees.length > 0) await upsertBacklogTrees(trees, organizationId);
  if (backlogsToPersist.length > 0) await upsertBacklogs(backlogsToPersist, organizationId);
}

export function queueWorkItemUpsertsForRetry(items: WorkItem[], organizationId: string) {
  if (typeof localStorage === "undefined" || items.length === 0) return;
  try {
    const existing = JSON.parse(localStorage.getItem(PENDING_WORK_ITEM_UPSERTS_KEY) ?? "[]");
    const deduped = new Map<string, PendingWorkItemUpsert>();
    if (Array.isArray(existing)) {
      existing.forEach((entry) => {
        if (entry?.item?.id && entry?.organizationId) deduped.set(`${entry.organizationId}::${entry.item.id}`, entry);
      });
    }
    const now = Date.now();
    items.forEach((item) => deduped.set(`${organizationId}::${item.id}`, { item, organizationId, updatedAt: now }));
    localStorage.setItem(PENDING_WORK_ITEM_UPSERTS_KEY, JSON.stringify([...deduped.values()]));
  } catch {
    // Best-effort only; DB persistence still runs immediately.
  }
}

export function removeQueuedWorkItemUpserts(items: WorkItem[], organizationId: string) {
  if (typeof localStorage === "undefined" || items.length === 0) return;
  try {
    const existing = JSON.parse(localStorage.getItem(PENDING_WORK_ITEM_UPSERTS_KEY) ?? "[]");
    if (!Array.isArray(existing)) return;
    const saved = new Set(items.map((item) => `${organizationId}::${item.id}`));
    const remaining = existing.filter((entry) => !saved.has(`${entry?.organizationId}::${entry?.item?.id}`));
    if (remaining.length > 0) localStorage.setItem(PENDING_WORK_ITEM_UPSERTS_KEY, JSON.stringify(remaining));
    else localStorage.removeItem(PENDING_WORK_ITEM_UPSERTS_KEY);
  } catch {
    // Keep the queue rather than risking data loss.
  }
}

export function removeQueuedBoardRankUpserts(rows: WorkItemBoardRankUpsert[]) {
  if (typeof localStorage === "undefined" || rows.length === 0) return;
  try {
    const savedRows = new Map(rows.map((row) => [`${row.workItemId}::${row.backlogId}`, row]));
    const existing = JSON.parse(localStorage.getItem(PENDING_BOARD_RANK_UPSERTS_KEY) ?? "[]");
    if (!Array.isArray(existing)) return;
    const remaining = existing.filter((row) => {
      const saved = savedRows.get(`${row.workItemId}::${row.backlogId}`);
      return !saved || saved.rank !== row.rank || saved.organizationId !== row.organizationId;
    });
    if (remaining.length > 0) localStorage.setItem(PENDING_BOARD_RANK_UPSERTS_KEY, JSON.stringify(remaining));
    else localStorage.removeItem(PENDING_BOARD_RANK_UPSERTS_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}

export function persistWorkItemUpserts(items: WorkItem[], organizationId: string, boardRankRows: WorkItemBoardRankUpsert[] = [], fallbackContainers?: ContainerSnapshot) {
  if (items.length === 0) return;
  queueWorkItemUpsertsForRetry(items, organizationId);
  if (boardRankRows.length > 0) queueBoardRankUpsertsForRetry(boardRankRows);
  persistReferencedContainersForItems(items, organizationId, fallbackContainers).then(() => upsertWorkItems(items, organizationId)).then(async (ok) => {
    if (!ok) return;
    notifyPersistDebug('workitem', items.map(i => i.title).join(', '));
    if (boardRankRows.length > 0) {
      const boardOk = await upsertWorkItemBoardRankRows(boardRankRows);
      if (!boardOk) return;
      removeQueuedBoardRankUpserts(boardRankRows);
    }
    removeQueuedWorkItemUpserts(items, organizationId);
  });
}

/**
 * Drop every write still queued in localStorage for these work items. A save
 * that failed, or had not finished, stayed queued after its item was deleted,
 * and the next load flushed it: the item was inserted again and shown again.
 */
export function forgetQueuedWritesFor(workItemIds: string[]) {
  if (typeof localStorage === "undefined" || workItemIds.length === 0) return;
  const gone = new Set(workItemIds);
  for (const key of [PENDING_WORK_ITEM_UPSERTS_KEY, PENDING_RANK_UPSERTS_KEY, PENDING_BOARD_RANK_UPSERTS_KEY]) {
    try {
      const existing = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (!Array.isArray(existing)) continue;
      // Work item entries hold the item; rank entries name it.
      const remaining = existing.filter((entry) => !gone.has(entry?.item?.id ?? entry?.workItemId));
      if (remaining.length === existing.length) continue;
      if (remaining.length > 0) localStorage.setItem(key, JSON.stringify(remaining));
      else localStorage.removeItem(key);
    } catch {
      // Best-effort; the sync layer also skips saves of items just deleted.
    }
  }
}

/** Delete work items the user deleted on purpose, and nothing queued may bring them back. */
export function persistWorkItemDeletes(workItemIds: string[]) {
  if (workItemIds.length === 0) return;
  forgetQueuedWritesFor(workItemIds);
  return deleteWorkItems(workItemIds);
}

export function queueRankUpsertsForRetry(rows: WorkItemBacklogRankUpsert[]) {
  if (typeof localStorage === "undefined" || rows.length === 0) return;
  try {
    const existing = JSON.parse(localStorage.getItem(PENDING_RANK_UPSERTS_KEY) ?? "[]");
    const deduped = new Map<string, WorkItemBacklogRankUpsert>();
    if (Array.isArray(existing)) {
      existing.forEach((row) => {
        if (row?.workItemId && row?.backlogId && row?.organizationId) deduped.set(`${row.workItemId}::${row.backlogId}`, row);
      });
    }
    rows.forEach((row) => deduped.set(`${row.workItemId}::${row.backlogId}`, row));
    localStorage.setItem(PENDING_RANK_UPSERTS_KEY, JSON.stringify([...deduped.values()]));
  } catch {
    // Best-effort only; DB persistence still runs immediately.
  }
}

export function removeQueuedRankUpserts(rows: WorkItemBacklogRankUpsert[]) {
  if (typeof localStorage === "undefined" || rows.length === 0) return;
  try {
    const savedRows = new Map(rows.map((row) => [`${row.workItemId}::${row.backlogId}`, row]));
    const existing = JSON.parse(localStorage.getItem(PENDING_RANK_UPSERTS_KEY) ?? "[]");
    if (!Array.isArray(existing)) return;
    // Only an entry holding the same rank that was saved: a newer rank queued
    // for the same item meanwhile must stay until it is saved itself.
    const remaining = existing.filter((row) => {
      const saved = savedRows.get(`${row.workItemId}::${row.backlogId}`);
      return !saved || saved.rank !== row.rank || saved.organizationId !== row.organizationId;
    });
    if (remaining.length > 0) localStorage.setItem(PENDING_RANK_UPSERTS_KEY, JSON.stringify(remaining));
    else localStorage.removeItem(PENDING_RANK_UPSERTS_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}

/**
 * How long to wait before writing again the ranks of an item the database did
 * not have yet. A rank can be saved in the moment between an item appearing in
 * the app and its insert landing — reordering straight after creating one — and
 * a second or two later the item is there.
 */
export const MISSING_ITEM_RANK_RETRY_MS = 2_500;

/**
 * Of the rows naming work items the database did not have, those whose item the
 * app still holds. Those are most likely still being inserted, so their ranks
 * are worth keeping. An item the app no longer has was deleted, and a rank for it
 * orders nothing.
 */
export function rankRowsAwaitingInsert<T extends { workItemId: string }>(rows: T[], missingWorkItemIds: string[]): T[] {
  if (missingWorkItemIds.length === 0) return [];
  const missing = new Set(missingWorkItemIds);
  const workItems = heldWorkItems();
  return rows.filter((row) => missing.has(row.workItemId) && !!workItems[row.workItemId]);
}

export function persistRankUpserts(rows: WorkItemBacklogRankUpsert[], isRetry = false) {
  if (rows.length === 0) return;
  if (!isRetry) {
    recordRankWrite(rows);
    queueRankUpsertsForRetry(rows);
  }
  upsertWorkItemBacklogRankRowsDetailed(rows).then(({ ok, missingWorkItemIds }) => {
    if (!ok || typeof localStorage === "undefined") return;
    notifyPersistDebug('backlogRank', `${rows.length} row(s)`);
    const awaiting = rankRowsAwaitingInsert(rows, missingWorkItemIds);
    const awaitingKeys = new Set(awaiting.map((row) => `${row.workItemId}::${row.backlogId}`));
    // Saved rows, and rows for deleted items, leave the queue. Before this they
    // stayed, and the queue re-sent a row for a deleted item on every load,
    // failing each time.
    removeQueuedRankUpserts(rows.filter((row) => !awaitingKeys.has(`${row.workItemId}::${row.backlogId}`)));
    if (awaiting.length > 0 && !isRetry) {
      setTimeout(() => {
        // The rank as it is now, not as it was: the item may have moved again
        // meanwhile, and that newer write must not be overwritten by this one.
        const workItems = heldWorkItems();
        const current = awaiting.flatMap((row) => {
          const rank = workItems[row.workItemId]?.ranks[row.backlogId];
          return rank === undefined ? [] : [{ ...row, rank }];
        });
        persistRankUpserts(current, true);
      }, MISSING_ITEM_RANK_RETRY_MS);
    }
  });
}

export function queueBoardRankUpsertsForRetry(rows: WorkItemBoardRankUpsert[]) {
  if (typeof localStorage === "undefined" || rows.length === 0) return;
  try {
    const existing = JSON.parse(localStorage.getItem(PENDING_BOARD_RANK_UPSERTS_KEY) ?? "[]");
    const deduped = new Map<string, WorkItemBoardRankUpsert>();
    if (Array.isArray(existing)) {
      existing.forEach((row) => {
        if (row?.workItemId && row?.backlogId && row?.organizationId) deduped.set(`${row.workItemId}::${row.backlogId}`, row);
      });
    }
    rows.forEach((row) => deduped.set(`${row.workItemId}::${row.backlogId}`, row));
    localStorage.setItem(PENDING_BOARD_RANK_UPSERTS_KEY, JSON.stringify([...deduped.values()]));
  } catch {
    // Best-effort only; DB persistence still runs immediately.
  }
}

export function readPendingBoardRankUpserts(): WorkItemBoardRankUpsert[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_BOARD_RANK_UPSERTS_KEY) ?? "[]");
    if (!Array.isArray(pending)) return [];
    return pending.filter((row): row is WorkItemBoardRankUpsert =>
      !!row?.workItemId && !!row?.backlogId && typeof row?.rank === "number" && !!row?.organizationId,
    );
  } catch {
    return [];
  }
}

export function persistBoardRankUpserts(rows: WorkItemBoardRankUpsert[], isRetry = false) {
  if (rows.length === 0) return;
  if (!isRetry) {
    recordBoardRankWrite(rows);
    queueBoardRankUpsertsForRetry(rows);
  }
  upsertWorkItemBoardRankRowsDetailed(rows).then(({ ok, missingWorkItemIds }) => {
    if (!ok || typeof localStorage === "undefined") return;
    notifyPersistDebug('boardRank', `${rows.length} row(s)`);
    const awaiting = rankRowsAwaitingInsert(rows, missingWorkItemIds);
    const awaitingKeys = new Set(awaiting.map((row) => `${row.workItemId}::${row.backlogId}`));
    removeQueuedBoardRankUpserts(rows.filter((row) => !awaitingKeys.has(`${row.workItemId}::${row.backlogId}`)));
    if (awaiting.length > 0 && !isRetry) {
      setTimeout(() => {
        const workItems = heldWorkItems();
        const current = awaiting.flatMap((row) => {
          const rank = workItems[row.workItemId]?.boardRanks?.[row.backlogId];
          return rank === undefined ? [] : [{ ...row, rank }];
        });
        persistBoardRankUpserts(current, true);
      }, MISSING_ITEM_RANK_RETRY_MS);
    }
  });
}

/**
 * The queued rank rows still worth keeping after a load-time flush: those whose
 * item the database lacks but which is itself still waiting in the work item
 * queue. Nothing else is held locally at load, so any other row naming a missing
 * item in this organization belongs to one that was deleted. Rows for another
 * organization are kept — its queue is not the one that was just flushed.
 */
export function queuedRankRowsToKeep<T extends { workItemId: string; organizationId: string }>(
  pending: T[],
  missingWorkItemIds: string[],
  orgId: string,
): T[] {
  if (missingWorkItemIds.length === 0) return [];
  const missing = new Set(missingWorkItemIds);
  const stillQueued = new Set(readPendingWorkItemUpserts(orgId).map((entry) => entry.item.id));
  return pending.filter(
    (row) => missing.has(row.workItemId) && (row.organizationId !== orgId || stillQueued.has(row.workItemId)),
  );
}

export async function flushPendingRankUpserts(orgId: string) {
  if (typeof localStorage === "undefined") return;
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_RANK_UPSERTS_KEY) ?? "[]");
    if (!Array.isArray(pending) || pending.length === 0) return;
    const { ok, missingWorkItemIds } = await upsertWorkItemBacklogRankRowsDetailed(pending);
    if (!ok) return;
    const keep = queuedRankRowsToKeep(pending, missingWorkItemIds, orgId);
    if (keep.length > 0) localStorage.setItem(PENDING_RANK_UPSERTS_KEY, JSON.stringify(keep));
    else localStorage.removeItem(PENDING_RANK_UPSERTS_KEY);
  } catch {
    localStorage.removeItem(PENDING_RANK_UPSERTS_KEY);
  }
}

export async function flushPendingBoardRankUpserts(orgId: string) {
  if (typeof localStorage === "undefined") return;
  try {
    const pending = readPendingBoardRankUpserts();
    if (pending.length === 0) return;
    const { ok, missingWorkItemIds } = await upsertWorkItemBoardRankRowsDetailed(pending);
    if (!ok) return;
    const keep = queuedRankRowsToKeep(pending, missingWorkItemIds, orgId);
    if (keep.length > 0) localStorage.setItem(PENDING_BOARD_RANK_UPSERTS_KEY, JSON.stringify(keep));
    else localStorage.removeItem(PENDING_BOARD_RANK_UPSERTS_KEY);
  } catch {
    localStorage.removeItem(PENDING_BOARD_RANK_UPSERTS_KEY);
  }
}

export async function flushPendingWorkItemUpserts(orgId: string, fallbackContainers?: ContainerSnapshot) {
  const pending = readPendingWorkItemUpserts(orgId);
  if (pending.length === 0) return;
  const items = pending.map((entry) => entry.item);
  const itemIds = new Set(items.map((item) => item.id));
  const boardRows = readPendingBoardRankUpserts().filter(
    (row) => row.organizationId === orgId && itemIds.has(row.workItemId),
  );
  await persistReferencedContainersForItems(items, orgId, fallbackContainers);
  const ok = await upsertWorkItems(items, orgId);
  if (!ok) return;
  if (boardRows.length > 0) {
    const boardOk = await upsertWorkItemBoardRankRows(boardRows);
    if (!boardOk) return;
    removeQueuedBoardRankUpserts(boardRows);
  }
  removeQueuedWorkItemUpserts(items, orgId);
}
