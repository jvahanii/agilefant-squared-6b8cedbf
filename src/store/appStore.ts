import { toIsoDate, wellFormedDeadline } from "@/lib/deadlineFormat";
import { forgetDeletedContainers } from './deletedContainers';
import { wellFormedPoints } from "@/lib/backlogPoints";
import { create } from "zustand";
import { WorkItem, WorkItemStatus, Backlog, BacklogTree, Hyperlink, getEffectiveParentId } from "@/types/models";
import {
  loadFromSupabase,
  upsertWorkItem,
  upsertWorkItems,
  deleteWorkItemBacklogRanks,
  upsertBacklog,
  updateBacklogRatingsEnabled,
  updateBacklogCreatedDatesEnabled,
  updateBacklogStartEndDatesEnabled,
  updateBacklogPoints,
  updateBacklogViewMode,
  upsertBacklogs,
  deleteBacklogs,
  upsertBacklogTree,
  deleteBacklogTree as deleteBacklogTreeDB,
  upsertBacklogTrees,
  resetOrgData,
  loadHyperlinksForWorkItems,
  upsertHyperlink,
  deleteHyperlink as deleteHyperlinkDB,
  registerWorkItemRenameCallback,
  deleteWorkItemBoardRanks,
  restoreWorkItems,
  type WorkItemBacklogRankUpsert,
  type WorkItemBoardRankUpsert,
} from "./supabaseSync";
import { mockData as staticMockData } from "./mockData";
import {
  readCachedAppData,
  writeCachedAppData,
  patchCachedWorkItems,
  DATA_CACHE_FRESH_MS,
  type CachedAppData,
} from "./appDataCache";
import { insertChangeLogEntry, loadChangeLog, type ChangeLogEntry } from "./changeLog";
import { getEffectiveStatuses } from "./backlogStatusesStore";
import { boardRankFromListPosition } from "@/lib/rankSync";
import { deleteDirectionRef } from "./navigationRefs";
import type { AppState, DataSnapshot } from "./app/types";
import { samePersistedWorkItem } from "./app/samePersistedWorkItem";
import { selectionActions, storedSelection } from "./app/selection";
import { liveUpdateActions } from "./app/liveUpdates";
import { setFromElsewhere } from "./app/rebaseUndo";
import { orderingActions } from "./app/ordering";
import { movingActions } from "./app/moving";
import {
  computeNextWorkItemSelection,
  computeNextBacklogSelection,
  dedupWorkItemRanksInPlace,
  ensureCleanId,
  repairOrphanedSurvivors,
  applyWorkItemIdRenames,
  buildCascadedShiftSet,
  getVisibleBacklogIds,
  assignSequentialRanksForContext,
  type LoadRankRepair,
} from "./app/hierarchy";
import { snapshot, localMutationVersion, bumpMutationVersion, pushUndoEntry, runAsOneUndoStep } from "./app/history";
import {
  readHeldWorkItemsFrom,
  readPendingWorkItemUpserts,
  collectReferencedContainers,
  type ContainerSnapshot,
  type PendingWorkItemUpsert,
  persistWorkItemUpserts,
  persistWorkItemDeletes,
  persistRankUpserts,
  persistBoardRankUpserts,
  flushPendingRankUpserts,
  flushPendingBoardRankUpserts,
  flushPendingWorkItemUpserts,
} from "./app/writeQueue";
export type { LoadRankRepair } from "./app/hierarchy";

function generateMockData() {
  return JSON.parse(JSON.stringify(staticMockData));
}

export type { ChangeLogEntry } from "./changeLog";
export { resetRankEchoSuppression } from "./app/rankEchoes";

/** `rankRepairs`, when given, collects the shared list ranks this resolved —
 *  for a load of fresh data to save (saveLoadRankRepairs). */
export function sanitizeData(data: any, orgId: string, rankRepairs?: LoadRankRepair[]) {
  const cleanWorkItems: Record<string, WorkItem> = {};
  const cleanBacklogs: Record<string, Backlog> = {};
  const cleanTrees: Record<string, BacklogTree> = {};

  Object.values(data.backlogs || {}).forEach((bl: any) => {
    const id = ensureCleanId(bl.id, orgId);
    cleanBacklogs[id] = {
      ...bl,
      id,
      parentId: bl.parentId ? ensureCleanId(bl.parentId, orgId) : null,
      treeId: ensureCleanId(bl.treeId, orgId),
      childrenIds: [],
    };
  });

  Object.values(data.backlogTrees || {}).forEach((tree: any) => {
    const id = ensureCleanId(tree.id, orgId);
    cleanTrees[id] = {
      ...tree,
      id,
      rootBacklogIds: (tree.rootBacklogIds || [])
        .map((bid: string) => ensureCleanId(bid, orgId))
        .filter((bid: string) => !!cleanBacklogs[bid]),
    };
  });

  // Items with no rank row in a list read as rank 0 there; a repair of one
  // would create the row rather than update it.
  const ranklessKeys = new Set<string>();
  Object.values(data.workItems || {}).forEach((wi: any) => {
    const id = ensureCleanId(wi.id, orgId);
    const validAssignments: Record<string, string> = {};
    const validRanks: Record<string, number> = {};
    const validBoardRanks: Record<string, number> = {};

    const totalAssignments = Object.keys(wi.backlogAssignments || {}).length;
    let droppedCount = 0;
    Object.entries(wi.backlogAssignments || {}).forEach(([tId, bId]) => {
      const cleanT = ensureCleanId(tId, orgId);
      const cleanB = ensureCleanId(bId as string, orgId);
      if (cleanTrees[cleanT] && cleanBacklogs[cleanB]) {
        validAssignments[cleanT] = cleanB;
        // Re-key ranks: try original backlogId first, then cleaned
        const loadedRank = (wi.ranks ?? {})[bId as string] ?? (wi.ranks ?? {})[cleanB];
        if (loadedRank === undefined) ranklessKeys.add(`${id}|${cleanB}`);
        validRanks[cleanB] = loadedRank ?? 0;
        const origBoardRank = (wi.boardRanks ?? {})[bId as string] ?? (wi.boardRanks ?? {})[cleanB];
        if (typeof origBoardRank === 'number') validBoardRanks[cleanB] = origBoardRank;
      } else {
        droppedCount++;
        console.warn(
          `sanitizeData: dropped backlog assignment for item ${wi.id} ` +
          `(tree: ${cleanT} exists=${!!cleanTrees[cleanT]}, backlog: ${cleanB} exists=${!!cleanBacklogs[cleanB]}). ` +
          `If this item becomes orphaned after a reload, investigate missing tree/backlog data.`
        );
      }
    });
    if (droppedCount > 0 && totalAssignments === droppedCount) {
      console.error(
        `sanitizeData: ALL ${droppedCount} backlog assignments dropped for item ${wi.id} — ` +
        `item is now orphaned and invisible in all trees. Original assignments: ${JSON.stringify(wi.backlogAssignments)}`
      );
    }

    // Clean per-tree parent overrides
    const cleanParentIds: Record<string, string | null> = {};
    if (wi.parentIds && typeof wi.parentIds === 'object') {
      Object.entries(wi.parentIds as Record<string, string | null>).forEach(([tId, pid]) => {
        const cleanT = ensureCleanId(tId, orgId);
        if (cleanTrees[cleanT]) {
          cleanParentIds[cleanT] = pid ? ensureCleanId(pid, orgId) : null;
        }
      });
    }

    cleanWorkItems[id] = {
      ...wi,
      id,
      parentId: wi.parentId ? ensureCleanId(wi.parentId, orgId) : null,
      parentIds: Object.keys(cleanParentIds).length > 0 ? cleanParentIds : undefined,
      backlogAssignments: validAssignments,
      ranks: validRanks,
      boardRanks: validBoardRanks,
      childrenIds: [],
    };
  });

  Object.values(cleanWorkItems).forEach((wi) => {
    if (wi.parentId && cleanWorkItems[wi.parentId]) {
      const parent = cleanWorkItems[wi.parentId];
      if (!parent.childrenIds.includes(wi.id)) parent.childrenIds.push(wi.id);
    }
    // Populate childrenIds from per-tree parent overrides too
    if (wi.parentIds) {
      for (const treeParentId of Object.values(wi.parentIds)) {
        if (treeParentId && treeParentId !== wi.parentId && cleanWorkItems[treeParentId]) {
          const parent = cleanWorkItems[treeParentId];
          if (!parent.childrenIds.includes(wi.id)) parent.childrenIds.push(wi.id);
        }
      }
    }
  });

  Object.values(cleanBacklogs).forEach((bl) => {
    if (bl.parentId && cleanBacklogs[bl.parentId]) {
      const parent = cleanBacklogs[bl.parentId];
      if (!parent.childrenIds.includes(bl.id)) parent.childrenIds.push(bl.id);
    }
  });

  // Resolve any duplicate ranks that arrived from the DB
  const repairs: LoadRankRepair[] = [];
  dedupWorkItemRanksInPlace(cleanWorkItems, repairs);
  for (const r of repairs) {
    rankRepairs?.push({ ...r, hadRank: !ranklessKeys.has(`${r.workItemId}|${r.backlogId}`) });
  }

  return { workItems: cleanWorkItems, backlogs: cleanBacklogs, backlogTrees: cleanTrees };
}

/** How long edits wait on the refresh of an old copy before they are let through anyway. */
export const CATCH_UP_MAX_MS = 8000;

/**
 * A refresh that comes back while the user is editing is not applied — it
 * would undo what they just did — which leaves the screen on the older data.
 * That was thirty minutes old at most; now that a start can be from a copy
 * days old, it must not be where things stay. So another refresh is asked for
 * a few seconds later, when the edit has been saved and will be in it. A few
 * times at most: someone editing without pause is refreshed when they stop,
 * or on the next wake.
 */
export const REFRESH_AFTER_EDIT_MS = 4000;
const MAX_REFRESHES_AFTER_EDIT = 3;
let refreshesAfterEdit = 0;

function refreshAgainAfterEdit(refresh: () => void) {
  if (refreshesAfterEdit >= MAX_REFRESHES_AFTER_EDIT) return;
  refreshesAfterEdit += 1;
  setTimeout(refresh, REFRESH_AFTER_EDIT_MS);
}

let appDataLoadInFlight: { orgId: string; promise: Promise<void> } | null = null;
let appDataBackgroundRefreshInFlight: { orgId: string; promise: Promise<void> } | null = null;
let lastAppliedCachedSnapshotKey: string | null = null;

/**
 * True while a full dataset load (or its stale-while-revalidate background
 * refresh) is already running.  Used by the realtime catch-up logic to avoid
 * piling a redundant refetch on top of an in-progress load.
 */
export function isAppDataLoadInFlight(): boolean {
  return appDataLoadInFlight !== null || appDataBackgroundRefreshInFlight !== null;
}

/** The parents of each of `ids`, all the way up: opened so the selection can be seen. */
function ancestorsOf(ids: string[], byId: Record<string, { parentId?: string | null }>): Set<string> {
  const ancestors = new Set<string>();
  for (const id of ids) {
    let current = byId[id];
    while (current?.parentId) {
      ancestors.add(current.parentId);
      current = byId[current.parentId];
    }
  }
  return ancestors;
}

