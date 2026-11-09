import { toIsoDate, wellFormedDeadline } from "@/lib/deadlineFormat";
import { forgetDeletedContainers, isRecentlyDeletedContainer } from './deletedContainers';
import { wellFormedPoints } from "@/lib/backlogPoints";
import { create } from "zustand";
import { WorkItem, WorkItemStatus, Backlog, BacklogTree, Hyperlink, getEffectiveParentId } from "@/types/models";
import {
  loadFromSupabase,
  upsertWorkItem,
  upsertWorkItems,
  deleteWorkItems,
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
  upsertWorkItemBacklogRankRows,
  upsertWorkItemBacklogRankRowsDetailed,
  upsertWorkItemBoardRankRows,
  upsertWorkItemBoardRankRowsDetailed,
  deleteWorkItemBoardRanks,
  restoreWorkItems,
  type WorkItemBacklogRankUpsert,
  type WorkItemBoardRankUpsert,
} from "./supabaseSync";
import { isRecentlyDeletedWorkItem } from "./deletedWorkItems";
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
import { redistributeRanksByStatus, boardRankFromListPosition, listRanksFollowingColumn } from "@/lib/rankSync";
import { boardColumnKey, byBoardRank } from "@/lib/boardColumn";
import { byRank } from "@/lib/workItemRows";
import { visibleWorkItemIdsRef, visibleBacklogIdsRef, deleteDirectionRef } from "./navigationRefs";
import { notifyPersistDebug } from "@/lib/persistDebug";
import type { AppState, DataSnapshot } from "./app/types";
import { keepRemoteAdditions } from "./app/remoteArrivals";
import { recordRankWrite, recordBoardRankWrite } from "./app/rankEchoes";
import { samePersistedWorkItem } from "./app/samePersistedWorkItem";
import { selectionActions, storedSelection } from "./app/selection";
import { liveUpdateActions } from "./app/liveUpdates";

function generateMockData() {
  return JSON.parse(JSON.stringify(staticMockData));
}

/**
 * Given a set of work-item IDs that are about to be deleted, compute the best
 * work item to select afterwards.  Prefers the item immediately above the first
 * deleted item in the current visible order; falls back to the item below.
 */
function computeNextWorkItemSelection(deletedIds: Set<string>, direction: 'up' | 'down' = 'up'): string | null {
  const visible = visibleWorkItemIdsRef.current;
  let minIdx = visible.length;
  for (let i = 0; i < visible.length; i++) {
    if (deletedIds.has(visible[i])) { minIdx = i; break; }
  }
  if (direction === 'down') {
    // Look downward first, then upward.
    for (let i = minIdx + 1; i < visible.length; i++) {
      if (!deletedIds.has(visible[i])) return visible[i];
    }
    for (let i = minIdx - 1; i >= 0; i--) {
      if (!deletedIds.has(visible[i])) return visible[i];
    }
  } else {
    // Look upward first, then downward.
    for (let i = minIdx - 1; i >= 0; i--) {
      if (!deletedIds.has(visible[i])) return visible[i];
    }
    for (let i = minIdx + 1; i < visible.length; i++) {
      if (!deletedIds.has(visible[i])) return visible[i];
    }
  }
  return null;
}

/* OLD BODY:
  // Look upward for the closest non-deleted item.
  for (let i = minIdx - 1; i >= 0; i--) {
    if (!deletedIds.has(visible[i])) return visible[i];
  }
  // Look downward.
  for (let i = minIdx + 1; i < visible.length; i++) {
    if (!deletedIds.has(visible[i])) return visible[i];
  }
  return null;
*/
// (old comment block)

/**
 * The backlogs the work item panel is showing: each selected backlog and
 * every backlog beneath it, since selecting a backlog shows its whole
 * subtree. Used to tell whether a move takes an item off screen.
 */
function shownBacklogIds(backlogs: Record<string, Backlog>, selectedBacklogIds: string[]): Set<string> {
  const shown = new Set<string>();
  const collect = (id: string) => {
    if (shown.has(id)) return;
    shown.add(id);
    (backlogs[id]?.childrenIds ?? []).forEach(collect);
  };
  selectedBacklogIds.forEach(collect);
  return shown;
}

/**
 * Same as computeNextWorkItemSelection but for backlog nodes.
 */
function computeNextBacklogSelection(deletedIds: Set<string>, direction: 'up' | 'down' = 'up'): string | null {
  const visible = visibleBacklogIdsRef.current;
  let minIdx = visible.length;
  for (let i = 0; i < visible.length; i++) {
    if (deletedIds.has(visible[i])) { minIdx = i; break; }
  }
  if (direction === 'down') {
    for (let i = minIdx + 1; i < visible.length; i++) {
      if (!deletedIds.has(visible[i])) return visible[i];
    }
    for (let i = minIdx - 1; i >= 0; i--) {
      if (!deletedIds.has(visible[i])) return visible[i];
    }
  } else {
    for (let i = minIdx - 1; i >= 0; i--) {
      if (!deletedIds.has(visible[i])) return visible[i];
    }
    for (let i = minIdx + 1; i < visible.length; i++) {
      if (!deletedIds.has(visible[i])) return visible[i];
    }
  }
  return null;
}

/* OLD BODY:
  for (let i = minIdx - 1; i >= 0; i--) {
    if (!deletedIds.has(visible[i])) return visible[i];
  }
  for (let i = minIdx + 1; i < visible.length; i++) {
    if (!deletedIds.has(visible[i])) return visible[i];
  }
  return null;
*/
// (old comment block)

/** Get the rank of a work item in a specific tree context. */
function getWorkItemRank(item: WorkItem, treeId: string): number {
  const backlogId = item.backlogAssignments[treeId];
  return backlogId ? (item.ranks[backlogId] ?? 0) : 0;
}

export type { ChangeLogEntry } from "./changeLog";
export { resetRankEchoSuppression } from "./app/rankEchoes";

/**
 * Resolve duplicate work-item ranks in-place.  For each (treeId, backlogId,
 * parentId) group, items sharing a rank are re-numbered sequentially (ties
 * broken by ID for determinism).  Mutates `items` directly for performance.
 * Each rank it changes is added to `repairs`, for the caller to save
 * (`hadRank` is the caller's to set: ranks are already filled in here).
 */
export interface LoadRankRepair {
  workItemId: string;
  backlogId: string;
  rank: number;
  /** Whether the item had a rank row in this list (an update, not an insert). */
  hadRank: boolean;
}