/** The links of the items kept; links of items the clean-up dropped go too. */
function linksOfKept(all: Record<string, Hyperlink[]>, workItems: Record<string, WorkItem>): Record<string, Hyperlink[]> {
  const kept = new Set(Object.keys(workItems));
  const links: Record<string, Hyperlink[]> = {};
  for (const [wiId, itemLinks] of Object.entries(all)) {
    if (kept.has(wiId)) links[wiId] = itemLinks;
  }
  return links;
}

/**
 * Bug fix: if sanitizeData dropped ALL backlog assignments for an item that
 * existed in the current store with valid assignments, preserve the current
 * store's copy so the item doesn't disappear. This guards against partial
 * Supabase responses where trees or backlogs referenced by an item happen to
 * be missing from the fetched dataset (e.g. replication lag, pagination gaps).
 */
function keepItemsTheCleanUpEmptied(clean: Record<string, WorkItem>, current: Record<string, WorkItem>): void {
  for (const [id, currentWi] of Object.entries(current)) {
    const cleanWi = clean[id];
    if (!cleanWi) continue;
    if (Object.keys(cleanWi.backlogAssignments).length === 0 &&
        Object.keys(currentWi.backlogAssignments).length > 0) {
      console.warn(
        `loadFromSupabase: preserving item ${id} from current store — ` +
        `sanitizeData dropped all ${Object.keys(currentWi.backlogAssignments).length} assignments. ` +
        `Missing trees/backlogs in Supabase response likely caused this.`
      );
      clean[id] = currentWi;
    }
  }
}

type CachedAppDataSnapshot = NonNullable<Awaited<ReturnType<typeof readCachedAppData>>>;

function sameStringArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function buildCachedSnapshotKey(
  orgId: string,
  timestamp: number,
  data: Pick<CachedAppData, 'workItems' | 'backlogs' | 'backlogTrees'>,
  selectedBacklogIds: string[],
  selectedTreeId: string | null,
  selectedWorkItemIds: string[],
): string {
  return [
    orgId,
    timestamp,
    Object.keys(data.workItems).sort().join(','),
    Object.keys(data.backlogs).sort().join(','),
    Object.keys(data.backlogTrees).sort().join(','),
    selectedBacklogIds.join(','),
    selectedTreeId ?? '',
    selectedWorkItemIds.join(','),
  ].join('|');
}

/**
 * Save the difference between the state on screen and the snapshot that undo
 * or redo is about to show.
 *
 * Undo used to swap the snapshot locally and write nothing. Undoing a delete
 * left the items only in the page, until a later edit saved one again through a
 * plain upsert — the row and its ranks came back, the hyperlinks, team
 * assignments and the rest the delete had cascaded away did not. On 2026-09-16
 * that lost the links of 18 job postings at once.
 *
 * Items that reappear are restored (see restoreWorkItems), items that disappear
 * are deleted, and items that differ are saved. Backlogs, trees and the
 * hyperlinks of items present on both sides follow the same rule.
 */
function persistSnapshotSwitch(from: AppState, to: DataSnapshot) {
  const orgId = from.organizationId;
  if (!orgId) return;

  const treesToSave = Object.values(to.backlogTrees).filter((tree) => {
    const old = from.backlogTrees[tree.id];
    return !old || (old !== tree && (old.name !== tree.name || old.rank !== tree.rank || old.pointsEnabled !== tree.pointsEnabled));
  });
  const backlogsToSave = Object.values(to.backlogs).filter((bl) => {
    const old = from.backlogs[bl.id];
    return !old || (old !== bl && (old.name !== bl.name || old.parentId !== bl.parentId || old.treeId !== bl.treeId || old.rank !== bl.rank));
  });
  if (treesToSave.length > 0 || backlogsToSave.length > 0) {
    // Undo bringing a deleted list or tree back is the one save allowed to.
    forgetDeletedContainers([...treesToSave.map((t) => t.id), ...backlogsToSave.map((b) => b.id)]);
    Promise.resolve(upsertBacklogTrees(treesToSave, orgId))
      .then(() => upsertBacklogs(backlogsToSave, orgId))
      .catch((err) => console.error("Undo: saving backlogs failed", err));
  }
  // A backlog's estimate has its own call, as upsertBacklogs leaves it alone.
  for (const bl of Object.values(to.backlogs)) {
    const old = from.backlogs[bl.id];
    if (old && old.points !== bl.points) {
      Promise.resolve(updateBacklogPoints(bl.id, bl.points ?? null)).catch((err) =>
        console.error("Undo: saving backlog points failed", err),
      );
    }
  }

  const removedItemIds = Object.keys(from.workItems).filter((id) => !to.workItems[id]);
  const restoredItems = Object.values(to.workItems).filter((wi) => !from.workItems[wi.id]);
  const changedItems = Object.values(to.workItems).filter((wi) => {
    const old = from.workItems[wi.id];
    return !!old && old !== wi && !samePersistedWorkItem(old, wi);
  });

  persistWorkItemDeletes(removedItemIds)?.catch((err) => console.error("Undo: deleting work items failed", err));
  if (restoredItems.length > 0) {
    restoreWorkItems(restoredItems, orgId, to.hyperlinks)?.catch((err) => console.error("Undo: restoring work items failed", err));
  }
  if (changedItems.length > 0) {
    const boardRankRows: WorkItemBoardRankUpsert[] = [];
    const staleRanks: Array<{ workItemId: string; backlogId: string }> = [];
    const staleBoardRanks: Array<{ workItemId: string; backlogId: string }> = [];
    for (const wi of changedItems) {
      const old = from.workItems[wi.id];
      for (const [backlogId, rank] of Object.entries(wi.boardRanks ?? {})) {
        if (old.boardRanks?.[backlogId] !== rank) {
          boardRankRows.push({ workItemId: wi.id, backlogId, rank, organizationId: wi.organizationId ?? orgId });
        }
      }
      for (const backlogId of Object.keys(old.ranks)) {
        if (!(backlogId in wi.ranks)) staleRanks.push({ workItemId: wi.id, backlogId });
      }
      for (const backlogId of Object.keys(old.boardRanks ?? {})) {
        if (!(backlogId in (wi.boardRanks ?? {}))) staleBoardRanks.push({ workItemId: wi.id, backlogId });
      }
    }
    upsertWorkItems(changedItems, orgId)?.catch((err) => console.error("Undo: saving work items failed", err));
    if (boardRankRows.length > 0) persistBoardRankUpserts(boardRankRows);
    if (staleRanks.length > 0) deleteWorkItemBacklogRanks(staleRanks);
    if (staleBoardRanks.length > 0) deleteWorkItemBoardRanks(staleBoardRanks);
  }

  // Hyperlinks of items on both sides. A restored item brings its own; a
  // removed one loses them by cascade.
  const onBothSides = (workItemId: string) => !!from.workItems[workItemId] && !!to.workItems[workItemId];
  for (const [workItemId, links] of Object.entries(to.hyperlinks)) {
    const oldLinks = from.hyperlinks[workItemId] ?? [];
    if (links === oldLinks || !onBothSides(workItemId)) continue;
    const oldById = new Map(oldLinks.map((link) => [link.id, link]));
    for (const link of links) {
      if (oldById.get(link.id) !== link) upsertHyperlink(link, orgId, to.workItems[workItemId].organizationId);
    }
  }
  for (const [workItemId, oldLinks] of Object.entries(from.hyperlinks)) {
    const links = to.hyperlinks[workItemId] ?? [];
    if (links === oldLinks || !onBothSides(workItemId)) continue;
    const keep = new Set(links.map((link) => link.id));
    for (const link of oldLinks) if (!keep.has(link.id)) deleteHyperlinkDB(link.id);
  }

  const removedBacklogIds = Object.keys(from.backlogs).filter((id) => !to.backlogs[id]);
  const removedTreeIds = Object.keys(from.backlogTrees).filter((id) => !to.backlogTrees[id]);
  if (removedBacklogIds.length > 0 || removedTreeIds.length > 0) {
    // Backlogs before their trees: a backlog references its tree.
    Promise.resolve(deleteBacklogs(removedBacklogIds))
      .then(() => Promise.all(removedTreeIds.map((id) => deleteBacklogTreeDB(id))))
      .catch((err) => console.error("Undo: deleting backlogs failed", err));
  }
}

/**
 * Save the shared list ranks a load resolved (sanitizeData). They used to stay
 * in memory only — healDuplicateRanks, which saves, runs after the resolving
 * and finds nothing left — so the page and the database disagreed, and a later
 * write of only the ranks it changed could land on a stale value and share it.
 *
 * Only ranks the store still holds are saved (a queued item save merged over
 * the load may have replaced them). A rank row is created only for this
 * organization's items: members of an organization a tree is shared with may
 * update rank rows but not insert them.
 */
function saveLoadRankRepairs(repairs: LoadRankRepair[], workItems: Record<string, WorkItem>, orgId: string) {
  const rows: WorkItemBacklogRankUpsert[] = repairs.flatMap((r) => {
    const wi = workItems[r.workItemId];
    if (!wi || wi.ranks[r.backlogId] !== r.rank) return [];
    const owner = wi.organizationId ?? orgId;
    if (!r.hadRank && owner !== orgId) return [];
    return [{ workItemId: r.workItemId, backlogId: r.backlogId, rank: r.rank, organizationId: owner }];
  });
  if (rows.length > 0) persistRankUpserts(rows);
}

/**
 * Silent auto-heal for duplicate per-backlog ranks. Groups items by
 * (backlogId, effective_per_tree_parent) and densifies each group to
 * consecutive 0..N-1 ranks, ordered by current rank then id as a
 * deterministic tie-break. Returns the updated work items map and the
 * minimal set of rank rows that changed (for DB persistence).
 */