function dedupWorkItemRanksInPlace(items: Record<string, WorkItem>, repairs?: LoadRankRepair[]): void {
  const groups = new Map<string, string[]>();
  for (const wi of Object.values(items)) {
    for (const [treeId, blId] of Object.entries(wi.backlogAssignments)) {
      const key = `${treeId}::${blId}::${wi.parentId ?? 'ROOT'}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(wi.id);
    }
  }
  groups.forEach((ids, key) => {
    const backlogId = key.split('::').slice(-3, -1).join('::');  // extract backlogId from key
    // Actually, the key format is `treeId::backlogId::parentId` but treeId and backlogId
    // themselves contain '::'. Parse from the group entries instead.
    if (ids.length < 2) return;
    // Get backlogId from the first item's assignment
    const firstItem = items[ids[0]];
    if (!firstItem) return;
    // Find the backlogId for this group by checking which treeId::blId matches
    let blId: string | null = null;
    for (const [_treeId, bId] of Object.entries(firstItem.backlogAssignments)) {
      // Check if this assignment matches the group key
      const testKey = `${_treeId}::${bId}::${firstItem.parentId ?? 'ROOT'}`;
      if (testKey === key) { blId = bId; break; }
    }
    if (!blId) return;

    const sorted = ids
      .filter((id) => items[id])
      .sort((a, b) => {
        const rA = items[a].ranks[blId!] ?? 0;
        const rB = items[b].ranks[blId!] ?? 0;
        return rA !== rB ? rA - rB : a.localeCompare(b);
      });

    let prev = -Infinity;
    for (const id of sorted) {
      const r = items[id].ranks[blId] ?? 0;
      if (r <= prev) {
        const newRank = prev + 1;
        repairs?.push({ workItemId: id, backlogId: blId, rank: newRank, hadRank: true });
        items[id] = { ...items[id], ranks: { ...items[id].ranks, [blId]: newRank } };
        prev = newRank;
      } else {
        prev = r;
      }
    }
  });
}


const ensureCleanId = (id: string, orgId: string): string => {
  if (!id) return id;
  const parts = id.split("::");
  if (parts.length === 1) {
    // Unprefixed (mock/legacy) ID – IDs never contain '::' in their raw part,
    // so any '::' means the ID is already org-scoped.
    return `${orgId}::${id}`;
  }
  // Already prefixed. Strip any extra levels of nesting (e.g. orgA::orgA::rawId → orgA::rawId)
  // but preserve the existing owner prefix so shared entities keep their original org scope.
  return `${parts[parts.length - 2]}::${parts[parts.length - 1]}`;
};

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

// Shallow snapshot for undo/redo. All reducers construct fresh objects when
// modifying entries (spread-and-replace), so sharing child references between
// a snapshot and live state is safe — nothing mutates a stored object in
// place after the fact. Keeping this shallow is critical for perf on bulk
// operations over large maps.
const snapshot = (state: DataSnapshot): DataSnapshot => ({
  workItems: { ...state.workItems },
  backlogs: { ...state.backlogs },
  backlogTrees: { ...state.backlogTrees },
  hyperlinks: { ...state.hyperlinks },
  selectedBacklogIds: [...state.selectedBacklogIds],
  selectedTreeId: state.selectedTreeId,
  selectedWorkItemIds: [...state.selectedWorkItemIds],
  changeLog: state.changeLog,
  expandedWorkItems: new Set(state.expandedWorkItems),
  expandedBacklogs: new Set(state.expandedBacklogs),
});

const MAX_UNDO = 100;

/**
 * Bulk-operation tracking: when `undoBatchDepth > 0`, mutators skip pushing
 * their own undo snapshot; the `runBulk` wrapper captures exactly one
 * snapshot at the start of the outermost batch and pushes it when the batch
 * ends, so a multi-item operation becomes a single undo step.
 */
let undoBatchDepth = 0;
let pendingBatchSnapshot: DataSnapshot | null = null;

/**
 * Mutation counter that increments on every user-initiated change to workItems,
 * backlogs, or backlogTrees.  The background refresh uses this to detect
 * whether the user made edits while the Supabase fetch was in-flight, and
 * skips overwriting state with potentially stale data if so.
 */
let localMutationVersion = 0;

function bumpMutationVersion() {
  localMutationVersion++;
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

function pushUndoEntry(state: AppState): DataSnapshot[] {
  if (undoBatchDepth > 0) return state.undoStack;
  bumpMutationVersion();
  return [...state.undoStack.slice(-(MAX_UNDO - 1)), snapshot(state)];
}

/**
 * Applies a batch of work-item ID renames (old → new) to the store's data
 * snapshot.  Rewires every item's own `id`, `parentId` back-references,
 * `childrenIds`, the `hyperlinks` map, and the selected-work-item list.
 * Returns a partial state object suitable for passing directly to `set()`.
 */
/**
 * Walk up the parentId chain (using the original/pre-deletion items map) and
 * return the id of the nearest ancestor that is NOT in `deleteSet`, or null
 * if the item becomes a root.  A visited set prevents infinite loops on
 * circular parentId data.
 */
function findSurvivingAncestor(
  startParentId: string,
  deleteSet: Set<string>,
  originalItems: Record<string, WorkItem>,
): string | null {
  let current: string | null = startParentId;
  const visited = new Set<string>();
  while (current && deleteSet.has(current)) {
    if (visited.has(current)) return null;
    visited.add(current);
    current = originalItems[current]?.parentId ?? null;
  }
  return current;
}

/**
 * Scan `updatedItems` for items whose `parentId` points to a deleted item
 * (i.e. an id in `deleteSet`).  For each such "orphaned survivor", reparent
 * it to its nearest surviving ancestor via `findSurvivingAncestor`, then call
 * `onRepaired` with the updated WorkItem so the caller can persist it.
 */
function repairOrphanedSurvivors(
  updatedItems: Record<string, WorkItem>,
  deleteSet: Set<string>,
  originalItems: Record<string, WorkItem>,
  onRepaired: (updated: WorkItem) => void,
): void {
  for (const wi of Object.values(updatedItems)) {
    if (!wi.parentId || !deleteSet.has(wi.parentId)) continue;
    const newParentId = findSurvivingAncestor(wi.parentId, deleteSet, originalItems);
    const updated = { ...wi, parentId: newParentId };
    updatedItems[wi.id] = updated;
    onRepaired(updated);
    if (newParentId && updatedItems[newParentId]) {
      const parent = updatedItems[newParentId];
      if (!parent.childrenIds.includes(wi.id)) {
        updatedItems[newParentId] = {
          ...parent,
          childrenIds: [...parent.childrenIds, wi.id],
        };
      }
    }
  }
}

function applyWorkItemIdRenames(
  state: Pick<AppState, 'workItems' | 'hyperlinks' | 'selectedWorkItemIds'>,
  oldToNew: Record<string, string>,
): Pick<AppState, 'workItems' | 'hyperlinks' | 'selectedWorkItemIds'> {
  if (Object.keys(oldToNew).length === 0) return {
    workItems: state.workItems,
    hyperlinks: state.hyperlinks,
    selectedWorkItemIds: state.selectedWorkItemIds,
  };

  const updatedWorkItems: Record<string, WorkItem> = {};
  for (const [id, item] of Object.entries(state.workItems)) {
    const newId = oldToNew[id] ?? id;
    updatedWorkItems[newId] = {
      ...item,
      id: newId,
      organizationId: item.organizationId, // preserve
      parentId: item.parentId ? (oldToNew[item.parentId] ?? item.parentId) : null,
      childrenIds: item.childrenIds.map(cid => oldToNew[cid] ?? cid),
    };
  }

  const updatedHyperlinks: Record<string, Hyperlink[]> = {};
  for (const [workItemId, links] of Object.entries(state.hyperlinks)) {
    const newWorkItemId = oldToNew[workItemId] ?? workItemId;
    updatedHyperlinks[newWorkItemId] = links.map(link => ({
      ...link,
      workItemId: newWorkItemId,
    }));
  }

  const updatedSelectedWorkItemIds = state.selectedWorkItemIds.map(id => oldToNew[id] ?? id);

  return {
    workItems: updatedWorkItems,
    hyperlinks: updatedHyperlinks,
    selectedWorkItemIds: updatedSelectedWorkItemIds,
  };
}

/**
 * Compute the set of work-item IDs whose rank in `backlogId` must be incremented
 * by 1 so that inserting an item at `insertRank` does not leave any duplicate
 * ranks within the same backlog.
 *
 * With per-backlog ranks, only items sharing the same (parentId, backlogId)
 * need to be considered — no cross-context cascade is necessary.
 */
function buildCascadedShiftSet(
  allItems: Record<string, WorkItem>,
  parentId: string | null,
  insertRank: number,
  excludeId: string | null,
  backlogId: string,
  treeId?: string,
): Set<string> {
  const toShift = new Set<string>();

  for (const wi of Object.values(allItems)) {
    // When we know the tree we're inserting into, group siblings by their
    // effective per-tree parent (parent_id_overrides ?? parent_id). Otherwise
    // fall back to the global parent — this preserves legacy behaviour for
    // callers that operate outside a tree context (e.g. duplicate).
    const wiParent = treeId ? getEffectiveParentId(wi, treeId) : wi.parentId;
    if (wiParent !== parentId) continue;
    if (excludeId && wi.id === excludeId) continue;
    // Only consider items that are assigned to the same backlog
    const wiBacklogIds = Object.values(wi.backlogAssignments);
    if (!wiBacklogIds.includes(backlogId)) continue;
    if ((wi.ranks[backlogId] ?? 0) >= insertRank) toShift.add(wi.id);
  }

  return toShift;
}

function getVisibleBacklogIds(
  backlogs: Record<string, Backlog>,
  backlogId: string,
): Set<string> {
  const ids = new Set<string>();
  const collect = (id: string) => {
    if (ids.has(id)) return;
    ids.add(id);
    backlogs[id]?.childrenIds.forEach(collect);
  };
  collect(backlogId);
  return ids;
}

function assignSequentialRanksForContext(
  items: Record<string, WorkItem>,
  parentId: string | null,
  treeId: string,
  backlogIds: Set<string>,
  orderedIds: string[],
): WorkItem[] {
  const changed: WorkItem[] = [];
  orderedIds.forEach((id, rank) => {
    const wi = items[id];
    const wiBacklogId = wi?.backlogAssignments[treeId];
    // Compare against the per-tree effective parent so items with a per-tree
    // override are grouped with their siblings in this tree, not in whatever
    // tree owns their global parent.
    const wiEffectiveParent = wi ? getEffectiveParentId(wi, treeId) : null;
    if (!wi || !wiBacklogId || !backlogIds.has(wiBacklogId) || wiEffectiveParent !== parentId) return;
    if (wi.ranks[wiBacklogId] === rank) return;
    const updated = { ...wi, ranks: { ...wi.ranks, [wiBacklogId]: rank } };
    items[id] = updated;
    changed.push(updated);
  });
  return changed;
}


const PENDING_RANK_UPSERTS_KEY = "pending_work_item_rank_upserts";
const PENDING_BOARD_RANK_UPSERTS_KEY = "pending_work_item_board_rank_upserts";
const PENDING_WORK_ITEM_UPSERTS_KEY = "pending_work_item_upserts";

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

type PendingWorkItemUpsert = {
  item: WorkItem;
  organizationId: string;
  updatedAt: number;
};

type ContainerSnapshot = {
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
};

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

function readPendingWorkItemUpserts(orgId: string): PendingWorkItemUpsert[] {
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

function collectReferencedContainers(items: WorkItem[], fallback?: ContainerSnapshot): ContainerSnapshot {
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

async function persistReferencedContainersForItems(items: WorkItem[], organizationId: string, fallback?: ContainerSnapshot) {
  const containers = collectReferencedContainers(items, fallback);
  const trees = Object.values(containers.backlogTrees);
  const backlogsToPersist = Object.values(containers.backlogs);
  if (trees.length > 0) await upsertBacklogTrees(trees, organizationId);
  if (backlogsToPersist.length > 0) await upsertBacklogs(backlogsToPersist, organizationId);
}

function queueWorkItemUpsertsForRetry(items: WorkItem[], organizationId: string) {
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

function removeQueuedWorkItemUpserts(items: WorkItem[], organizationId: string) {
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

function removeQueuedBoardRankUpserts(rows: WorkItemBoardRankUpsert[]) {
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

function persistWorkItemUpserts(items: WorkItem[], organizationId: string, boardRankRows: WorkItemBoardRankUpsert[] = [], fallbackContainers?: ContainerSnapshot) {
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
function forgetQueuedWritesFor(workItemIds: string[]) {
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
function persistWorkItemDeletes(workItemIds: string[]) {
  if (workItemIds.length === 0) return;
  forgetQueuedWritesFor(workItemIds);
  return deleteWorkItems(workItemIds);
}

/** Lists `childId` among `parentId`'s children, once, where that parent is there. Changes `items`. */
function addChild(items: Record<string, WorkItem>, parentId: string | null, childId: string): void {
  const parent = parentId ? items[parentId] : undefined;
  if (!parentId || !parent || parent.childrenIds.includes(childId)) return;
  items[parentId] = { ...parent, childrenIds: [...parent.childrenIds, childId] };
}

/** Takes `childId` off `parentId`'s children, where that parent is there. Changes `items`. */
function removeChild(items: Record<string, WorkItem>, parentId: string, childId: string): void {
  const parent = items[parentId];
  if (!parent) return;
  items[parentId] = { ...parent, childrenIds: parent.childrenIds.filter((id) => id !== childId) };
}

/**
 * One past the highest rank in list `backlogId` among the items under
 * `parentId` in `treeId` — the item being moved aside — so that it goes last
 * among its new siblings.
 */
function nextRankAmongSiblings(
  workItems: Record<string, WorkItem>,
  movingId: string,
  parentId: string | null,
  treeId: string,
  backlogId: string,
): number {
  let maxRank = -1;
  for (const wi of Object.values(workItems)) {
    if (wi.id === movingId) continue;
    if (getEffectiveParentId(wi, treeId) !== parentId) continue;
    if (wi.backlogAssignments[treeId] !== backlogId) continue;
    const wiRank = wi.ranks[backlogId] ?? 0;
    if (wiRank > maxRank) maxRank = wiRank;
  }
  return maxRank + 1;
}

/**
 * Moves the descendants of `childIds` into list `backlogId` of `treeId`,
 * in `items`, leaving their other trees alone. Each keeps the rank it had in
 * its old list — or the one it already has in the new list. Returns their ids,
 * each before its own descendants.
 */
function moveDescendantsToList(
  items: Record<string, WorkItem>,
  childIds: readonly string[],
  treeId: string,
  backlogId: string,
): string[] {
  const moved: string[] = [];
  const move = (id: string) => {
    const wi = items[id];
    if (!wi) return;
    const oldBlId = wi.backlogAssignments[treeId];
    const ranks = { ...wi.ranks };
    if (oldBlId && oldBlId !== backlogId) delete ranks[oldBlId];
    ranks[backlogId] = ranks[backlogId] ?? (oldBlId ? (wi.ranks[oldBlId] ?? 0) : 0);
    items[id] = { ...wi, backlogAssignments: { ...wi.backlogAssignments, [treeId]: backlogId }, ranks };
    moved.push(id);
    wi.childrenIds.forEach(move);
  };
  childIds.forEach(move);
  return moved;
}

/**
 * Siblings among `ids` that came from different lists can share a rank, or
 * have one out of order, in `backlogId`: each that does not come after the
 * one before it gets the next rank, in their present order. Changes `items`.
 */
function spreadMergedSiblingRanks(
  items: Record<string, WorkItem>,
  ids: readonly string[],
  backlogId: string,
  parentOf: (wi: WorkItem) => string | null,
): void {
  const byParent = new Map<string | null, string[]>();
  for (const id of ids) {
    const wi = items[id];
    if (!wi) continue;
    const pid = parentOf(wi) ?? null;
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid)!.push(id);
  }
  for (const siblings of byParent.values()) {
    if (siblings.length < 2) continue;
    const sorted = [...siblings].sort((a, b) => (items[a]?.ranks[backlogId] ?? 0) - (items[b]?.ranks[backlogId] ?? 0));
    let prevEffective = -Infinity;
    for (const id of sorted) {
      const sibling = items[id];
      if (!sibling) continue;
      const sibRank = sibling.ranks[backlogId] ?? 0;
      if (sibRank <= prevEffective) {
        const newRank = prevEffective + 1;
        items[id] = { ...items[id], ranks: { ...items[id].ranks, [backlogId]: newRank } };
        prevEffective = newRank;
      } else {
        prevEffective = sibRank;
      }
    }
  }
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

function queueRankUpsertsForRetry(rows: WorkItemBacklogRankUpsert[]) {
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

function removeQueuedRankUpserts(rows: WorkItemBacklogRankUpsert[]) {
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
const MISSING_ITEM_RANK_RETRY_MS = 2_500;

/**
 * Of the rows naming work items the database did not have, those whose item the
 * app still holds. Those are most likely still being inserted, so their ranks
 * are worth keeping. An item the app no longer has was deleted, and a rank for it
 * orders nothing.
 */
function rankRowsAwaitingInsert<T extends { workItemId: string }>(rows: T[], missingWorkItemIds: string[]): T[] {
  if (missingWorkItemIds.length === 0) return [];
  const missing = new Set(missingWorkItemIds);
  const { workItems } = useAppStore.getState();
  return rows.filter((row) => missing.has(row.workItemId) && !!workItems[row.workItemId]);
}

function persistRankUpserts(rows: WorkItemBacklogRankUpsert[], isRetry = false) {
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
        const { workItems } = useAppStore.getState();
        const current = awaiting.flatMap((row) => {
          const rank = workItems[row.workItemId]?.ranks[row.backlogId];
          return rank === undefined ? [] : [{ ...row, rank }];
        });
        persistRankUpserts(current, true);
      }, MISSING_ITEM_RANK_RETRY_MS);
    }
  });
}

function queueBoardRankUpsertsForRetry(rows: WorkItemBoardRankUpsert[]) {
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

function readPendingBoardRankUpserts(): WorkItemBoardRankUpsert[] {
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

function persistBoardRankUpserts(rows: WorkItemBoardRankUpsert[], isRetry = false) {
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
        const { workItems } = useAppStore.getState();
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
function queuedRankRowsToKeep<T extends { workItemId: string; organizationId: string }>(
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

async function flushPendingRankUpserts(orgId: string) {
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

async function flushPendingBoardRankUpserts(orgId: string) {
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

async function flushPendingWorkItemUpserts(orgId: string, fallbackContainers?: ContainerSnapshot) {
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



export const useAppStore = create<AppState>()((set, get) => {
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
        const [rawData, allHyperlinks, dbChangeLog] = await Promise.all([
          loadFromSupabase(orgId),
          loadHyperlinksForWorkItems([], orgId).catch(() => ({} as Record<string, Hyperlink[]>)),
          loadChangeLog(orgId).catch(() => [] as ChangeLogEntry[]),
        ]);
        const cacheIt = (data: { workItems: Record<string, WorkItem>; backlogs: Record<string, Backlog>; backlogTrees: Record<string, BacklogTree> }, hyperlinks: Record<string, Hyperlink[]>) =>
          writeCachedAppData(orgId, {
            workItems: data.workItems,
            backlogs: data.backlogs,
            backlogTrees: data.backlogTrees,
            hyperlinks,
            changeLog: dbChangeLog as ChangeLogEntry[],
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
          set({
            workItems: cleanData.workItems,
            backlogs: cleanData.backlogs,
            backlogTrees: cleanData.backlogTrees,
            hyperlinks,
            changeLog: dbChangeLog as ChangeLogEntry[],
            // Preserve current selection.
            selectedBacklogIds: get().selectedBacklogIds,
            selectedTreeId: get().selectedTreeId,
            selectedWorkItemIds: get().selectedWorkItemIds,
          });
          saveLoadRankRepairs(rankRepairs, cleanData.workItems, orgId);
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
        // changeLog loaded lazily via loadChangeLog action.
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

    reorderWorkItemAmongSiblings: (workItemId, targetIndex, treeId, backlogIds) => {
      const state = get();
      const orgId = state.organizationId!;
      const mainItem = state.workItems[workItemId];
      if (!mainItem) return;

      const itemsToMoveIds = state.selectedWorkItemIds.includes(workItemId) ? state.selectedWorkItemIds : [workItemId];
      const backlogIdSet = new Set(backlogIds.map((id) => ensureCleanId(id, orgId)));

      // Determine if mainItem is a "root-visible" item in this view: its parent is absent
      // from the backlog context (or has no parent at all).  Items like sub-tasks of a
      // "Collab AI" project that are also tagged for "Today" fall into this category –
      // they appear at the root level of the flat view even though parentId is non-null.
      // In that case we must treat ALL root-visible items as siblings so that moving to
      // top/bottom ranks the item relative to every item shown at that visual level, not
      // just the tiny group that shares the same parentId.
      const mainEffectiveParentId = getEffectiveParentId(mainItem, treeId);
      const mainParentInContext =
        mainEffectiveParentId !== null &&
        backlogIdSet.has(state.workItems[mainEffectiveParentId]?.backlogAssignments[treeId]);

      const allSiblings = Object.values(state.workItems)
        .filter((wi) => {
          if (!backlogIdSet.has(wi.backlogAssignments[treeId])) return false;
          const wiEffectiveParentId = getEffectiveParentId(wi, treeId);
          if (mainParentInContext) {
            // mainItem is a true child inside this context – use standard same-parent matching.
            return wiEffectiveParentId === mainEffectiveParentId;
          }
          // mainItem is root-visible: include every item whose parent is also absent from
          // the backlog context (covers both parentId=null and cross-context sub-tasks).
          const wiParentInContext =
            wiEffectiveParentId !== null &&
            backlogIdSet.has(state.workItems[wiEffectiveParentId]?.backlogAssignments[treeId]);
          return !wiParentInContext;
        })
        .sort((a, b) => {
          const rankDiff = getWorkItemRank(a, treeId) - getWorkItemRank(b, treeId);
          return rankDiff !== 0 ? rankDiff : a.id.localeCompare(b.id);
        });

      const movingSet = new Set(itemsToMoveIds);
      const remaining = allSiblings.filter((s) => !movingSet.has(s.id));
      // targetIndex is a drop-zone index into the *full* sorted sibling list (0 = before
      // the first item, allSiblings.length = after the last item).  To convert it to an
      // insertion index into `remaining` we subtract the number of moving items whose
      // original position in allSiblings was before the target zone.
      const movingBeforeTarget = allSiblings.filter((s, i) => movingSet.has(s.id) && i < targetIndex).length;
      const adjustedTarget = targetIndex - movingBeforeTarget;
      const clampedIdx = Math.max(0, Math.min(adjustedTarget, remaining.length));

      const movingItems = allSiblings.filter((s) => movingSet.has(s.id));
      const reordered = [...remaining];
      reordered.splice(clampedIdx, 0, ...movingItems);

      const updatedItems = { ...state.workItems };

      // Determine the backlog ID for each sibling in this tree context and
      // update only that backlog's rank entry.
      reordered.forEach((s, i) => {
        const blId = updatedItems[s.id].backlogAssignments[treeId];
        if (blId) {
          updatedItems[s.id] = {
            ...updatedItems[s.id],
            ranks: { ...updatedItems[s.id].ranks, [blId]: i },
          };
        }
      });

      // Re-sort the parent's childrenIds to match the new rank order so the
      // tree panel immediately reflects the reordered positions and
      // "bounceback-creep" is prevented (the old childrenIds order would
      // otherwise survive until a realtime event re-sorts it).
      if (mainParentInContext && mainEffectiveParentId && updatedItems[mainEffectiveParentId]) {
        const parent = updatedItems[mainEffectiveParentId];
        const sortedChildren = [...parent.childrenIds].sort((a, b) => {
          const wiA = updatedItems[a];
          const wiB = updatedItems[b];
          if (!wiA || !wiB) return 0;
          const blA = wiA.backlogAssignments[treeId];
          const blB = wiB.backlogAssignments[treeId];
          const rA = blA ? (wiA.ranks[blA] ?? 0) : 0;
          const rB = blB ? (wiB.ranks[blB] ?? 0) : 0;
          return rA !== rB ? rA - rB : a.localeCompare(b);
        });
        updatedItems[mainEffectiveParentId] = { ...parent, childrenIds: sortedChildren };
      }

      // ---- Keep the board consistent with the new list order ---------------
      // Same-status siblings in the same backlog must appear in the same
      // relative order in both views. Redistribute the board-rank slots that
      // group already holds, following the new list order. Items of other
      // statuses keep their board positions untouched.
      const boardMembers = reordered.flatMap((s) => {
        const wi = updatedItems[s.id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) return [];
        return [{ id: wi.id, status: `${blId}::${wi.status}`, rank: wi.boardRanks?.[blId] ?? wi.ranks[blId] ?? 0 }];
      });
      const syncedBoardRanks = redistributeRanksByStatus(boardMembers, reordered.map((s) => s.id));
      const syncedBoardRows: WorkItemBoardRankUpsert[] = [];
      for (const [id, rank] of Object.entries(syncedBoardRanks)) {
        const wi = updatedItems[id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) continue;
        updatedItems[id] = { ...wi, boardRanks: { ...(wi.boardRanks ?? {}), [blId]: rank } };
        syncedBoardRows.push({ workItemId: id, backlogId: blId, rank, organizationId: wi.organizationId ?? orgId });
      }
      if (syncedBoardRows.length > 0) persistBoardRankUpserts(syncedBoardRows);


      persistRankUpserts(
        reordered.flatMap((s) => {
          const updated = updatedItems[s.id];
          const blId = updated.backlogAssignments[treeId];
          if (!blId) return [];
          return { workItemId: updated.id, backlogId: blId, rank: updated.ranks[blId] ?? 0, organizationId: updated.organizationId ?? orgId };
        }),
      );
      internalLog({ action: "Reorder", entityType: "work_item", entityId: workItemId, entityName: mainItem.title, details: `${itemsToMoveIds.length} items moved` });

      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    sortChildrenAlphabetically: (parentId, treeId, backlogIds) => {
      const state = get();
      const orgId = state.organizationId!;
      const backlogIdSet = new Set(backlogIds.map((id) => ensureCleanId(id, orgId)));

      // Collect the siblings at this level using the same visibility logic as
      // reorderWorkItemAmongSiblings: items whose parent is `parentId` (or
      // root-visible items when parentId is null).
      const siblings = Object.values(state.workItems)
        .filter((wi) => {
          if (!backlogIdSet.has(wi.backlogAssignments[treeId])) return false;
          const wiEffectiveParentId = getEffectiveParentId(wi, treeId);
          if (parentId !== null) {
            return wiEffectiveParentId === parentId;
          }
          // Root-visible: parent not present in this backlog context.
          const wiParentInContext =
            wiEffectiveParentId !== null &&
            backlogIdSet.has(state.workItems[wiEffectiveParentId]?.backlogAssignments[treeId]);
          return !wiParentInContext;
        })
        .sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" }));

      get().applySiblingOrder(
        parentId,
        treeId,
        backlogIds,
        siblings.map((s) => s.id),
        `${siblings.length} items sorted alphabetically`,
      );
    },

    applySiblingOrder: (parentId, treeId, _backlogIds, orderedIds, logDetails) => {
      const state = get();
      const orgId = state.organizationId!;
      const siblings = orderedIds.map((id) => state.workItems[id]).filter((wi): wi is WorkItem => !!wi);

      if (siblings.length === 0) return;

      const updatedItems = { ...state.workItems };
      siblings.forEach((s, i) => {
        const blId = updatedItems[s.id].backlogAssignments[treeId];
        if (blId) {
          updatedItems[s.id] = {
            ...updatedItems[s.id],
            ranks: { ...updatedItems[s.id].ranks, [blId]: i },
          };
        }
      });

      // Re-sort the parent's childrenIds to match the alphabetical order.
      if (parentId && updatedItems[parentId]) {
        const newOrder = siblings.map((s) => s.id);
        // Merge any children that weren't in the sorted context (e.g. from
        // other backlogs) at the end so they don't get dropped.
        const otherChildren = updatedItems[parentId].childrenIds.filter(
          (cid) => !newOrder.includes(cid),
        );
        updatedItems[parentId] = {
          ...updatedItems[parentId],
          childrenIds: [...newOrder, ...otherChildren],
        };
      }

      // Keep same-status siblings in the same relative order on the board.
      const sortedBoardMembers = siblings.flatMap((s) => {
        const wi = updatedItems[s.id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) return [];
        return [{ id: wi.id, status: `${blId}::${wi.status}`, rank: wi.boardRanks?.[blId] ?? wi.ranks[blId] ?? 0 }];
      });
      const sortedBoardRanks = redistributeRanksByStatus(sortedBoardMembers, siblings.map((s) => s.id));
      const sortedBoardRows: WorkItemBoardRankUpsert[] = [];
      for (const [id, rank] of Object.entries(sortedBoardRanks)) {
        const wi = updatedItems[id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) continue;
        updatedItems[id] = { ...wi, boardRanks: { ...(wi.boardRanks ?? {}), [blId]: rank } };
        sortedBoardRows.push({ workItemId: id, backlogId: blId, rank, organizationId: wi.organizationId ?? orgId });
      }
      // Only the ranks that changed are written. Saving a list's shown order
      // after an import moves the new items in and shifts the rest — but a
      // re-sort that leaves most of a long list where it was has no need to
      // rewrite all of it.
      const changedBoardRows = sortedBoardRows.filter(
        (row) => state.workItems[row.workItemId]?.boardRanks?.[row.backlogId] !== row.rank,
      );
      if (changedBoardRows.length > 0) persistBoardRankUpserts(changedBoardRows);

      persistRankUpserts(
        siblings.flatMap((s) => {
          const updated = updatedItems[s.id];
          const blId = updated.backlogAssignments[treeId];
          if (!blId) return [];
          const rank = updated.ranks[blId] ?? 0;
          if (state.workItems[s.id]?.ranks[blId] === rank) return [];
          return { workItemId: updated.id, backlogId: blId, rank, organizationId: updated.organizationId ?? orgId };
        }),
      );
      const contextName = parentId ? (state.workItems[parentId]?.title ?? "Unknown Item") : "backlog";
      internalLog({ action: "Sort", entityType: "work_item", entityId: parentId ?? treeId, entityName: contextName, details: logDetails });

      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    reorderWorkItemInBoard: (workItemId, targetIndex, treeId, backlogIds, statusKey) => {
      const state = get();
      const orgId = state.organizationId!;
      const mainItem = state.workItems[workItemId];
      if (!mainItem) return;
      const columnStatus = (statusKey ?? mainItem.status) as WorkItemStatus;

      const itemsToMoveIds = state.selectedWorkItemIds.includes(workItemId) ? state.selectedWorkItemIds : [workItemId];
      const movingSet = new Set(itemsToMoveIds);
      const backlogIdSet = new Set(backlogIds.map((id) => ensureCleanId(id, orgId)));

      // The board column exactly as BoardView draws it: leaf cards of this
      // backlog subtree filed under this column (a status the board has no
      // column for is drawn under Not Started), in the same stable board order
      // over the same Object.values — `targetIndex` is an index into that
      // drawn column. Moving cards from other columns are collected alongside;
      // they are not in the drawn column, so they do not shift the index.
      const columnKeys = new Set(getEffectiveStatuses(backlogIds[0]).map((s) => s.key));
      const columnKey = statusKey ?? boardColumnKey(mainItem.status, columnKeys);
      const isDrawnHere = (wi: WorkItem) => boardColumnKey(wi.status, columnKeys) === columnKey;
      const columnCards = Object.values(state.workItems)
        .filter((wi) => {
          const blId = wi.backlogAssignments[treeId];
          if (!blId || !backlogIdSet.has(blId)) return false;
          if (wi.childrenIds.length > 0) return false;
          return isDrawnHere(wi) || movingSet.has(wi.id);
        })
        .sort(byBoardRank(treeId));

      const remaining = columnCards.filter((c) => !movingSet.has(c.id));
      const drawnColumn = columnCards.filter(isDrawnHere);
      const movingBeforeTarget = drawnColumn.filter((c, i) => movingSet.has(c.id) && i < targetIndex).length;
      const clampedIdx = Math.max(0, Math.min(targetIndex - movingBeforeTarget, remaining.length));
      const movingItems = columnCards.filter((c) => movingSet.has(c.id));
      const newColumn = [...remaining];
      newColumn.splice(clampedIdx, 0, ...movingItems);

      const updatedItems = { ...state.workItems };
      const boardRows: WorkItemBoardRankUpsert[] = [];
      newColumn.forEach((c, i) => {
        const wi = updatedItems[c.id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) return;
        updatedItems[c.id] = {
          ...wi,
          status: movingSet.has(c.id) ? columnStatus : wi.status,
          boardRanks: { ...(wi.boardRanks ?? {}), [blId]: i },
        };
        boardRows.push({ workItemId: c.id, backlogId: blId, rank: i, organizationId: wi.organizationId ?? orgId });
      });
      if (boardRows.length > 0) persistBoardRankUpserts(boardRows);

      // ---- Feed the new column order back into the list ranks --------------
      // Only cards that share a list context (same backlog + same effective
      // parent) and the same status can express this order in the list, so the
      // list positions those cards hold are handed round inside each such
      // group. Everything else in the list stays where it was; its ranks change
      // only where shared ranks must be split (see listRanksFollowingColumn).
      const listGroupOf = (wi: WorkItem): string | null => {
        const blId = wi.backlogAssignments[treeId];
        return blId ? `${blId}::${getEffectiveParentId(wi, treeId) ?? "root"}` : null;
      };
      const columnGroups = new Set(newColumn.flatMap((c) => {
        const key = updatedItems[c.id] ? listGroupOf(updatedItems[c.id]) : null;
        return key ? [key] : [];
      }));
      const groupSiblings = new Map<string, WorkItem[]>();
      for (const wi of Object.values(updatedItems)) {
        const key = listGroupOf(wi);
        if (!key || !columnGroups.has(key)) continue;
        const list = groupSiblings.get(key) ?? [];
        list.push(wi);
        groupSiblings.set(key, list);
      }
      const columnOrder = newColumn.map((c) => c.id);
      const syncedListRanks: Record<string, number> = {};
      // Groups whose order changed are written whole, not just the ranks that
      // changed — as a list drop writes all the siblings. Loading repairs
      // shared ranks in memory only (dedupWorkItemRanksInPlace), so a rank the
      // drop leaves alone may still differ in the database; written alone, the
      // changed ranks could land on it and share it again (seen live).
      const rewrittenGroups: WorkItem[][] = [];
      for (const siblings of groupSiblings.values()) {
        const changed = listRanksFollowingColumn(
          siblings.sort(byRank(treeId)).map((wi) => ({ id: wi.id, rank: wi.ranks[wi.backlogAssignments[treeId]] ?? 0 })),
          columnOrder,
        );
        if (Object.keys(changed).length === 0) continue;
        Object.assign(syncedListRanks, changed);
        rewrittenGroups.push(siblings);
      }
      const touchedParents = new Set<string>();
      for (const [id, rank] of Object.entries(syncedListRanks)) {
        const wi = updatedItems[id];
        const blId = wi?.backlogAssignments[treeId];
        if (!wi || !blId) continue;
        updatedItems[id] = { ...wi, ranks: { ...wi.ranks, [blId]: rank } };
        const parent = getEffectiveParentId(updatedItems[id], treeId);
        if (parent) touchedParents.add(parent);
      }
      const listRows: WorkItemBacklogRankUpsert[] = rewrittenGroups.flat().flatMap((s) => {
        const wi = updatedItems[s.id];
        const blId = wi?.backlogAssignments[treeId];
        const rank = blId ? wi.ranks[blId] : undefined;
        if (!wi || !blId || rank === undefined) return [];
        return [{ workItemId: wi.id, backlogId: blId, rank, organizationId: wi.organizationId ?? orgId }];
      });
      if (listRows.length > 0) persistRankUpserts(listRows);

      // Save the moved cards — only now, with their new list ranks. A work
      // item save writes the item's list ranks as well, after the item row,
      // so it lands after the rank rows above: saved from before the ranks
      // were set, it put the card's old list rank back (seen live: the card
      // then shared a rank with the item that had been given its old one).
      // A card whose status changed is saved for that; a card whose list rank
      // changed is saved again too, because a "board-column" drop has already
      // queued a save from setWorkItemStatus, made with the old rank, and the
      // queue saves in order.
      for (const id of itemsToMoveIds) {
        const before = state.workItems[id];
        const after = updatedItems[id];
        if (!before || !after) continue;
        if (before.status !== after.status || syncedListRanks[id] !== undefined) {
          upsertWorkItem(after, orgId);
        }
      }

      // Keep parents' childrenIds in sync with the new list ranks.
      for (const parentId of touchedParents) {
        const parent = updatedItems[parentId];
        if (!parent) continue;
        const sortedChildren = [...parent.childrenIds].sort((a, b) => {
          const wiA = updatedItems[a];
          const wiB = updatedItems[b];
          if (!wiA || !wiB) return 0;
          const blA = wiA.backlogAssignments[treeId];
          const blB = wiB.backlogAssignments[treeId];
          const rA = blA ? (wiA.ranks[blA] ?? 0) : 0;
          const rB = blB ? (wiB.ranks[blB] ?? 0) : 0;
          return rA !== rB ? rA - rB : a.localeCompare(b);
        });
        updatedItems[parentId] = { ...parent, childrenIds: sortedChildren };
      }

      internalLog({ action: "Board Reorder", entityType: "work_item", entityId: workItemId, entityName: mainItem.title, details: `${itemsToMoveIds.length} items moved` });

      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    moveWorkItemToBacklog: (workItemId, targetBacklogId, targetTreeId, strategy = "move", sourceTreeId) => {
      get().moveWorkItemsToBacklog([workItemId], targetBacklogId, targetTreeId, strategy, sourceTreeId);
    },

    moveWorkItemsToBacklog: (workItemIds, targetBacklogId, targetTreeId, strategy = "move", sourceTreeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const cleanTargetBl = ensureCleanId(targetBacklogId, orgId);

      const requested = new Set(workItemIds.filter((id) => state.workItems[id]));
      if (requested.size === 0) return;

      // Only move the topmost requested items — descendants follow their root.
      const roots = [...requested].filter((id) => {
        let p = getEffectiveParentId(state.workItems[id], targetTreeId);
        const seen = new Set<string>();
        while (p && !seen.has(p)) {
          if (requested.has(p)) return false;
          seen.add(p);
          const parent = state.workItems[p];
          if (!parent) break;
          p = getEffectiveParentId(parent, targetTreeId);
        }
        return true;
      });
      if (roots.length === 0) return;

      // Preserve the roots' current source-list order in the destination.
      const sourceRankOf = (wi: WorkItem): number => {
        const bl = wi.backlogAssignments[targetTreeId] ?? (sourceTreeId ? wi.backlogAssignments[sourceTreeId] : undefined);
        return bl ? (wi.ranks[bl] ?? 0) : 0;
      };
      roots.sort((a, b) => {
        const diff = sourceRankOf(state.workItems[a]) - sourceRankOf(state.workItems[b]);
        return diff !== 0 ? diff : a.localeCompare(b);
      });
      const rootOrder = new Map(roots.map((id, i) => [id, i]));

      const updatedItems = { ...state.workItems };
      const changed: WorkItem[] = [];
      const changedIndex = new Map<string, number>();
      const pushChanged = (wi: WorkItem) => {
        const idx = changedIndex.get(wi.id);
        if (idx === undefined) {
          changedIndex.set(wi.id, changed.length);
          changed.push(wi);
        } else {
          changed[idx] = wi;
        }
      };
      const removedRanks: Array<{ workItemId: string; backlogId: string }> = [];
      const movedIds = new Set<string>();
      /** Moved items in the destination already — mirrored there — which keep their place in it. */
      const alreadyInDest = new Set<string>();
      /** Previous rank of each moved item, used for stable ordering. */
      const previousRank = new Map<string, number>();

      const destStatuses = getEffectiveStatuses(cleanTargetBl);
      const destStatusKeys = new Set(destStatuses.map((s) => s.key));

      const moveRecursive = (id: string, isRoot: boolean, isCrossTreeMove: boolean) => {
        const wi = updatedItems[id];
        if (!wi) return;
        const oldBlId = wi.backlogAssignments[targetTreeId];
        // Only reassign descendants that actually live in this tree — otherwise
        // we'd add a stray tree assignment to items belonging elsewhere.
        // Exception: on a cross-tree move the root (and its descendants) are new
        // to targetTreeId, so they must be included to gain the tree context.
        if (!isRoot && !oldBlId && !isCrossTreeMove) return;

        const newRanks = { ...wi.ranks };
        const newBoardRanks = { ...(wi.boardRanks ?? {}) };
        previousRank.set(id, oldBlId ? (wi.ranks[oldBlId] ?? 0) : (wi.ranks[cleanTargetBl] ?? 0));
        if (oldBlId === cleanTargetBl) alreadyInDest.add(id);
        if (oldBlId && oldBlId !== cleanTargetBl) {
          delete newRanks[oldBlId];
          delete newBoardRanks[oldBlId];
          removedRanks.push({ workItemId: id, backlogId: oldBlId });
        }
        // Placeholder — final rank is assigned in the placement pass below.
        newRanks[cleanTargetBl] = newRanks[cleanTargetBl] ?? 0;

        const remappedStatus = destStatusKeys.has(wi.status) ? wi.status : ('not_started' as WorkItemStatus);
        updatedItems[id] = {
          ...wi,
          status: remappedStatus,
          backlogAssignments: { ...wi.backlogAssignments, [targetTreeId]: cleanTargetBl },
          ranks: newRanks,
          boardRanks: newBoardRanks,
        };
        movedIds.add(id);
        pushChanged(updatedItems[id]);
        wi.childrenIds.forEach((childId) => moveRecursive(childId, false, isCrossTreeMove));
      };

      const firstRoot = state.workItems[roots[0]];
      for (const rootId of roots) {
        const rootItem = updatedItems[rootId];
        if (!rootItem) continue;
        moveRecursive(rootId, true, !rootItem.backlogAssignments[targetTreeId]);
      }

      // Placement: give the moved items fractional ranks *below* the existing
      // minimum of their destination sibling group.  Pre-existing destination
      // items keep their exact ranks, so nothing else shifts.
      const boardRows: WorkItemBoardRankUpsert[] = [];
      const movedByParent = new Map<string | null, string[]>();
      for (const id of movedIds) {
        if (alreadyInDest.has(id)) continue;
        const pid = getEffectiveParentId(updatedItems[id], targetTreeId) ?? null;
        if (!movedByParent.has(pid)) movedByParent.set(pid, []);
        movedByParent.get(pid)!.push(id);
      }
      const destMinByParent = new Map<string | null, number>();
      for (const wi of Object.values(updatedItems)) {
        if (movedIds.has(wi.id) && !alreadyInDest.has(wi.id)) continue;
        if (wi.backlogAssignments[targetTreeId] !== cleanTargetBl) continue;
        const pid = getEffectiveParentId(wi, targetTreeId) ?? null;
        const r = wi.ranks[cleanTargetBl];
        if (typeof r !== "number") continue;
        const current = destMinByParent.get(pid);
        if (current === undefined || r < current) destMinByParent.set(pid, r);
      }
      for (const [pid, ids] of movedByParent) {
        const ordered = [...ids].sort((a, b) => {
          const oA = rootOrder.get(a);
          const oB = rootOrder.get(b);
          if (oA !== undefined && oB !== undefined) return oA - oB;
          const diff = (previousRank.get(a) ?? 0) - (previousRank.get(b) ?? 0);
          return diff !== 0 ? diff : a.localeCompare(b);
        });
        const destMin = destMinByParent.get(pid);
        const base = destMin === undefined ? 0 : destMin - ordered.length;
        ordered.forEach((id, i) => {
          const wi = updatedItems[id];
          if (!wi) return;
          const rank = base + i;
          updatedItems[id] = {
            ...wi,
            ranks: { ...wi.ranks, [cleanTargetBl]: rank },
            boardRanks: { ...(wi.boardRanks ?? {}), [cleanTargetBl]: rank },
          };
          pushChanged(updatedItems[id]);
          boardRows.push({
            workItemId: id,
            backlogId: cleanTargetBl,
            rank,
            organizationId: wi.organizationId ?? orgId,
          });
        });
      }

      // For cross-tree "move" (not mirror): remove the source tree assignment from
      // all moved items so they no longer appear in the source tree.
      if (strategy === "move" && sourceTreeId && sourceTreeId !== targetTreeId) {
        for (const wi of [...changed]) {
          const sourceBl = wi.backlogAssignments[sourceTreeId];
          if (!sourceBl) continue;
          const newAssignments = { ...wi.backlogAssignments };
          delete newAssignments[sourceTreeId];
          const newRanks = { ...wi.ranks };
          delete newRanks[sourceBl];
          const newBoardRanks = { ...(wi.boardRanks ?? {}) };
          delete newBoardRanks[sourceBl];
          removedRanks.push({ workItemId: wi.id, backlogId: sourceBl });
          const updated = { ...wi, backlogAssignments: newAssignments, ranks: newRanks, boardRanks: newBoardRanks };
          updatedItems[wi.id] = updated;
          pushChanged(updated);
        }
      }

      upsertWorkItems(changed, orgId);
      if (boardRows.length > 0) persistBoardRankUpserts(boardRows);
      // Clean up stale rank rows in the DB for backlogs that items were moved out of.
      deleteWorkItemBacklogRanks(removedRanks);

      const oldBacklogId = firstRoot?.backlogAssignments[targetTreeId];
      const oldBacklogName = oldBacklogId ? state.backlogs[oldBacklogId]?.name : '?';
      const newBacklogName = state.backlogs[cleanTargetBl]?.name ?? cleanTargetBl;
      internalLog({
        action: "Move to List",
        entityType: "work_item",
        entityId: roots[0],
        entityName: roots.length === 1 ? (firstRoot?.title ?? roots[0]) : `${roots.length} items`,
        details: `list: "${oldBacklogName}" → "${newBacklogName}"`,
      });
      // A move that takes the selected item off screen leaves the selection
      // where the eye already is: the row below it, or the one above when it
      // was last. A mirror leaves the item in place, so it keeps its selection,
      // and so does a move within the backlogs on screen.
      const selectionAfterMove = (() => {
        if (strategy === "mirror") return null;
        if (!state.selectedWorkItemIds.some((id) => movedIds.has(id))) return null;
        const staysOnScreen =
          targetTreeId === state.selectedTreeId &&
          shownBacklogIds(state.backlogs, state.selectedBacklogIds).has(cleanTargetBl);
        if (staysOnScreen) return null;
        const next = computeNextWorkItemSelection(movedIds, "down");
        return next ? [next] : [];
      })();

      set({
        workItems: updatedItems,
        ...(selectionAfterMove ? { selectedWorkItemIds: selectionAfterMove } : {}),
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },


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

    duplicateWorkItems: (workItemIds) => {
      const state = get();
      const orgId = state.organizationId;
      if (!orgId || workItemIds.length === 0) return [];

      // Keep only top-level items in the selection — if both an ancestor and a
      // descendant are selected, the descendant will be duplicated as part of
      // the ancestor's subtree, so skip it as an explicit root.
      const idsSet = new Set(workItemIds);
      const roots = workItemIds.filter((id) => {
        const wi = state.workItems[id];
        if (!wi) return false;
        let p = wi.parentId;
        while (p) {
          if (idsSet.has(p)) return false;
          p = state.workItems[p]?.parentId ?? null;
        }
        return true;
      });
      if (roots.length === 0) return [];

      const updatedWorkItems = { ...state.workItems };
      const updatedHyperlinks = { ...state.hyperlinks };
      const itemsToUpdateInDB: WorkItem[] = [];
      const newHyperlinksToUpsert: { link: Hyperlink; itemOrgId?: string }[] = [];
      const oldToNew = new Map<string, string>();
      const newRootIds: string[] = [];

      const cloneSubtree = (oldId: string, newParentId: string | null): string | null => {
        const src = updatedWorkItems[oldId];
        if (!src) return null;
        const newId = ensureCleanId(`wi-${crypto.randomUUID().slice(0, 8)}`, orgId);
        oldToNew.set(oldId, newId);

        const copy: WorkItem = {
          id: newId,
          title: src.title,
          description: src.description,
          points: src.points,
          rating: src.rating,
          deadline: src.deadline,
          // A copy is made today, whenever its original was.
          createdOn: toIsoDate(new Date()),
          status: src.status,
          parentId: newParentId,
          // Drop per-tree parent overrides on the clone — they reference the
          // source's tree-context which doesn't apply to the new item.
          parentIds: undefined,
          childrenIds: [],
          backlogAssignments: { ...src.backlogAssignments },
          ranks: { ...src.ranks },
          organizationId: src.organizationId,
          respawnEnabled: src.respawnEnabled,
          respawnIntervalDays: src.respawnIntervalDays,
          respawnHour: src.respawnHour,
          respawnMinute: src.respawnMinute,
          // Don't carry over last-triggered timestamp — the clone is a fresh item.
          respawnLastTriggeredAt: undefined,
        };
        updatedWorkItems[newId] = copy;

        // Clone children (using source's childrenIds — pre-clone snapshot).
        const sourceChildIds = [...src.childrenIds];
        for (const childOldId of sourceChildIds) {
          if (!updatedWorkItems[childOldId]) continue;
          const newChildId = cloneSubtree(childOldId, newId);
          if (newChildId) {
            updatedWorkItems[newId] = {
              ...updatedWorkItems[newId],
              childrenIds: [...updatedWorkItems[newId].childrenIds, newChildId],
            };
          }
        }

        itemsToUpdateInDB.push(updatedWorkItems[newId]);

        // Copy hyperlinks.
        const links = state.hyperlinks[oldId];
        if (links && links.length > 0) {
          const newLinks: Hyperlink[] = links.map((l) => ({
            id: crypto.randomUUID(),
            workItemId: newId,
            url: l.url,
            altText: l.altText,
            rank: l.rank,
          }));
          updatedHyperlinks[newId] = newLinks;
          newLinks.forEach((nl) => newHyperlinksToUpsert.push({ link: nl, itemOrgId: src.organizationId }));
        }

        return newId;
      };

      for (const rootId of roots) {
        const orig = updatedWorkItems[rootId];
        if (!orig) continue;

        // Shift later siblings in every backlog the original is in to make room
        // for the clone at (originalRank + 1).
        const copyRanks: Record<string, number> = {};
        for (const [, blId] of Object.entries(orig.backlogAssignments)) {
          const insertRank = (orig.ranks[blId] ?? 0) + 1;
          copyRanks[blId] = insertRank;
          const toShift = buildCascadedShiftSet(updatedWorkItems, orig.parentId, insertRank, rootId, blId);
          toShift.forEach((sid) => {
            const wi = updatedWorkItems[sid];
            const shifted = { ...wi, ranks: { ...wi.ranks, [blId]: (wi.ranks[blId] ?? 0) + 1 } };
            updatedWorkItems[sid] = shifted;
            itemsToUpdateInDB.push(shifted);
          });
        }

        const newRootId = cloneSubtree(rootId, orig.parentId);
        if (!newRootId) continue;

        // Override the cloned root's ranks with the computed insert ranks.
        updatedWorkItems[newRootId] = { ...updatedWorkItems[newRootId], ranks: copyRanks };
        const idx = itemsToUpdateInDB.findIndex((wi) => wi.id === newRootId);
        if (idx !== -1) itemsToUpdateInDB[idx] = updatedWorkItems[newRootId];

        newRootIds.push(newRootId);

        if (orig.parentId && updatedWorkItems[orig.parentId]) {
          updatedWorkItems[orig.parentId] = {
            ...updatedWorkItems[orig.parentId],
            childrenIds: [...updatedWorkItems[orig.parentId].childrenIds, newRootId],
          };
        }
      }

      upsertWorkItems(itemsToUpdateInDB, orgId);
      newHyperlinksToUpsert.forEach(({ link, itemOrgId }) => upsertHyperlink(link, orgId, itemOrgId));

      internalLog({
        action: "Duplicate",
        entityType: "work_item",
        entityId: newRootIds[0],
        entityName: state.workItems[roots[0]]?.title,
        details: `${roots.length} root(s), ${oldToNew.size} total`,
      });

      set({
        workItems: updatedWorkItems,
        hyperlinks: updatedHyperlinks,
        selectedWorkItemIds: newRootIds,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });

      // Asynchronously copy labels / team assignments / financials from each
      // source item to its clone via the respective stores (dynamic imports
      // avoid circular deps).
      void import("./labelsStore").then(({ useLabelsStore }) => {
        const ls = useLabelsStore.getState();
        oldToNew.forEach((newId, oldId) => {
          const labelIds = ls.byEntity[`work_item:${oldId}`] ?? [];
          labelIds.forEach((lid) => {
            const label = ls.labels[lid];
            if (label) ls.assignLabel(lid, "work_item", newId, label.organizationId);
          });
        });
      });
      void import("./teamStore").then(({ useTeamStore }) => {
        const ts = useTeamStore.getState();
        oldToNew.forEach((newId, oldId) => {
          const teamIds = ts.workItemTeams[oldId] ?? [];
          teamIds.forEach((tid) => {
            const team = ts.teams.find((t) => t.id === tid);
            const teamOrgId = (team as unknown as { organization_id?: string } | undefined)?.organization_id;
            const itemOrgId = updatedWorkItems[newId]?.organizationId ?? orgId;
            ts.assignTeamToWorkItem(newId, tid, teamOrgId || itemOrgId);
          });
        });
      });
      void import("./financialsStore").then(({ useFinancialsStore }) => {
        const fs = useFinancialsStore.getState();
        oldToNew.forEach((newId, oldId) => {
          const entry = fs.byWorkItem[oldId];
          if (!entry) return;
          const itemOrgId = updatedWorkItems[newId]?.organizationId ?? orgId;
          fs.upsert(newId, itemOrgId, {
            savingsByMonth: { ...entry.savingsByMonth },
            incomeByMonth: { ...entry.incomeByMonth },
            actualSavingsByMonth: { ...entry.actualSavingsByMonth },
            actualIncomeByMonth: { ...entry.actualIncomeByMonth },
            currency: entry.currency,
          });
        });
      });

      return newRootIds;
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

    removeWorkItemFromTree: (workItemId, treeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;

      const updatedItems = { ...state.workItems };
      const toUpsert: WorkItem[] = [];
      const idsToDelete: string[] = [];

      const processItem = (id: string) => {
        const wi = updatedItems[id];
        if (!wi) return;
        const newAssignments = { ...wi.backlogAssignments };
        const removedBlId = newAssignments[treeId];
        delete newAssignments[treeId];
        if (Object.keys(newAssignments).length === 0) {
          // No remaining tree assignments: delete this item, but recurse into
          // children via processItem instead of blindly collecting the whole
          // subtree — children that still have assignments in other trees must
          // be preserved and reparented rather than deleted.
          idsToDelete.push(id);
          wi.childrenIds.forEach(processItem);
        } else {
          const newRanks = { ...wi.ranks };
          if (removedBlId) delete newRanks[removedBlId];
          updatedItems[id] = { ...wi, backlogAssignments: newAssignments, ranks: newRanks };
          toUpsert.push(updatedItems[id]);
          updatedItems[id].childrenIds.forEach(processItem);
        }
      };

      processItem(workItemId);

      if (idsToDelete.length > 0) {
        const deleteSet = new Set(idsToDelete);
        idsToDelete.forEach((deletedId) => {
          const deletedItem = state.workItems[deletedId];
          if (deletedItem?.parentId && !deleteSet.has(deletedItem.parentId) && updatedItems[deletedItem.parentId]) {
            updatedItems[deletedItem.parentId] = {
              ...updatedItems[deletedItem.parentId],
              childrenIds: updatedItems[deletedItem.parentId].childrenIds.filter((id) => id !== deletedId),
            };
          }
          delete updatedItems[deletedId];
        });

        // Reparent orphaned survivors: kept items whose immediate parent was
        // deleted (because it had no remaining assignments).  Walk up the
        // original ancestor chain to find the nearest surviving ancestor.
        repairOrphanedSurvivors(updatedItems, deleteSet, state.workItems, (updated) => {
          toUpsert.push(updated);
        });

        persistWorkItemDeletes(idsToDelete)?.catch((err) => console.error("Delete work item failed", err));
      }
      if (toUpsert.length > 0) {
        upsertWorkItems(toUpsert, orgId);
      }

      const treeName = state.backlogTrees[treeId]?.name ?? treeId;
      internalLog({ action: "Remove from Tree", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `tree: "${treeName}"` });
      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    removeWorkItemsFromTreeBulk: (items) => {
      const state = get();
      const orgId = state.organizationId!;
      if (items.length === 0) return;

      const updatedItems = { ...state.workItems };
      const toUpsert: WorkItem[] = [];
      const allIdsToDelete: string[] = [];
      // Ids that leave the tree on screen, so the selection can follow them
      // the way it follows a move or a delete.
      const leftTheShownTree = new Set<string>();

      for (const { workItemId, treeId } of items) {
        if (!state.workItems[workItemId]) continue;

        const processItem = (id: string) => {
          const wi = updatedItems[id];
          if (!wi) return;
          if (treeId === state.selectedTreeId) leftTheShownTree.add(id);
          const newAssignments = { ...wi.backlogAssignments };
          const removedBlId = newAssignments[treeId];
          delete newAssignments[treeId];
          if (Object.keys(newAssignments).length === 0) {
            allIdsToDelete.push(id);
            wi.childrenIds.forEach(processItem);
          } else {
            const newRanks = { ...wi.ranks };
            if (removedBlId) delete newRanks[removedBlId];
            updatedItems[id] = { ...wi, backlogAssignments: newAssignments, ranks: newRanks };
            toUpsert.push(updatedItems[id]);
            updatedItems[id].childrenIds.forEach(processItem);
          }
        };

        processItem(workItemId);
      }

      if (allIdsToDelete.length > 0) {
        const deleteSet = new Set(allIdsToDelete);
        allIdsToDelete.forEach((deletedId) => {
          const deletedItem = state.workItems[deletedId];
          if (deletedItem?.parentId && !deleteSet.has(deletedItem.parentId) && updatedItems[deletedItem.parentId]) {
            updatedItems[deletedItem.parentId] = {
              ...updatedItems[deletedItem.parentId],
              childrenIds: updatedItems[deletedItem.parentId].childrenIds.filter((id) => !deleteSet.has(id)),
            };
          }
          delete updatedItems[deletedId];
        });

        repairOrphanedSurvivors(updatedItems, deleteSet, state.workItems, (updated) => {
          toUpsert.push(updated);
        });

        persistWorkItemDeletes(allIdsToDelete)?.catch((err) => console.error("Bulk remove from tree failed", err));
      }
      if (toUpsert.length > 0) {
        upsertWorkItems(toUpsert, orgId);
      }

      internalLog({ action: "Remove from Tree", entityType: "work_item", entityId: items[0].workItemId, entityName: `${items.length} items` });

      // As with a move: the selection lands on the row below what left, or
      // the one above when it was last.
      const nextSelected = state.selectedWorkItemIds.some((id) => leftTheShownTree.has(id))
        ? computeNextWorkItemSelection(leftTheShownTree, "down")
        : undefined;

      set({
        workItems: updatedItems,
        ...(nextSelected === undefined ? {} : { selectedWorkItemIds: nextSelected ? [nextSelected] : [] }),
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    reparentWorkItem: (workItemId, newParentId, treeId, backlogId, strategy, rank) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updatedItems = { ...state.workItems };

      // IDs of descendants that were migrated (for DB upsert in move-to-tree).
      const changedDescendantIds: string[] = [];

      // Whether the item lives in more than one tree — drives whether we use a
      // global or per-tree parent change.
      const isMultiTree = Object.keys(item.backlogAssignments).length > 1;

      if (strategy === "move-to-tree" && treeId && backlogId) {
        // Move item + entire subtree to the new tree's backlog, removing all old
        // tree assignments.  Because the item becomes single-tree, it is safe to
        // update the global parentId; also clear any per-tree overrides.
        const cleanBlId = ensureCleanId(backlogId, orgId);

        // Remove from old global parent's childrenIds
        if (item.parentId && updatedItems[item.parentId]) removeChild(updatedItems, item.parentId, workItemId);
        // Also remove from any per-tree parent entries that differ from global
        if (item.parentIds) {
          for (const treeParentId of Object.values(item.parentIds)) {
            if (treeParentId && treeParentId !== item.parentId && updatedItems[treeParentId]) removeChild(updatedItems, treeParentId, workItemId);
          }
        }
        // Add to new parent
        addChild(updatedItems, newParentId, workItemId);

        // Compute rank for the root item as max+1 among siblings in the new backlog.
        const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, treeId, cleanBlId!);

        updatedItems[workItemId] = {
          ...item,
          parentId: newParentId,
          parentIds: {},
          backlogAssignments: { [treeId]: cleanBlId },
          ranks: { [cleanBlId]: nextRank },
        };

        // Recursively migrate all descendants: replace all tree assignments with
        // { treeId: cleanBlId }, preserving relative rank order.
        const migrateDescendants = (id: string) => {
          const wi = updatedItems[id];
          if (!wi) return;
          // Use the first available rank as a hint to preserve relative ordering.
          const oldRank = Object.values(wi.ranks)[0] ?? 0;
          updatedItems[id] = {
            ...wi,
            parentIds: {},
            backlogAssignments: { [treeId]: cleanBlId },
            ranks: { [cleanBlId]: oldRank },
          };
          changedDescendantIds.push(id);
          wi.childrenIds.forEach(migrateDescendants);
        };
        item.childrenIds.forEach(migrateDescendants);

        // Siblings that came from different lists may now clash: spread them.
        spreadMergedSiblingRanks(updatedItems, changedDescendantIds, cleanBlId, (wi) => wi.parentId ?? null);
      } else if (strategy === "mirror" && treeId && backlogId) {
        // Add the new tree assignment while keeping all existing ones.
        // DON'T change the global parentId — store the new parent as a per-tree
        // override so existing tree relationships are undisturbed.
        const cleanBlId = ensureCleanId(backlogId, orgId);

        // Add to new parent's childrenIds only (leave old parent's list intact).
        addChild(updatedItems, newParentId, workItemId);

        // Compute rank in the new backlog context.
        const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, treeId, cleanBlId!);

        updatedItems[workItemId] = {
          ...item,
          parentIds: { ...item.parentIds, [treeId]: newParentId },
          backlogAssignments: { ...item.backlogAssignments, [treeId]: cleanBlId },
          ranks: { ...item.ranks, [cleanBlId]: nextRank },
        };
      } else {
        // Same-tree reparent (no cross-tree strategy).
        const cleanBlId = treeId && backlogId ? ensureCleanId(backlogId, orgId) : null;
        const currentBlId = treeId ? item.backlogAssignments[treeId] : null;
        const isBacklogChange = cleanBlId !== null && treeId !== undefined && currentBlId !== null && currentBlId !== cleanBlId;

        // Effective parent of this item in the tree being operated on (before update).
        const oldEffectiveParentId = treeId ? getEffectiveParentId(item, treeId) : item.parentId;

        if (isMultiTree && treeId) {
          // Multi-tree item: only change the parent relationship for this specific
          // tree to avoid inadvertently changing it in all other trees.

          // Only remove item from the old effective parent's childrenIds when that
          // parent is no longer referenced by any other tree on this item.
          const isOldParentStillNeeded = Object.keys(item.backlogAssignments)
            .filter((tid) => tid !== treeId)
            .some((tid) => getEffectiveParentId(item, tid) === oldEffectiveParentId);

          if (!isOldParentStillNeeded && oldEffectiveParentId && updatedItems[oldEffectiveParentId]) removeChild(updatedItems, oldEffectiveParentId, workItemId);
          addChild(updatedItems, newParentId, workItemId);

          if (isBacklogChange) {
            // Same-tree reparent into a different backlog: migrate the item and all
            // its descendants to the new backlog, replacing the old assignment for
            // this tree (same logic as move-to-tree but scoped to one tree).
            const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, treeId, cleanBlId!);

            const newRanks = { ...item.ranks };
            delete newRanks[currentBlId!];
            newRanks[cleanBlId!] = nextRank;
            updatedItems[workItemId] = {
              ...item,
              parentIds: { ...item.parentIds, [treeId]: newParentId },
              backlogAssignments: { ...item.backlogAssignments, [treeId]: cleanBlId! },
              ranks: newRanks,
            };

            // Its descendants go with it, in this tree only, keeping their ranks —
            // spread where siblings from different lists now clash.
            changedDescendantIds.push(...moveDescendantsToList(updatedItems, item.childrenIds, treeId, cleanBlId!));
            spreadMergedSiblingRanks(updatedItems, changedDescendantIds, cleanBlId!, (wi) => getEffectiveParentId(wi, treeId));
          } else {
            // Same-tree, same-backlog reparent for a multi-tree item: only update
            // the rank for the current tree's backlog (avoid touching other trees).
            const blId = item.backlogAssignments[treeId] ?? null;
            const newRanks = { ...item.ranks };
            if (blId) {
              const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, treeId, blId);
              newRanks[blId] = nextRank;
            }
            updatedItems[workItemId] = {
              ...item,
              parentIds: { ...item.parentIds, [treeId]: newParentId },
              ranks: newRanks,
            };
          }
        } else {
          // Single-tree item (or no treeId context): update the global parentId as
          // before.  This preserves unchanged behaviour for the common case.

          // Determine the true old parent in this tree, honoring per-tree overrides.
          const singleTreeOldParentId = treeId
            ? getEffectiveParentId(item, treeId)
            : item.parentId;

          // Remove from old parent (effective, not just global)
          if (singleTreeOldParentId && updatedItems[singleTreeOldParentId]) removeChild(updatedItems, singleTreeOldParentId, workItemId);
          // Add to new parent
          addChild(updatedItems, newParentId, workItemId);

          // If a treeId was provided, clear any stale per-tree parent override for
          // it so the new global parentId is honored in that tree. Without this,
          // an existing override silently keeps pointing at the old parent and the
          // reparent appears to do nothing in the UI.
          const clearedParentIds = (() => {
            if (!treeId || !item.parentIds || !(treeId in item.parentIds)) {
              return item.parentIds;
            }
            const next = { ...item.parentIds };
            delete next[treeId];
            return next;
          })();


          if (isBacklogChange) {
            // Same-tree reparent into a different backlog: migrate the item and all
            // its descendants to the new backlog, replacing the old assignment for
            // this tree (same logic as move-to-tree but scoped to one tree).
            const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, treeId!, cleanBlId!);

            const newRanks = { ...item.ranks };
            delete newRanks[currentBlId!];
            newRanks[cleanBlId!] = nextRank;
            updatedItems[workItemId] = {
              ...item,
              parentId: newParentId,
              parentIds: clearedParentIds,
              backlogAssignments: { ...item.backlogAssignments, [treeId!]: cleanBlId! },
              ranks: newRanks,
            };

            // Its descendants go with it, in this tree only, keeping their ranks —
            // spread where siblings from different lists now clash.
            changedDescendantIds.push(...moveDescendantsToList(updatedItems, item.childrenIds, treeId!, cleanBlId!));
            spreadMergedSiblingRanks(updatedItems, changedDescendantIds, cleanBlId!, (wi) => getEffectiveParentId(wi, treeId!));
          } else {
            // Same-tree, same-backlog reparent: assign a rank that avoids conflicts
            // with existing siblings in the new parent's context for every backlog
            // the item belongs to.
            // When rank is provided (e.g. from the outdent handler), insert the item
            // at that specific position and cascade-shift later siblings.
            const newRanks = { ...item.ranks };
            if (rank !== undefined) {
              for (const [tId, blId] of Object.entries(item.backlogAssignments)) {
                const toShift = buildCascadedShiftSet(
                  updatedItems, newParentId, rank, workItemId, blId, tId,
                );
                toShift.forEach((sid) => {
                  const sWi = updatedItems[sid];
                  const shifted = { ...sWi, ranks: { ...sWi.ranks, [blId]: (sWi.ranks[blId] ?? 0) + 1 } };
                  updatedItems[sid] = shifted;
                });
                newRanks[blId] = rank;
              }
            } else {
              for (const [tId, blId] of Object.entries(item.backlogAssignments)) {
                const nextRank = nextRankAmongSiblings(state.workItems, workItemId, newParentId, tId, blId);
                newRanks[blId] = nextRank;
              }
            }
            updatedItems[workItemId] = { ...item, parentId: newParentId, parentIds: clearedParentIds, ranks: newRanks };
          }
        }
      }

      // Collect all items that need to be persisted to the DB.
      const changed = [updatedItems[workItemId]];
      const modifiedParentIds = new Set<string>();
      if (item.parentId) modifiedParentIds.add(item.parentId);
      if (item.parentIds) { for (const pid of Object.values(item.parentIds)) { if (pid) modifiedParentIds.add(pid); } }
      if (newParentId) modifiedParentIds.add(newParentId);
      for (const pid of modifiedParentIds) {
        if (updatedItems[pid]) changed.push(updatedItems[pid]);
      }
      for (const id of changedDescendantIds) {
        if (updatedItems[id]) changed.push(updatedItems[id]);
      }
      upsertWorkItems(changed, orgId);
      const oldEffectiveParentIdForLog = treeId ? getEffectiveParentId(item, treeId) : item.parentId;
      const oldParentName = oldEffectiveParentIdForLog ? (state.workItems[oldEffectiveParentIdForLog]?.title ?? oldEffectiveParentIdForLog) : "none";
      const newParentName = newParentId ? (state.workItems[newParentId]?.title ?? newParentId) : "none";
      const strategyLabel = strategy === "move-to-tree" ? " (move to tree)" : strategy === "mirror" ? " (mirror)" : "";
      internalLog({ action: "Reparent", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `parent: "${oldParentName}" → "${newParentName}"${strategyLabel}` });
      set({
        workItems: updatedItems,
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
      const prev = keepRemoteAdditions(state, popped);
      bumpMutationVersion();
      persistSnapshotSwitch(state, prev);
      set({ ...prev, undoStack: stack, redoStack: [...state.redoStack, snapshot(state)] });
    },

    redo: () => {
      const state = get();
      const stack = [...state.redoStack];
      const popped = stack.pop();
      if (!popped) return;
      const next = keepRemoteAdditions(state, popped);
      bumpMutationVersion();
      persistSnapshotSwitch(state, next);
      set({ ...next, undoStack: [...state.undoStack, snapshot(state)], redoStack: stack });
    },

    runBulk: (fn) => {
      let preState: AppState | null = null;
      if (undoBatchDepth === 0) {
        preState = get();
        pendingBatchSnapshot = snapshot(preState);
      }
      undoBatchDepth++;
      try {
        fn();
      } finally {
        undoBatchDepth--;
        if (undoBatchDepth === 0 && pendingBatchSnapshot) {
          const snap = pendingBatchSnapshot;
          pendingBatchSnapshot = null;
          const after = get();
          // Skip the snapshot if nothing relevant changed (e.g. early-return
          // path inside the batch). Mutators always replace these maps, so
          // reference equality is a safe "no change" detector.
          const changed =
            !preState ||
            after.workItems !== preState.workItems ||
            after.backlogs !== preState.backlogs ||
            after.backlogTrees !== preState.backlogTrees ||
            after.hyperlinks !== preState.hyperlinks;
          if (changed) {
            set((state) => ({
              undoStack: [...state.undoStack.slice(-(MAX_UNDO - 1)), snap],
              redoStack: [],
            }));
          }
        }
      }
    },



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

    ...liveUpdateActions(set),

    loadHyperlinksForItem: async (workItemId) => {
      const links = await loadHyperlinksForWorkItems([workItemId]);
      set((state) => ({
        hyperlinks: { ...state.hyperlinks, [workItemId]: links[workItemId] ?? [] },
      }));
    },

  };
});