function healDuplicateRanks(
  workItems: Record<string, WorkItem>,
): { workItems: Record<string, WorkItem>; rankRows: Array<{ workItemId: string; backlogId: string; rank: number }> } {
  type Entry = { id: string; blId: string; treeId: string; effParent: string | null; rank: number };
  const groups = new Map<string, Entry[]>();
  Object.values(workItems).forEach((wi) => {
    Object.entries(wi.backlogAssignments).forEach(([treeId, blId]) => {
      const effParent = getEffectiveParentId(wi, treeId);
      const key = `${blId}::${effParent ?? "ROOT"}`;
      const rank = wi.ranks[blId] ?? 0;
      const entry: Entry = { id: wi.id, blId, treeId, effParent, rank };
      const arr = groups.get(key);
      if (arr) arr.push(entry); else groups.set(key, [entry]);
    });
  });

  const changed = new Map<string, WorkItem>();
  const rankRows: Array<{ workItemId: string; backlogId: string; rank: number }> = [];
  groups.forEach((entries) => {
    // Detect duplicates before doing any work.
    const ranks = entries.map((e) => e.rank);
    const uniq = new Set(ranks);
    if (uniq.size === ranks.length) return;
    // Densify deterministically.
    entries.sort((a, b) => (a.rank - b.rank) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    entries.forEach((e, i) => {
      if (e.rank === i) return;
      const base = changed.get(e.id) ?? workItems[e.id];
      const updated = { ...base, ranks: { ...base.ranks, [e.blId]: i } };
      changed.set(e.id, updated);
      rankRows.push({ workItemId: e.id, backlogId: e.blId, rank: i });
    });
  });

  if (changed.size === 0) return { workItems, rankRows: [] };
  const next = { ...workItems };
  changed.forEach((wi, id) => { next[id] = wi; });
  return { workItems: next, rankRows };
}

function mergePendingWorkItems(
  data: ReturnType<typeof sanitizeData>,
  orgId: string,
  pendingAtLoad: PendingWorkItemUpsert[] = [],
  fallbackContainers?: ContainerSnapshot,
): ReturnType<typeof sanitizeData> {
  const pending = [...readPendingWorkItemUpserts(orgId), ...pendingAtLoad]
    .filter((entry) => entry.organizationId === orgId && entry.item?.id)
    .reduce((map, entry) => {
      const existing = map.get(entry.item.id);
      if (!existing || entry.updatedAt >= existing.updatedAt) map.set(entry.item.id, entry);
      return map;
    }, new Map<string, PendingWorkItemUpsert>());
  if (pending.size === 0) return data;

  const workItems = { ...data.workItems };
  const backlogs = { ...data.backlogs };
  const backlogTrees = { ...data.backlogTrees };
  let changed = false;
  const pendingItems = [...pending.values()].map((entry) => entry.item);
  const referencedContainers = collectReferencedContainers(pendingItems, fallbackContainers);
  Object.assign(backlogTrees, referencedContainers.backlogTrees);
  Object.assign(backlogs, referencedContainers.backlogs);
  [...pending.values()]
    .sort((a, b) => a.updatedAt - b.updatedAt)
    .forEach(({ item }) => {
      const validAssignments: Record<string, string> = {};
      for (const [treeId, backlogId] of Object.entries(item.backlogAssignments ?? {})) {
        if (backlogTrees[treeId] && backlogs[backlogId]) validAssignments[treeId] = backlogId;
      }
      if (Object.keys(validAssignments).length === 0) return;
      workItems[item.id] = {
        ...item,
        backlogAssignments: validAssignments,
        childrenIds: [],
      };
      changed = true;
    });

  if (!changed) return data;

  for (const wi of Object.values(workItems)) wi.childrenIds = [];
  for (const wi of Object.values(workItems)) {
    if (wi.parentId && workItems[wi.parentId]) {
      workItems[wi.parentId].childrenIds.push(wi.id);
    }
    if (wi.parentIds) {
      for (const treeParentId of Object.values(wi.parentIds)) {
        if (treeParentId && treeParentId !== wi.parentId && workItems[treeParentId]) {
          if (!workItems[treeParentId].childrenIds.includes(wi.id)) workItems[treeParentId].childrenIds.push(wi.id);
        }
      }
    }
  }

  return { ...data, workItems, backlogs, backlogTrees };
}

export const useAppStore = create<AppState>()((set, get) => {
  // The write queue's retries look up the items as they are now.
  readHeldWorkItemsFrom(() => get().workItems);

  // Register a callback so supabaseSync can notify us when work-item IDs are
  // renamed (stale org prefix repaired).  This keeps local state consistent
  // without requiring each individual store action to be made async.
  registerWorkItemRenameCallback((oldToNew) => {
    set(state => applyWorkItemIdRenames(state, oldToNew));
  });

  const internalLog = (entry: Omit<ChangeLogEntry, "timestamp" | "id" | "userEmail">) => {
    const state = get();
    const orgId = state.organizationId;
    const userId = state.userId;
    const userEmail = state.userEmail ?? '';
    const fullEntry: ChangeLogEntry = { ...entry, timestamp: new Date().toISOString(), userEmail };
    set((s) => ({
      changeLog: [fullEntry, ...s.changeLog].slice(0, 5000),
    }));
    // Fire-and-forget persist to DB
    if (orgId && userId) {
      insertChangeLogEntry(orgId, userId, userEmail, entry).catch(() => {});
    }
  };

  /**
   * Restore from the cached snapshot so repeat visits show the previous state
   * without any loading spinner. Fresh data from Supabase replaces it
   * afterwards (refreshInBackground).
   */
  const showCachedCopy = (orgId: string, cached: CachedAppDataSnapshot) => {
    const cachedDataWithPending = mergePendingWorkItems({
      workItems: cached.workItems,
      backlogs: cached.backlogs,
      backlogTrees: cached.backlogTrees,
    }, orgId, [], { backlogs: cached.backlogs, backlogTrees: cached.backlogTrees });
    const selection = storedSelection(orgId, cachedDataWithPending);
    const cachedSnapshotKey = buildCachedSnapshotKey(
      orgId,
      cached.timestamp,
      cachedDataWithPending,
      selection.backlogIds,
      selection.treeId,
      selection.workItemIds,
    );
    const currentState = get();
    // The cache exists to fill an empty screen on a cold start. Applying it
    // over data already on screen is what made a wake-up resync repaint the
    // hierarchy as it stood before the last edits — the cache is only
    // written after a fetch, so it lags every edit made since — and then
    // put it back a moment later when the fetch below returned. Worse, this
    // apply clears the undo and redo stacks and collapses every branch, so
    // a wake threw those away for good.
    const hasLiveData =
      currentState.organizationId === orgId &&
      Object.keys(currentState.workItems).length > 0 &&
      !currentState.isLoading;
    const canSkipCachedApply =
      hasLiveData ||
      (lastAppliedCachedSnapshotKey === cachedSnapshotKey &&
        currentState.organizationId === orgId &&
        Object.keys(currentState.backlogTrees).length > 0 &&
        !currentState.isLoading);
    if (canSkipCachedApply) return;
    // Old enough that it is only for looking at until the refresh lands.
    const cachedIsOld = Date.now() - cached.timestamp > DATA_CACHE_FRESH_MS;
    lastAppliedCachedSnapshotKey = cachedSnapshotKey;
    set((state) => {
      const selectionUnchanged =
        sameStringArray(state.selectedBacklogIds, selection.backlogIds) &&
        state.selectedTreeId === selection.treeId &&
        sameStringArray(state.selectedWorkItemIds, selection.workItemIds);
      if (
        state.workItems === cachedDataWithPending.workItems &&
        state.backlogs === cachedDataWithPending.backlogs &&
        state.backlogTrees === cachedDataWithPending.backlogTrees &&
        state.hyperlinks === cached.hyperlinks &&
        state.changeLog === cached.changeLog &&
        selectionUnchanged &&
        !state.isLoading &&
        state.loadingProgress === 100
      ) {
        return state;
      }
      return {
        workItems: cachedDataWithPending.workItems,
        backlogs: cachedDataWithPending.backlogs,
        backlogTrees: cachedDataWithPending.backlogTrees,
        hyperlinks: cached.hyperlinks,
        changeLog: cached.changeLog,
        selectedBacklogIds: selection.backlogIds,
        selectedTreeId: selection.treeId,
        selectedWorkItemIds: selection.workItemIds,
        isLoading: false,
        loadingProgress: 100,
        undoStack: [],
        redoStack: [],
        expandedWorkItems: new Set<string>(),
        expandedBacklogs: new Set<string>(),
        catchingUp: cachedIsOld,
      };
    });
    if (cachedIsOld) {
      // Not for ever: offline, or on a connection that never answers,
      // the copy is all there is, and it has to be usable.
      setTimeout(() => {
        if (get().catchingUp) set({ catchingUp: false });
      }, CATCH_UP_MAX_MS);
    }
  };

  /**
   * The change log, fetched once the data has landed rather than with it. Only
   * the history export reads it, and a load that fetched it alongside waited
   * for it too — the slowest of its requests, seconds on a cold database —
   * before the page could be edited. Entries logged here meanwhile, not yet
   * among those fetched, stay on top.
   */
  const loadChangeLogAfterData = (orgId: string) => {
    loadChangeLog(orgId)
      .then((fetched) => {
        if (get().organizationId !== orgId) return;
        const newest = fetched.length > 0 ? Date.parse(fetched[0].timestamp) : -Infinity;
        set((s) => ({
          changeLog: [...s.changeLog.filter((e) => !e.id && Date.parse(e.timestamp) > newest), ...fetched].slice(0, 5000),
        }));
      })
      .catch(() => {});
  };

  /**
   * Behind the cached copy: send what is queued, fetch everything, and put it
   * in the store and the cache — unless the reader edited meanwhile, when only
   * the cache is written and another refresh follows. One at a time per
   * organisation.
   */
  const refreshInBackground = (orgId: string) => {
    if (appDataBackgroundRefreshInFlight?.orgId === orgId) return;
    set({ workItemsRefreshing: true });
    const backgroundPromise = (async () => {
      try {
        // Snapshot the mutation version before fetching so we can
        // detect whether the user made any edits while the network
        // round-trip was in-flight. If they did, we skip overwriting
        // state to avoid losing their changes.
        const versionBeforeFetch = localMutationVersion;
        const pendingAtLoad = readPendingWorkItemUpserts(orgId);
        await flushPendingWorkItemUpserts(orgId, { backlogs: get().backlogs, backlogTrees: get().backlogTrees }).catch(() => {});
        await flushPendingRankUpserts(orgId).catch(() => {});
        await flushPendingBoardRankUpserts(orgId).catch(() => {});
        const [rawData, allHyperlinks] = await Promise.all([
          loadFromSupabase(orgId),
          loadHyperlinksForWorkItems([], orgId).catch(() => ({} as Record<string, Hyperlink[]>)),
        ]);
        const cacheIt = (data: { workItems: Record<string, WorkItem>; backlogs: Record<string, Backlog>; backlogTrees: Record<string, BacklogTree> }, hyperlinks: Record<string, Hyperlink[]>) =>
          writeCachedAppData(orgId, {
            workItems: data.workItems,
            backlogs: data.backlogs,
            backlogTrees: data.backlogTrees,
            hyperlinks,
            changeLog: get().changeLog,
            selectedBacklogIds: get().selectedBacklogIds,
            selectedTreeId: get().selectedTreeId,
            selectedWorkItemIds: get().selectedWorkItemIds,
          });
        // If the user made any edits while we were fetching, skip the state
        // update so their changes aren't overwritten. The fresh data is still
        // written to the cache so the next page load benefits from it.
        if (localMutationVersion !== versionBeforeFetch) {
          const cleanDataBg = mergePendingWorkItems(sanitizeData(rawData, orgId), orgId, pendingAtLoad, { backlogs: get().backlogs, backlogTrees: get().backlogTrees });
          cacheIt(cleanDataBg, (allHyperlinks as Record<string, Hyperlink[]>) ?? {});
          refreshAgainAfterEdit(() => void get().loadFromSupabase());
          return;
        }
        refreshesAfterEdit = 0;
        const rankRepairs: LoadRankRepair[] = [];
        const cleanData = mergePendingWorkItems(sanitizeData(rawData, orgId, rankRepairs), orgId, pendingAtLoad, { backlogs: get().backlogs, backlogTrees: get().backlogTrees });
        keepItemsTheCleanUpEmptied(cleanData.workItems, get().workItems);
        const hyperlinks = linksOfKept(allHyperlinks, cleanData.workItems);
        cacheIt(cleanData, hyperlinks);
        // Only replace state if the user hasn't switched orgs while the
        // background refresh was in flight.
        if (get().organizationId === orgId) {
          // Into the undo copies too: an undo after a wake-up must not take
          // back what others did while the page slept.
          setFromElsewhere(set, get, {
            workItems: cleanData.workItems,
            backlogs: cleanData.backlogs,
            backlogTrees: cleanData.backlogTrees,
            hyperlinks,
            // Preserve current selection.
            selectedBacklogIds: get().selectedBacklogIds,
            selectedTreeId: get().selectedTreeId,
            selectedWorkItemIds: get().selectedWorkItemIds,
          });
          saveLoadRankRepairs(rankRepairs, cleanData.workItems, orgId);
          loadChangeLogAfterData(orgId);
        }
      } catch {
        // Background refresh failed — cached data is still shown.
      }
    })().finally(() => {
      if (appDataBackgroundRefreshInFlight?.promise === backgroundPromise) {
        appDataBackgroundRefreshInFlight = null;
      }
      if (get().workItemsRefreshing || get().catchingUp) set({ workItemsRefreshing: false, catchingUp: false });
    });
    appDataBackgroundRefreshInFlight = { orgId, promise: backgroundPromise };
    void backgroundPromise;
  };

  /**
   * With nothing cached: load with the progress bar showing. The lists are
   * painted as soon as they arrive, the items after them; queued saves are
   * sent alongside. Gives up the spinner after fifteen seconds, with -1 as
   * the progress for App.tsx to retry on.
   */
  const loadFresh = async (orgId: string) => {
    set((state) => state.isLoading && state.loadingProgress === 0 ? state : { isLoading: true, loadingProgress: 0 });

    // Safety timeout: if data loading takes longer than 15 seconds (e.g. due
    // to a hung network request), don't leave the UI stuck in a loading
    // spinner. Instead, flip isLoading to false BUT set loadingProgress to -1
    // as a sentinel so App.tsx can detect the failed load and retry. Covers
    // both phases: the shell may already have painted while the work items
    // are still in flight, so a hang after the early paint must also raise
    // the -1 sentinel for App.tsx's retry to pick up.
    const timeoutId = setTimeout(() => {
      if (get().organizationId === orgId && (get().isLoading || get().workItemsLoading)) {
        set({ isLoading: false, workItemsLoading: false, loadingProgress: -1 });
      }
    }, 15000);

    try {
      if (get().organizationId !== orgId) return;
      set({ loadingProgress: 5 });

      const pendingAtLoad = readPendingWorkItemUpserts(orgId);
      // Queued saves go out alongside the load rather than before it, so a
      // slow or failing one does not hold the list back. Items first, then
      // their ranks: side by side, a queued rank for a queued new item could
      // reach the database before the item did and be refused — the same
      // failure that kept "Failed to save ranking" coming back on load.
      const rankFlushPromise = flushPendingWorkItemUpserts(orgId, { backlogs: get().backlogs, backlogTrees: get().backlogTrees })
        .catch(() => {})
        .then(() =>
          Promise.all([
            flushPendingRankUpserts(orgId).catch(() => {}),
            flushPendingBoardRankUpserts(orgId).catch(() => {}),
          ]),
        )
        .catch(() => {});

      // The data and the links (fetched by organization, so they need not
      // wait for the item ids) side by side, each moving the progress bar as
      // it finishes. The change log is loaded when the history is opened.
      const [rawData, allHyperlinks] = await Promise.all([
        loadFromSupabase(orgId, (structure) => {
          // Paint the shell from trees + backlogs while the work items are
          // still downloading. sanitizeData runs here too, so this structure
          // is identical to the one the final commit installs below and
          // nothing the user sees now shifts when the items land.
          if (get().organizationId !== orgId) return;
          const structureOnly = sanitizeData({ ...structure, workItems: {} }, orgId);
          const selection = storedSelection(orgId, structureOnly);
          set({
            backlogs: structureOnly.backlogs,
            backlogTrees: structureOnly.backlogTrees,
            selectedBacklogIds: selection.backlogIds,
            selectedTreeId: selection.treeId,
            expandedBacklogs: ancestorsOf(selection.backlogIds, structureOnly.backlogs),
            isLoading: false,
            workItemsLoading: true,
            loadingProgress: 40,
          });
        }).then((r) => {
          if (get().organizationId === orgId) set({ loadingProgress: 50 });
          return r;
        }),
        loadHyperlinksForWorkItems([], orgId)
          .catch(() => ({} as Record<string, Hyperlink[]>))
          .then((r) => {
            if (get().organizationId === orgId) set((s) => ({ loadingProgress: Math.max(s.loadingProgress, 70) }));
            return r;
          }),
      ]);
      if (get().organizationId !== orgId) return;
      rankFlushPromise.catch(() => {});
      const rankRepairs: LoadRankRepair[] = [];
      const cleanData = mergePendingWorkItems(sanitizeData(rawData, orgId, rankRepairs), orgId, pendingAtLoad, { backlogs: get().backlogs, backlogTrees: get().backlogTrees });
      set({ loadingProgress: 80 });

      const hyperlinks = linksOfKept(allHyperlinks, cleanData.workItems);
      set({ loadingProgress: 90 });

      // The selection this browser saved, and everything above it opened so
      // that it can be seen.
      const selection = storedSelection(orgId, cleanData);
      const expandedBacklogs = ancestorsOf(selection.backlogIds, cleanData.backlogs);
      const expandedWorkItems = ancestorsOf(selection.workItemIds, cleanData.workItems);

      clearTimeout(timeoutId);

      // Silent duplicate-rank auto-heal: densify any sibling groups whose
      // per-backlog ranks collide (grouped by tree, backlog, and effective
      // per-tree parent). Fixes are applied to local state AND persisted to
      // the DB so the next reload starts clean.
      const healed = healDuplicateRanks(cleanData.workItems);
      const finalWorkItems = healed.workItems;
      if (healed.rankRows.length > 0) {
        const rowsWithOrg: WorkItemBacklogRankUpsert[] = healed.rankRows.map((r) => ({
          ...r,
          organizationId: finalWorkItems[r.workItemId]?.organizationId ?? orgId,
        }));
        persistRankUpserts(rowsWithOrg);
      }
      // What sanitizeData resolved before the heal above could see it. A rank
      // the heal changed again is no longer the repaired one, and is skipped.
      saveLoadRankRepairs(rankRepairs, finalWorkItems, orgId);

      writeCachedAppData(orgId, {
        workItems: finalWorkItems,
        backlogs: cleanData.backlogs,
        backlogTrees: cleanData.backlogTrees,
        hyperlinks,
        changeLog: [],
        selectedBacklogIds: selection.backlogIds,
        selectedTreeId: selection.treeId,
        selectedWorkItemIds: selection.workItemIds,
      });

      set({
        ...cleanData,
        workItems: finalWorkItems,
        hyperlinks,
        // Fetched once this has landed (loadChangeLogAfterData below).
        changeLog: [],
        isLoading: false,
        workItemsLoading: false,
        loadingProgress: 100,
        undoStack: [],
        redoStack: [],
        selectedBacklogIds: selection.backlogIds,
        selectedTreeId: selection.treeId,
        selectedWorkItemIds: selection.workItemIds,
        expandedBacklogs,
        expandedWorkItems,
      });
      loadChangeLogAfterData(orgId);
    } catch {
      clearTimeout(timeoutId);
      if (get().organizationId === orgId) set({ isLoading: false, workItemsLoading: false, loadingProgress: 0 });
    }
  };

  return {
    workItems: {},
    backlogs: {},
    backlogTrees: {},
    hyperlinks: {},
    selectedBacklogIds: [],
    selectedTreeId: null,
    selectedWorkItemIds: [],
    changeLog: [],
    expandedWorkItems: new Set(),
    expandedBacklogs: new Set(),
    undoStack: [],
    redoStack: [],
    isLoading: true,
    workItemsLoading: false,
    workItemsRefreshing: false,
    catchingUp: false,
    loadingProgress: 0,
    organizationId: null,
    userId: null,
    userEmail: null,
    searchQuery: "",

    setOrganizationId: (orgId) => set((state) => state.organizationId === orgId ? state : { organizationId: orgId }),
    setUser: (userId, userEmail) => set((state) =>
      state.userId === userId && state.userEmail === userEmail ? state : { userId, userEmail },
    ),
    setSearchQuery: (q) => set((state) => state.searchQuery === q ? state : { searchQuery: q }),
    logChange: (entry) => internalLog(entry),
    clearChangeLog: () => set({ changeLog: [] }),

    loadFromSupabase: async () => {
      const orgId = get().organizationId;
      if (!orgId) {
        set((state) => state.isLoading ? { isLoading: false } : state);
        return;
      }

      if (appDataLoadInFlight?.orgId === orgId) {
        return appDataLoadInFlight.promise;
      }

      // A copy cached in this browser is shown at once, and refreshed behind
      // it; with none, the load shows its progress (showCachedCopy,
      // refreshInBackground, loadFresh above).
      const runLoad = async () => {
        const cached = await readCachedAppData(orgId);
        if (cached && Object.keys(cached.workItems).length > 0) {
          showCachedCopy(orgId, cached);
          refreshInBackground(orgId);
          return;
        }
        await loadFresh(orgId);
      };

      const promise = Promise.resolve().then(runLoad).finally(() => {
        if (appDataLoadInFlight?.promise === promise) {
          appDataLoadInFlight = null;
        }
      });
      appDataLoadInFlight = { orgId, promise };
      return promise;
    },

    ...selectionActions(set, get),

    ...orderingActions(set, get, internalLog),

    ...movingActions(set, get, internalLog),

    addWorkItem: (title, parentId, backlogId, treeId, requestedRank, initialStatus, requestedBoardRank) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;

      const updatedWorkItems = { ...state.workItems };
      const visibleBacklogIds = getVisibleBacklogIds(state.backlogs, backlogId);
      const siblingIds = Object.values(updatedWorkItems)
        .filter((wi) => getEffectiveParentId(wi, treeId) === parentId && visibleBacklogIds.has(wi.backlogAssignments[treeId]))
        .sort((a, b) => {
          const rankDiff = (a.ranks[a.backlogAssignments[treeId]] ?? 0) - (b.ranks[b.backlogAssignments[treeId]] ?? 0);
          return rankDiff !== 0 ? rankDiff : a.id.localeCompare(b.id);
        })
        .map((wi) => wi.id);

      const requestedIndex = requestedRank != null
        ? siblingIds.findIndex((sid) => {
          const sibling = updatedWorkItems[sid];
          const siblingBacklogId = sibling.backlogAssignments[treeId];
          return (sibling.ranks[siblingBacklogId] ?? 0) >= requestedRank;
        })
        : -1;
      const insertIndex = requestedRank != null
        ? (requestedIndex === -1 ? siblingIds.length : requestedIndex)
        : 0;

      const targetStatus = initialStatus ?? ("not_started" as WorkItemStatus);

      const id = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);

      // Compute an effective board rank.  When the caller provides one
      // (board-view adds), use it directly.  Otherwise derive one from the
      // list insertion point so same-status siblings keep the same relative
      // order in both views.
      let effectiveBoardRank: number;
      if (typeof requestedBoardRank === 'number') {
        effectiveBoardRank = requestedBoardRank;
      } else {
        // Walk outward from the list insertion point to find the nearest
        // same-status siblings and interpolate their board ranks.
        const siblingItems = siblingIds
          .map((id) => updatedWorkItems[id])
          .filter((wi) => wi != null);
        let prevBoard: number | null = null;
        let nextBoard: number | null = null;
        // Look backward from insertIndex
        for (let i = insertIndex - 1; i >= 0; i--) {
          const wi = siblingItems[i];
          if (!wi || wi.status !== targetStatus) continue;
          prevBoard = wi.boardRanks?.[backlogId] ?? wi.ranks?.[backlogId] ?? undefined;
          if (typeof prevBoard === 'number') break;
        }
        // Look forward from insertIndex
        for (let i = insertIndex; i < siblingItems.length; i++) {
          const wi = siblingItems[i];
          if (!wi || wi.status !== targetStatus) continue;
          nextBoard = wi.boardRanks?.[backlogId] ?? wi.ranks?.[backlogId] ?? undefined;
          if (typeof nextBoard === 'number') break;
        }
        if (typeof prevBoard === 'number' && typeof nextBoard === 'number') {
          effectiveBoardRank = prevBoard + (nextBoard - prevBoard) / 2;
        } else if (typeof prevBoard === 'number') {
          effectiveBoardRank = prevBoard + 1;
        } else if (typeof nextBoard === 'number') {
          effectiveBoardRank = nextBoard - 1;
        } else {
          effectiveBoardRank = 0;
        }
      }

      const newItem: WorkItem = {
        id,
        title,
        parentId,
        ranks: { [backlogId]: insertIndex },
        boardRanks: { [backlogId]: effectiveBoardRank },
        backlogAssignments: { [treeId]: backlogId },
        status: targetStatus,
        childrenIds: [],
        points: undefined,
        organizationId: orgId,
        // Today on the user's own calendar, not the server's.
        createdOn: toIsoDate(new Date()),
      };

      updatedWorkItems[id] = newItem;
      const orderedIds = [...siblingIds];
      orderedIds.splice(insertIndex, 0, id);
      const itemsToUpdateInDB = assignSequentialRanksForContext(updatedWorkItems, parentId, treeId, visibleBacklogIds, orderedIds);
      if (!itemsToUpdateInDB.some((wi) => wi.id === id)) itemsToUpdateInDB.push(updatedWorkItems[id]);
      const newItemBoardRankRows = [{ workItemId: id, backlogId, rank: effectiveBoardRank, organizationId: orgId }];
      persistWorkItemUpserts(itemsToUpdateInDB, orgId, newItemBoardRankRows, { backlogs: state.backlogs, backlogTrees: state.backlogTrees });

      if (parentId && updatedWorkItems[parentId]) {
        updatedWorkItems[parentId] = {
          ...updatedWorkItems[parentId],
          childrenIds: [id, ...updatedWorkItems[parentId].childrenIds],
        };
      }

      const newExpanded = new Set(state.expandedWorkItems);
      if (parentId) newExpanded.add(parentId);

      set({
        workItems: updatedWorkItems,
        selectedWorkItemIds: [id],
        expandedWorkItems: newExpanded,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
      patchCachedWorkItems(orgId, {
        ...Object.fromEntries(itemsToUpdateInDB.map((wi) => [wi.id, updatedWorkItems[wi.id] ?? wi])),
        ...(parentId && updatedWorkItems[parentId] ? { [parentId]: updatedWorkItems[parentId] } : {}),
      }, [id]);

      const backlogName = state.backlogs[ensureCleanId(backlogId, orgId)]?.name ?? backlogId;
      internalLog({ action: "Add", entityType: "work_item", entityId: id, entityName: title, details: `list: "${backlogName}", parent: ${parentId ? `"${state.workItems[parentId]?.title ?? parentId}"` : "none"}` });
    },

    bulkAddWorkItems: (titles, parentId, backlogId, treeId) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || titles.length === 0) return;

      // Collect all backlog IDs in the subtree rooted at backlogId so that pasted
      // items are placed after every item currently visible in the combined panel
      // (which shows items from the selected backlog AND all its descendants).
      // Without this, items pasted into a parent backlog could share ranks with
      // items in child backlogs, causing them to be interleaved instead of appended.
      const allBacklogIds = new Set<string>();
      const collectDescendants = (id: string) => {
        allBacklogIds.add(id);
        state.backlogs[id]?.childrenIds.forEach(collectDescendants);
      };
      collectDescendants(backlogId);

      const updatedWorkItems = { ...state.workItems };
      let maxRank = -1;
      Object.values(updatedWorkItems).forEach((wi) => {
        if (getEffectiveParentId(wi, treeId) === parentId && allBacklogIds.has(wi.backlogAssignments[treeId])) {
          const wiRank = wi.ranks[wi.backlogAssignments[treeId]] ?? 0;
          if (wiRank > maxRank) maxRank = wiRank;
        }
      });

      const newItems: WorkItem[] = [];
      titles.forEach((title, i) => {
        const id = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
        const newItem: WorkItem = {
          id,
          title,
          parentId,
          ranks: { [backlogId]: maxRank + 1 + i },
          boardRanks: { [backlogId]: maxRank + 1 + i },
          backlogAssignments: { [treeId]: backlogId },
          status: "not_started" as WorkItemStatus,
          childrenIds: [],
          points: undefined,
          organizationId: orgId,
          createdOn: toIsoDate(new Date()),
        };
        updatedWorkItems[id] = newItem;
        newItems.push(newItem);

        if (parentId && updatedWorkItems[parentId]) {
          updatedWorkItems[parentId] = {
            ...updatedWorkItems[parentId],
            childrenIds: [...updatedWorkItems[parentId].childrenIds, id],
          };
        }
      });

      const newItemBoardRankRows = newItems.map((item) => ({
        workItemId: item.id,
        backlogId,
        rank: item.boardRanks?.[backlogId] ?? item.ranks[backlogId] ?? 0,
        organizationId: orgId,
      }));
      persistWorkItemUpserts(newItems, orgId, newItemBoardRankRows, { backlogs: state.backlogs, backlogTrees: state.backlogTrees });
      internalLog({ action: "Bulk Add", entityType: "work_item", details: `${titles.length} items added` });

      set({
        workItems: updatedWorkItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
      patchCachedWorkItems(orgId, {
        ...Object.fromEntries(newItems.map((wi) => [wi.id, updatedWorkItems[wi.id] ?? wi])),
        ...(parentId && updatedWorkItems[parentId] ? { [parentId]: updatedWorkItems[parentId] } : {}),
      });
    },

    deleteWorkItem: (workItemId: string, direction?: 'up' | 'down') => {
      const state = get();
      const orgId = state.organizationId;
      const item = state.workItems[workItemId];
      if (!item) return;

      const idsToDelete: string[] = [];
      const collectIds = (id: string) => {
        idsToDelete.push(id);
        state.workItems[id]?.childrenIds.forEach(collectIds);
      };
      collectIds(workItemId);

      const updatedItems = { ...state.workItems };
      idsToDelete.forEach((id) => delete updatedItems[id]);

      // Clean up all deleted items from their parents' childrenIds
      const deleteSet = new Set(idsToDelete);
      idsToDelete.forEach((deletedId) => {
        const deletedItem = state.workItems[deletedId];
        if (deletedItem?.parentId && updatedItems[deletedItem.parentId]) {
          updatedItems[deletedItem.parentId] = {
            ...updatedItems[deletedItem.parentId],
            childrenIds: updatedItems[deletedItem.parentId].childrenIds.filter((id) => id !== deletedId),
          };
        }
      });

      // Reparent orphaned survivors: items whose parentId points to a deleted
      // item but were not themselves collected for deletion (e.g. they were not
      // in the deleted item's childrenIds due to a data inconsistency such as
      // the one that can arise after respawn).  Without this repair they would
      // appear as unexpected root items in other trees.
      const orphanRepairs: WorkItem[] = [];
      repairOrphanedSurvivors(updatedItems, deleteSet, state.workItems, (updated) => {
        orphanRepairs.push(updated);
      });
      if (orphanRepairs.length > 0 && orgId) {
        upsertWorkItems(orphanRepairs, orgId);
      }

      persistWorkItemDeletes(idsToDelete)?.catch((err) => console.error("Delete work item failed", err));
      internalLog({ action: "Delete", entityType: "work_item", entityId: workItemId, entityName: item.title });
      const newSelectedId = computeNextWorkItemSelection(deleteSet, direction ?? deleteDirectionRef.current);
      set({
        workItems: updatedItems,
        selectedWorkItemIds: newSelectedId ? [newSelectedId] : [],
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    deleteWorkItemsBulk: (workItemIds: string[], direction?: 'up' | 'down') => {
      const state = get();
      const orgId = state.organizationId;
      if (workItemIds.length === 0) return;

      const updatedItems = { ...state.workItems };
      const allIdsToDelete: string[] = [];

      // Deduplicate: if workItemIds contains both a parent and its descendant,
      // skip the descendant when it's reached as a root (it will be collected
      // recursively when the ancestor is processed).
      const processed = new Set<string>();
      const collectIds = (id: string) => {
        if (processed.has(id) || !updatedItems[id]) return;
        processed.add(id);
        allIdsToDelete.push(id);
        state.workItems[id]?.childrenIds.forEach(collectIds);
      };
      workItemIds.forEach(collectIds);

      allIdsToDelete.forEach((id) => delete updatedItems[id]);

      const deleteSet = new Set(allIdsToDelete);
      allIdsToDelete.forEach((deletedId) => {
        const deletedItem = state.workItems[deletedId];
        if (deletedItem?.parentId && updatedItems[deletedItem.parentId]) {
          updatedItems[deletedItem.parentId] = {
            ...updatedItems[deletedItem.parentId],
            childrenIds: updatedItems[deletedItem.parentId].childrenIds.filter((id) => !deleteSet.has(id)),
          };
        }
      });

      const orphanRepairs: WorkItem[] = [];
      repairOrphanedSurvivors(updatedItems, deleteSet, state.workItems, (updated) => {
        orphanRepairs.push(updated);
      });
      if (orphanRepairs.length > 0 && orgId) {
        upsertWorkItems(orphanRepairs, orgId);
      }

      persistWorkItemDeletes(allIdsToDelete)?.catch((err) => console.error("Bulk delete work items failed", err));
      internalLog({ action: "Delete", entityType: "work_item", entityId: workItemIds[0], entityName: `${workItemIds.length} items` });
      const newSelectedId = computeNextWorkItemSelection(deleteSet, direction ?? deleteDirectionRef.current);
      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        selectedWorkItemIds: newSelectedId ? [newSelectedId] : [],
        redoStack: [],
      });
    },

    renameWorkItem: (workItemId, title) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updated = { ...item, title };
      upsertWorkItem(updated, orgId);
      internalLog({ action: "Rename", entityType: "work_item", entityId: workItemId, entityName: title, details: `"${item.title}" → "${title}"` });
      set({
        workItems: { ...state.workItems, [workItemId]: updated },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    setWorkItemDescription: (workItemId, description) => {
      const state = get();
      const item = state.workItems[workItemId];
      const orgId = item?.organizationId ?? state.organizationId;
      if (!item || !orgId) return;
      const value = description.trim() ? description : undefined;
      if (item.description === value) return;
      const updated = { ...item, description: value };
      upsertWorkItem(updated, orgId);
      internalLog({ action: "Description Change", entityType: "work_item", entityId: workItemId, entityName: item.title });
      set({
        workItems: { ...state.workItems, [workItemId]: updated },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    setWorkItemStatus: (workItemId, status) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updatedWorkItems = { ...state.workItems, [workItemId]: { ...item, status } };

      // The item joins a new board column — place it there according to its
      // list position relative to the same-context cards already in that
      // column, so list and board stay consistent for same-status siblings.
      if (item.status !== status && item.childrenIds.length === 0) {
        const boardRankRows: WorkItemBoardRankUpsert[] = [];
        const nextBoardRanks: Record<string, number> = { ...(item.boardRanks ?? {}) };
        for (const [treeId, blId] of Object.entries(item.backlogAssignments)) {
          const myListRank = item.ranks[blId];
          if (typeof myListRank !== "number") continue;
          const myParent = getEffectiveParentId(item, treeId);
          const columnCards = Object.values(state.workItems)
            .filter((wi) => wi.id !== workItemId && wi.status === status && wi.childrenIds.length === 0 && wi.backlogAssignments[treeId] === blId)
            .map((wi) => ({
              id: wi.id,
              boardRank: wi.boardRanks?.[blId] ?? wi.ranks[blId] ?? 0,
              listRank: getEffectiveParentId(wi, treeId) === myParent ? (wi.ranks[blId] ?? null) : null,
            }))
            .sort((a, b) => a.boardRank - b.boardRank);
          const fitted = boardRankFromListPosition(workItemId, myListRank, columnCards);
          const newBoardRank = fitted ?? (columnCards.length > 0 ? columnCards[columnCards.length - 1].boardRank + 1 : 0);
          nextBoardRanks[blId] = newBoardRank;
          boardRankRows.push({ workItemId, backlogId: blId, rank: newBoardRank, organizationId: item.organizationId ?? orgId });
        }
        updatedWorkItems[workItemId] = { ...updatedWorkItems[workItemId], boardRanks: nextBoardRanks };
        if (boardRankRows.length > 0) persistBoardRankUpserts(boardRankRows);
      }

      upsertWorkItem(updatedWorkItems[workItemId], orgId);
      internalLog({ action: "Status Change", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `"${item.status}" → "${status}"` });
      const isLeavingNotStarted = item.status === "not_started" && status !== "not_started";
      if (isLeavingNotStarted || status === "in_progress" || status === "done") {
        // Helper: pick the best "started" status for an ancestor based on its
        // backlog's effective status set. Prefers "in_progress" (most common),
        // falls back to the lowest-ranked non-pinned status.
        // Returns null when none of the ancestor's backlogs support a started
        // intermediate status, in which case propagation should stop at the
        // ancestor immediately above the one that lacks valid started statuses.
        const getStartedStatus = (ancestor: WorkItem): WorkItemStatus | null => {
          // Find which backlog the ancestor belongs to in any tree context.
          const backlogIds = Object.values(ancestor.backlogAssignments);
          if (status === "done") {
            // When a child is marked done, promote ancestors to their preferred
            // "started" status: prefer "in_progress", then the lowest-ranked
            // non-pinned intermediate status.
            for (const blId of backlogIds) {
              const effective = getEffectiveStatuses(blId);
              if (effective.some((s) => s.key === "in_progress")) return "in_progress";
              const sorted = [...effective].sort((a, b) => a.rank - b.rank);
              for (const s of sorted) {
                if (s.key !== "not_started" && s.key !== "done") {
                  return s.key as WorkItemStatus;
                }
              }
            }
          } else {
            // For any other status (in_progress, pending, blocked, …): only
            // propagate if the ancestor's backlog explicitly supports the exact
            // same status. No fallback — if the backlog doesn't recognise it,
            // leave this ancestor unchanged and continue walking upward.
            for (const blId of backlogIds) {
              const effective = getEffectiveStatuses(blId);
              if (effective.some((s) => s.key === status)) return status;
            }
          }
          // None of the ancestor's backlogs define a suitable status.
          // Leave this ancestor unchanged and continue walking up the chain so
          // ancestors higher up that DO support the status still receive it.
          return null;
        };

        const visited = new Set<string>([workItemId]);
        let ancestorId = item.parentId;
        while (ancestorId && !visited.has(ancestorId)) {
          visited.add(ancestorId);
          const ancestor = updatedWorkItems[ancestorId];
          if (!ancestor) break;
          // Only promote ancestors that are still in the "not_started" state.
          const shouldUpdate = ancestor.status === "not_started";
          if (shouldUpdate) {
            const startedStatus = getStartedStatus(ancestor);
            if (startedStatus !== null) {
              // Ancestor's backlog supports a started intermediate status — promote it.
              updatedWorkItems[ancestorId] = { ...ancestor, status: startedStatus };
              upsertWorkItem(updatedWorkItems[ancestorId], orgId);
              internalLog({ action: "Status Change", entityType: "work_item", entityId: ancestorId, entityName: ancestor.title, details: `"${ancestor.status}" → "${startedStatus}" (auto)` });
            }
            // When startedStatus is null the ancestor's backlogs don't support any
            // started intermediate status.  Leave this ancestor unchanged and
            // continue walking up the chain so ancestors higher up that DO support
            // "in_progress" still receive the propagation.
          }
          ancestorId = ancestor.parentId;
        }
      }
      set({
        workItems: updatedWorkItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    setWorkItemPoints: (workItemId, points) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updated = { ...item, points };
      upsertWorkItem(updated, orgId);
      internalLog({
        action: "Set Points",
        entityType: "work_item",
        entityId: workItemId,
        entityName: item.title,
        details: `${item.points ?? "none"} → ${points ?? "none"}`,
      });
      set({
        workItems: { ...state.workItems, [workItemId]: updated },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    setWorkItemDeadline: (workItemId, deadline) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      // Only a real calendar date gets in; anything else takes it away, as
      // an emptied date field means.
      const due = wellFormedDeadline(deadline);
      if (due === item.deadline) return;
      const updated = { ...item, deadline: due };
      upsertWorkItem(updated, orgId);
      internalLog({
        action: "Set Deadline",
        entityType: "work_item",
        entityId: workItemId,
        entityName: item.title,
        details: `${item.deadline ?? "none"} → ${due ?? "none"}`,
      });
      set({
        workItems: { ...state.workItems, [workItemId]: updated },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    setWorkItemCreatedOn: (workItemId, createdOn) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const made = wellFormedDeadline(createdOn);
      if (!made || made === item.createdOn) return;
      const updated = { ...item, createdOn: made };
      upsertWorkItem(updated, orgId);
      internalLog({
        action: "Set Created Date",
        entityType: "work_item",
        entityId: workItemId,
        entityName: item.title,
        details: `${item.createdOn ?? "none"} → ${made}`,
      });
      set({
        workItems: { ...state.workItems, [workItemId]: updated },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    setWorkItemStartEnd: (workItemId, dates) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const startedOn = "startedOn" in dates ? wellFormedDeadline(dates.startedOn) : item.startedOn;
      const endedOn = "endedOn" in dates ? wellFormedDeadline(dates.endedOn) : item.endedOn;
      if (startedOn === item.startedOn && endedOn === item.endedOn) return;
      const updated = { ...item, startedOn, endedOn };
      upsertWorkItem(updated, orgId);
      internalLog({
        action: "Set Start and End Dates",
        entityType: "work_item",
        entityId: workItemId,
        entityName: item.title,
        details: `${item.startedOn ?? "none"}–${item.endedOn ?? "none"} → ${startedOn ?? "none"}–${endedOn ?? "none"}`,
      });
      set({
        workItems: { ...state.workItems, [workItemId]: updated },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    setWorkItemRating: (workItemId, rating) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      // Out of range means nothing was chosen; the database has the same
      // constraint, and a star count is only ever 1..5 or gone.
      const stars = rating != null && rating >= 1 && rating <= 5 ? Math.round(rating) : undefined;
      if (stars === item.rating) return;
      const updated = { ...item, rating: stars };
      upsertWorkItem(updated, orgId);
      internalLog({
        action: "Set Rating",
        entityType: "work_item",
        entityId: workItemId,
        entityName: item.title,
        details: `${item.rating ?? "unrated"} → ${stars ?? "unrated"}`,
      });
      set({
        workItems: { ...state.workItems, [workItemId]: updated },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    setWorkItemRespawn: (workItemId, respawnEnabled, respawnIntervalDays, respawnHour, respawnMinute) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updated: WorkItem = {
        ...item,
        respawnEnabled,
        respawnIntervalDays: respawnEnabled ? respawnIntervalDays : undefined,
        respawnHour: respawnEnabled ? respawnHour : undefined,
        respawnMinute: respawnEnabled ? respawnMinute : undefined,
      };
      upsertWorkItem(updated, orgId);
      internalLog({ action: "Set Respawn", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `enabled: ${respawnEnabled}, interval: ${respawnIntervalDays ?? 'n/a'}d, hour: ${respawnHour ?? 'n/a'}, minute: ${respawnMinute ?? 'n/a'}` });
      set({ workItems: { ...state.workItems, [workItemId]: updated } });
    },

    respawnItem: (workItemId) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;
      const item = state.workItems[workItemId];
      if (!item || !item.respawnEnabled) return;

      const updatedWorkItems = { ...state.workItems };
      const itemsToUpdateInDB: WorkItem[] = [];

      if (Object.keys(item.backlogAssignments).length === 0) return;

      // For each backlog the item is in, compute the insert rank and shift siblings.
      const copyRanks: Record<string, number> = {};
      for (const [tId, blId] of Object.entries(item.backlogAssignments)) {
        const insertRank = (item.ranks[blId] ?? 0) + 1;
        copyRanks[blId] = insertRank;

        const toShift = buildCascadedShiftSet(
          updatedWorkItems,
          item.parentId,
          insertRank,
          workItemId,
          blId,
        );
        toShift.forEach((id) => {
          const wi = updatedWorkItems[id];
          const shifted = { ...wi, ranks: { ...wi.ranks, [blId]: (wi.ranks[blId] ?? 0) + 1 } };
          updatedWorkItems[id] = shifted;
          itemsToUpdateInDB.push(shifted);
        });
      }

      const newId = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
      const copy: WorkItem = {
        id: newId,
        title: item.title,
        description: item.description,
        points: item.points,
        parentId: item.parentId,
        ranks: copyRanks,
        backlogAssignments: { ...item.backlogAssignments },
        status: "not_started" as WorkItemStatus,
        childrenIds: [],
        createdOn: toIsoDate(new Date()),
      };
      updatedWorkItems[newId] = copy;
      itemsToUpdateInDB.push(copy);

      if (item.parentId && updatedWorkItems[item.parentId]) {
        updatedWorkItems[item.parentId] = {
          ...updatedWorkItems[item.parentId],
          childrenIds: [...updatedWorkItems[item.parentId].childrenIds, newId],
        };
      }

      // Always update lastTriggeredAt so the scheduler does not immediately
      // fire again after a manual "Respawn now" and create a duplicate item.
      const now = new Date().toISOString();
      const updatedSource: WorkItem = { ...item, respawnLastTriggeredAt: now };
      updatedWorkItems[workItemId] = updatedSource;
      itemsToUpdateInDB.push(updatedSource);

      upsertWorkItems(itemsToUpdateInDB, orgId);
      internalLog({ action: "Respawn", entityType: "work_item", entityId: workItemId, entityName: item.title });
      set({ workItems: updatedWorkItems });
    },

    addBacklog: (name, parentId, treeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const id = ensureCleanId(`bl-${crypto.randomUUID().slice(0, 8)}`, orgId);
      let maxRank = -1;
      Object.values(state.backlogs).forEach((bl) => {
        const isSibling = parentId ? bl.parentId === parentId : !bl.parentId && bl.treeId === treeId;
        if (isSibling && bl.rank > maxRank) maxRank = bl.rank;
      });
      const newBacklog: Backlog = { id, name, parentId, childrenIds: [], treeId, rank: maxRank + 1 };
      const updatedBacklogs = { ...state.backlogs, [id]: newBacklog };
      const updatedTrees = { ...state.backlogTrees };
      if (parentId && updatedBacklogs[parentId]) {
        updatedBacklogs[parentId] = {
          ...updatedBacklogs[parentId],
          childrenIds: [id, ...updatedBacklogs[parentId].childrenIds],
        };
      } else if (updatedTrees[treeId]) {
        updatedTrees[treeId] = {
          ...updatedTrees[treeId],
          rootBacklogIds: [id, ...updatedTrees[treeId].rootBacklogIds],
        };
      }
      upsertBacklog(newBacklog, orgId);
      internalLog({ action: "Add", entityType: "backlog", entityId: id, entityName: name });

      const newExpandedBacklogs = new Set(state.expandedBacklogs);
      if (parentId) newExpandedBacklogs.add(parentId);

      set({
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        selectedBacklogIds: [id],
        selectedTreeId: treeId,
        expandedBacklogs: newExpandedBacklogs,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    deleteBacklog: (backlogId: string, direction?: 'up' | 'down') => {
      const state = get();
      const bl = state.backlogs[backlogId];
      if (!bl) return;

      const blIdsToDelete: string[] = [];
      const collectBlIds = (id: string) => {
        blIdsToDelete.push(id);
        state.backlogs[id]?.childrenIds.forEach(collectBlIds);
      };
      collectBlIds(backlogId);
      const blIdSet = new Set(blIdsToDelete);

      const wiIdsToDelete: string[] = [];
      const updatedItems = { ...state.workItems };
      Object.values(updatedItems).forEach((wi) => {
        const newAssignments = { ...wi.backlogAssignments };
        const newRanks = { ...wi.ranks };
        Object.entries(newAssignments).forEach(([tId, bId]) => {
          if (blIdSet.has(bId)) {
            delete newAssignments[tId];
            delete newRanks[bId];
          }
        });
        if (Object.keys(newAssignments).length === 0) {
          wiIdsToDelete.push(wi.id);
        } else if (Object.keys(newAssignments).length !== Object.keys(wi.backlogAssignments).length) {
          updatedItems[wi.id] = { ...wi, backlogAssignments: newAssignments, ranks: newRanks };
        }
      });

      // Korjataan "Ghost Parent" siivoamalla orvot lapset vanhemmilta
      wiIdsToDelete.forEach((childId) => {
        const childItem = state.workItems[childId];
        if (childItem && childItem.parentId && updatedItems[childItem.parentId]) {
          updatedItems[childItem.parentId] = {
            ...updatedItems[childItem.parentId],
            childrenIds: updatedItems[childItem.parentId].childrenIds.filter((id) => id !== childId),
          };
        }
      });

      wiIdsToDelete.forEach((id) => delete updatedItems[id]);
      const updatedBacklogs = { ...state.backlogs };
      blIdsToDelete.forEach((id) => delete updatedBacklogs[id]);

      const updatedTrees = { ...state.backlogTrees };
      if (bl.parentId && updatedBacklogs[bl.parentId]) {
        updatedBacklogs[bl.parentId] = {
          ...updatedBacklogs[bl.parentId],
          childrenIds: updatedBacklogs[bl.parentId].childrenIds.filter((id) => id !== backlogId),
        };
      } else if (updatedTrees[bl.treeId]) {
        updatedTrees[bl.treeId] = {
          ...updatedTrees[bl.treeId],
          rootBacklogIds: updatedTrees[bl.treeId].rootBacklogIds.filter((id) => id !== backlogId),
        };
      }

      // Items that lost at least one assignment but still belong to other trees must
      // be persisted so the DB doesn't retain the stale backlog_assignments entry.
      // Without this, a page reload silently drops the stale entry and the "also in"
      // cross-tree badge disappears permanently for those items.
      const wiIdsToUpsert = Object.values(updatedItems).filter(
        (wi) =>
          !wiIdsToDelete.includes(wi.id) &&
          Object.keys(wi.backlogAssignments).length !==
            Object.keys(state.workItems[wi.id]?.backlogAssignments ?? {}).length,
      );
      persistWorkItemDeletes(wiIdsToDelete)?.catch((err) => console.error("Delete work items failed", err));
      deleteBacklogs(blIdsToDelete)?.catch((err) => console.error("Delete backlogs failed", err));
      if (wiIdsToUpsert.length > 0) {
        upsertWorkItems(wiIdsToUpsert, state.organizationId!)?.catch((err) => console.error("Update work item assignments failed", err));
      }
      internalLog({ action: "Delete", entityType: "backlog", entityId: backlogId, entityName: bl.name });
      const newSelectedBacklogId = computeNextBacklogSelection(blIdSet, direction ?? deleteDirectionRef.current);
      set({
        workItems: updatedItems,
        selectedBacklogIds: newSelectedBacklogId ? [newSelectedBacklogId] : [],
        selectedWorkItemIds: [],
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    renameBacklog: (backlogId, name) => {
      const state = get();
      const orgId = state.organizationId!;
      const bl = state.backlogs[backlogId];
      if (!bl) return;
      const updated = { ...bl, name };
      upsertBacklog(updated, orgId);
      internalLog({ action: "Rename", entityType: "backlog", entityId: backlogId, entityName: name, details: `"${bl.name}" → "${name}"` });
      set({
        backlogs: { ...state.backlogs, [backlogId]: updated },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    setBacklogHiddenStatusKeys: (_backlogId, _keys) => {
      // Legacy no-op: board columns are now fully derived from backlog_statuses.
      // Hiding a column is done by deleting the corresponding status.
    },

    setBacklogRatingsEnabled: (backlogId, enabled) => {
      const state = get();
      const bl = state.backlogs[backlogId];
      if (!bl) return;
      if ((bl.ratingsEnabled ?? false) === enabled) return;
      updateBacklogRatingsEnabled(backlogId, enabled);
      set({
        backlogs: { ...state.backlogs, [backlogId]: { ...bl, ratingsEnabled: enabled } },
      });
    },

    setBacklogCreatedDatesEnabled: (backlogId, enabled) => {
      const state = get();
      const bl = state.backlogs[backlogId];
      if (!bl) return;
      if ((bl.createdDatesEnabled ?? false) === enabled) return;
      updateBacklogCreatedDatesEnabled(backlogId, enabled);
      set({
        backlogs: { ...state.backlogs, [backlogId]: { ...bl, createdDatesEnabled: enabled } },
      });
    },

    setBacklogStartEndDatesEnabled: (backlogId, enabled) => {
      const state = get();
      const bl = state.backlogs[backlogId];
      if (!bl) return;
      if ((bl.startEndDatesEnabled ?? false) === enabled) return;
      updateBacklogStartEndDatesEnabled(backlogId, enabled);
      set({
        backlogs: { ...state.backlogs, [backlogId]: { ...bl, startEndDatesEnabled: enabled } },
      });
    },

    setBacklogPoints: (backlogId, points) => {
      const state = get();
      const bl = state.backlogs[backlogId];
      if (!bl) return;
      const estimate = wellFormedPoints(points);
      if (estimate === bl.points) return;
      updateBacklogPoints(backlogId, estimate ?? null);
      internalLog({
        action: "Set List Points",
        entityType: "backlog",
        entityId: backlogId,
        entityName: bl.name,
        details: `${bl.points ?? "none"} → ${estimate ?? "none"}`,
      });
      set({
        backlogs: { ...state.backlogs, [backlogId]: { ...bl, points: estimate } },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    setBacklogViewMode: (backlogId, mode) => {
      const state = get();
      const bl = state.backlogs[backlogId];
      if (!bl) return;
      if (bl.viewMode === mode) return;
      updateBacklogViewMode(backlogId, mode);
      set({
        backlogs: { ...state.backlogs, [backlogId]: { ...bl, viewMode: mode } },
      });
    },

    reorderBacklogAmongSiblings: (backlogId, targetIndex, _targetParentId, _treeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const bl = state.backlogs[backlogId];
      if (!bl) return;
      const siblingIds = bl.parentId
        ? (state.backlogs[bl.parentId]?.childrenIds ?? [])
        : (state.backlogTrees[bl.treeId]?.rootBacklogIds ?? []);
      const siblings = siblingIds.map((id) => state.backlogs[id]).filter(Boolean);
      const remaining = siblings.filter((s) => s.id !== backlogId);
      const clamped = Math.max(0, Math.min(targetIndex, remaining.length));
      remaining.splice(clamped, 0, bl);
      const updatedBacklogs = { ...state.backlogs };
      remaining.forEach((s, i) => {
        updatedBacklogs[s.id] = { ...updatedBacklogs[s.id], rank: i };
      });
      const newIds = remaining.map((s) => s.id);
      const updatedTrees = { ...state.backlogTrees };
      if (bl.parentId && updatedBacklogs[bl.parentId]) {
        updatedBacklogs[bl.parentId] = { ...updatedBacklogs[bl.parentId], childrenIds: newIds };
      } else if (updatedTrees[bl.treeId]) {
        updatedTrees[bl.treeId] = { ...updatedTrees[bl.treeId], rootBacklogIds: newIds };
      }
      upsertBacklogs(
        remaining.map((s) => updatedBacklogs[s.id]),
        orgId,
      );
      internalLog({ action: "Reorder", entityType: "backlog", entityId: backlogId, entityName: bl.name });
      set({
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    moveBacklog: (backlogId, targetParentId, treeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const bl = state.backlogs[backlogId];
      if (!bl) return;
      // Never into itself or anything beneath it: the backlog would become its
      // own ancestor and vanish from the tree with its whole branch. Callers
      // check this too; this is the last line, for any that forget.
      for (let t: string | null | undefined = targetParentId, seen = new Set<string>(); t && !seen.has(t); t = state.backlogs[t]?.parentId) {
        if (t === backlogId) {
          console.warn("moveBacklog: refused to move a backlog into its own subtree", backlogId, targetParentId);
          return;
        }
        seen.add(t);
      }
      const updatedBacklogs = { ...state.backlogs };
      const updatedTrees = { ...state.backlogTrees };
      if (bl.parentId && updatedBacklogs[bl.parentId]) {
        updatedBacklogs[bl.parentId] = {
          ...updatedBacklogs[bl.parentId],
          childrenIds: updatedBacklogs[bl.parentId].childrenIds.filter((id) => id !== backlogId),
        };
      } else if (updatedTrees[bl.treeId]) {
        updatedTrees[bl.treeId] = {
          ...updatedTrees[bl.treeId],
          rootBacklogIds: updatedTrees[bl.treeId].rootBacklogIds.filter((id) => id !== backlogId),
        };
      }
      if (targetParentId && updatedBacklogs[targetParentId]) {
        updatedBacklogs[targetParentId] = {
          ...updatedBacklogs[targetParentId],
          childrenIds: [...updatedBacklogs[targetParentId].childrenIds, backlogId],
        };
      } else if (updatedTrees[treeId]) {
        updatedTrees[treeId] = {
          ...updatedTrees[treeId],
          rootBacklogIds: [...updatedTrees[treeId].rootBacklogIds, backlogId],
        };
      }
      // Compute a rank for the moved backlog that avoids conflicts among its new siblings.
      let maxRank = -1;
      Object.values(state.backlogs).forEach((sibling) => {
        if (sibling.id === backlogId) return;
        const isSiblingAtTarget = targetParentId
          ? sibling.parentId === targetParentId && sibling.treeId === treeId
          : !sibling.parentId && sibling.treeId === treeId;
        if (isSiblingAtTarget && sibling.rank > maxRank) maxRank = sibling.rank;
      });
      updatedBacklogs[backlogId] = { ...bl, parentId: targetParentId, treeId, rank: maxRank + 1 };

      const oldTreeId = bl.treeId;
      let updatedWorkItems = state.workItems;

      if (oldTreeId !== treeId) {
        // Collect all backlog IDs in the moved subtree (BFS over children)
        const movedBacklogIds = new Set<string>([backlogId]);
        const queue = [...(state.backlogs[backlogId]?.childrenIds ?? [])];
        while (queue.length) {
          const childId = queue.shift();
          if (!childId) break;
          movedBacklogIds.add(childId);
          const child = state.backlogs[childId];
          if (child) queue.push(...child.childrenIds);
        }

        // Update treeId for all descendant backlogs (the root was already updated above)
        movedBacklogIds.forEach((id) => {
          if (id !== backlogId) {
            updatedBacklogs[id] = { ...updatedBacklogs[id], treeId };
          }
        });

        // Remap work item backlog assignments: oldTreeId key → newTreeId key
        const changedItems: WorkItem[] = [];
        updatedWorkItems = { ...state.workItems };
        Object.values(state.workItems).forEach((wi) => {
          const blId = wi.backlogAssignments[oldTreeId];
          if (blId && movedBacklogIds.has(blId)) {
            const newAssignments = { ...wi.backlogAssignments };
            delete newAssignments[oldTreeId];
            newAssignments[treeId] = blId;
            const updated = { ...wi, backlogAssignments: newAssignments };
            updatedWorkItems[wi.id] = updated;
            changedItems.push(updated);
          }
        });

        // Persist descendant backlogs and changed work items
        const descendantBacklogs = [...movedBacklogIds]
          .filter((id) => id !== backlogId)
          .map((id) => updatedBacklogs[id]);
        if (descendantBacklogs.length) upsertBacklogs(descendantBacklogs, orgId);
        if (changedItems.length) upsertWorkItems(changedItems, orgId);
      }

      upsertBacklog(updatedBacklogs[backlogId], orgId);
      internalLog({ action: "Move", entityType: "backlog", entityId: backlogId, entityName: bl.name, details: `parent: "${bl.parentId ? state.backlogs[bl.parentId]?.name ?? bl.parentId : 'root'}" → "${targetParentId ? state.backlogs[targetParentId]?.name ?? targetParentId : 'root'}"` });
      set({
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        workItems: updatedWorkItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    addBacklogTree: (name) => {
      const state = get();
      const orgId = state.organizationId!;
      const id = ensureCleanId(`bt-${crypto.randomUUID().slice(0, 8)}`, orgId);
      let maxRank = -1;
      Object.values(state.backlogTrees).forEach((t) => {
        if (t.rank > maxRank) maxRank = t.rank;
      });
      const rank = maxRank + 1;
      const newTree: BacklogTree = { id, name, rootBacklogIds: [], rank };
      upsertBacklogTree(newTree, orgId);
      // Pinned statuses are seeded automatically on new root backlogs by a DB trigger.
      internalLog({ action: "Add", entityType: "backlog_tree", entityId: id, entityName: name });
      set({
        backlogTrees: { ...state.backlogTrees, [id]: newTree },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    deleteBacklogTree: (treeId) => {
      const state = get();
      const blIdsToDelete = Object.values(state.backlogs)
        .filter((bl) => bl.treeId === treeId)
        .map((bl) => bl.id);
      const blIdSet = new Set(blIdsToDelete);
      const wiIdsToDelete: string[] = [];
      const updatedItems = { ...state.workItems };
      Object.values(updatedItems).forEach((wi) => {
        const newAssignments = { ...wi.backlogAssignments };
        const newRanks = { ...wi.ranks };
        const removedBlId = newAssignments[treeId];
        delete newAssignments[treeId];
        if (removedBlId) delete newRanks[removedBlId];
        Object.entries(newAssignments).forEach(([tId, bId]) => {
          if (blIdSet.has(bId)) {
            delete newAssignments[tId];
            delete newRanks[bId];
          }
        });
        if (Object.keys(newAssignments).length === 0) wiIdsToDelete.push(wi.id);
        else updatedItems[wi.id] = { ...wi, backlogAssignments: newAssignments, ranks: newRanks };
      });
      wiIdsToDelete.forEach((id) => delete updatedItems[id]);
      const updatedBacklogs = { ...state.backlogs };
      blIdsToDelete.forEach((id) => delete updatedBacklogs[id]);
      const updatedTrees = { ...state.backlogTrees };
      delete updatedTrees[treeId];
      persistWorkItemDeletes(wiIdsToDelete);
      deleteBacklogs(blIdsToDelete);
      deleteBacklogTreeDB(treeId);
      internalLog({ action: "Delete", entityType: "backlog_tree", entityId: treeId, entityName: state.backlogTrees[treeId]?.name });
      const wasSelectedTree = state.selectedTreeId === treeId;
      set({
        workItems: updatedItems,
        backlogs: updatedBacklogs,
        backlogTrees: updatedTrees,
        undoStack: pushUndoEntry(state),
        ...(wasSelectedTree ? { selectedTreeId: null, selectedBacklogIds: [], selectedWorkItemIds: [] } : {}),
        redoStack: [],
      });
    },

    renameBacklogTree: (treeId, name) => {
      const state = get();
      const orgId = state.organizationId!;
      const tree = state.backlogTrees[treeId];
      if (!tree) return;
      const updated = { ...tree, name };
      upsertBacklogTree(updated, orgId);
      internalLog({ action: "Rename", entityType: "backlog_tree", entityId: treeId, entityName: name, details: `"${tree.name}" → "${name}"` });
      set({
        backlogTrees: { ...state.backlogTrees, [treeId]: updated },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    setTreePointsEnabled: (treeId, enabled) => {
      const state = get();
      const orgId = state.organizationId!;
      const tree = state.backlogTrees[treeId];
      if (!tree) return;
      const updated = { ...tree, pointsEnabled: enabled };
      upsertBacklogTree(updated, orgId);
      internalLog({
        action: "Update",
        entityType: "backlog_tree",
        entityId: treeId,
        entityName: tree.name,
        details: `Points: ${enabled === false ? "disabled" : enabled === true ? "enabled" : "inherit"}`,
      });
      set({
        backlogTrees: { ...state.backlogTrees, [treeId]: updated },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    reorderBacklogTree: (treeId, targetIndex) => {
      const state = get();
      const orgId = state.organizationId!;
      const sorted = Object.values(state.backlogTrees).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      const remaining = sorted.filter((t) => t.id !== treeId);
      const tree = sorted.find((t) => t.id === treeId);
      if (!tree) return;
      const clamped = Math.max(0, Math.min(targetIndex, remaining.length));
      remaining.splice(clamped, 0, tree);
      const updatedTrees = { ...state.backlogTrees };
      remaining.forEach((t, i) => {
        updatedTrees[t.id] = { ...updatedTrees[t.id], rank: i };
      });
      upsertBacklogTrees(
        remaining.map((t) => updatedTrees[t.id]),
        orgId,
      );
      internalLog({ action: "Reorder", entityType: "backlog_tree", entityId: treeId, entityName: tree.name });
      set({
        backlogTrees: updatedTrees,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    resetToMockData: async () => {
      const orgId = get().organizationId;
      if (!orgId) return;
      set({ isLoading: true });
      try {
        const mockData = generateMockData();
        await resetOrgData(orgId, mockData);
        await get().loadFromSupabase();
        internalLog({ action: "System Reset", entityType: "data" });
      } catch (err) {
        set({ isLoading: false });
      }
    },

    undo: () => {
      const state = get();
      const stack = [...state.undoStack];
      const popped = stack.pop();
      if (!popped) return;
      bumpMutationVersion();
      persistSnapshotSwitch(state, popped);
      set({ ...popped, undoStack: stack, redoStack: [...state.redoStack, snapshot(state)] });
    },

    redo: () => {
      const state = get();
      const stack = [...state.redoStack];
      const popped = stack.pop();
      if (!popped) return;
      bumpMutationVersion();
      persistSnapshotSwitch(state, popped);
      set({ ...popped, undoStack: [...state.undoStack, snapshot(state)], redoStack: stack });
    },

    runBulk: (fn) => runAsOneUndoStep(fn, get, set),

    addHyperlink: (workItemId, url, altText) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;
      const existing = state.hyperlinks[workItemId] ?? [];
      const id = crypto.randomUUID();
      const newLink: Hyperlink = {
        id,
        workItemId,
        url,
        altText,
        rank: existing.length,
      };
      const itemOrgId = state.workItems[workItemId]?.organizationId;
      upsertHyperlink(newLink, orgId, itemOrgId);
      internalLog({ action: "Add Hyperlink", entityType: "hyperlink", entityId: workItemId, details: url });
      set({
        hyperlinks: { ...state.hyperlinks, [workItemId]: [...existing, newLink] },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    updateHyperlink: (linkId, workItemId, url, altText) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId) return;
      const existing = state.hyperlinks[workItemId] ?? [];
      const idx = existing.findIndex((l) => l.id === linkId);
      if (idx === -1) return;
      const updated: Hyperlink = { ...existing[idx], url, altText };
      const itemOrgId = state.workItems[workItemId]?.organizationId;
      upsertHyperlink(updated, orgId, itemOrgId);
      internalLog({ action: "Update Hyperlink", entityType: "hyperlink", entityId: workItemId, details: url });
      const newList = [...existing];
      newList[idx] = updated;
      set({
        hyperlinks: { ...state.hyperlinks, [workItemId]: newList },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    removeHyperlink: (linkId, workItemId) => {
      const state = get();
      const existing = state.hyperlinks[workItemId] ?? [];
      const filtered = existing.filter((l) => l.id !== linkId);
      deleteHyperlinkDB(linkId);
      internalLog({ action: "Remove Hyperlink", entityType: "hyperlink", entityId: workItemId });
      set({
        hyperlinks: { ...state.hyperlinks, [workItemId]: filtered },
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    ...liveUpdateActions(set, get),

    loadHyperlinksForItem: async (workItemId) => {
      const links = await loadHyperlinksForWorkItems([workItemId]);
      setFromElsewhere(set, get, (state) => ({
        hyperlinks: { ...state.hyperlinks, [workItemId]: links[workItemId] ?? [] },
      }));
    },

  };
});
