import { create } from "zustand";
import { WorkItem, WorkItemStatus, Backlog, BacklogTree, Hyperlink, getEffectiveParentId } from "@/types/models";
import {
  loadFromSupabase,
  upsertWorkItem,
  upsertWorkItems,
  deleteWorkItems,
  deleteWorkItemBacklogRanks,
  upsertBacklog,
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
  upsertWorkItemBoardRankRows,
  type WorkItemBacklogRankUpsert,
  type WorkItemBoardRankUpsert,
} from "./supabaseSync";
import { mockData as staticMockData } from "./mockData";
import { insertChangeLogEntry, loadChangeLog, type ChangeLogEntry } from "./changeLog";
import { getEffectiveStatuses } from "./backlogStatusesStore";
import { visibleWorkItemIdsRef, visibleBacklogIdsRef, deleteDirectionRef } from "./navigationRefs";

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

interface DataSnapshot {
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
  /** Maps workItemId -> ordered list of hyperlinks */
  hyperlinks: Record<string, Hyperlink[]>;
  selectedBacklogIds: string[];
  selectedTreeId: string | null;
  selectedWorkItemIds: string[];
  changeLog: ChangeLogEntry[];
  expandedWorkItems: Set<string>;
  expandedBacklogs: Set<string>;
}

interface AppState extends DataSnapshot {
  undoStack: DataSnapshot[];
  redoStack: DataSnapshot[];
  isLoading: boolean;
  loadingProgress: number;
  organizationId: string | null;
  userId: string | null;
  userEmail: string | null;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  setOrganizationId: (orgId: string) => void;
  setUser: (userId: string, userEmail: string) => void;
  loadFromSupabase: () => Promise<void>;
  logChange: (entry: Omit<ChangeLogEntry, "timestamp" | "id" | "userEmail">) => void;
  clearChangeLog: () => void;
  selectTree: (treeId: string) => void;
  selectBacklog: (backlogId: string, treeId: string, ctrlKey?: boolean) => void;
  selectWorkItem: (workItemId: string | null, ctrlKey?: boolean) => void;
  clearWorkItemSelection: () => void;
  toggleWorkItemExpand: (workItemId: string) => void;
  toggleBacklogExpand: (backlogId: string) => void;
  expandWorkItemsRecursive: (workItemId: string) => void;
  collapseWorkItemsRecursive: (workItemId: string) => void;
  expandBacklogsRecursive: (backlogId: string) => void;
  collapseBacklogsRecursive: (backlogId: string) => void;
  reorderWorkItemAmongSiblings: (workItemId: string, targetIndex: number, treeId: string, backlogIds: string[]) => void;
  reorderWorkItemInBoard: (workItemId: string, targetIndex: number, treeId: string, backlogIds: string[]) => void;
  sortChildrenAlphabetically: (parentId: string | null, treeId: string, backlogIds: string[]) => void;
  moveWorkItemToBacklog: (workItemId: string, targetBacklogId: string, targetTreeId: string, strategy?: "move" | "mirror", sourceTreeId?: string) => void;
  addWorkItem: (title: string, parentId: string | null, backlogId: string, treeId: string, rank?: number, initialStatus?: WorkItemStatus, boardRank?: number) => void;
  bulkAddWorkItems: (titles: string[], parentId: string | null, backlogId: string, treeId: string, initialStatus?: WorkItemStatus) => void;
  deleteWorkItem: (workItemId: string, direction?: 'up' | 'down') => void;
  deleteWorkItemsBulk: (workItemIds: string[], direction?: 'up' | 'down') => void;
  /** Duplicate work items (deep — includes descendants). Each new root is
   *  inserted directly below its source, lives in the same backlogs/parents,
   *  and inherits hyperlinks. Labels, team assignments, financials, and
   *  respawn settings are copied asynchronously via their respective stores.
   *  Returns the new root IDs. The new roots become the selection. */
  duplicateWorkItems: (workItemIds: string[]) => string[];
  renameWorkItem: (workItemId: string, title: string) => void;
  setWorkItemStatus: (workItemId: string, status: WorkItemStatus) => void;
  setWorkItemPoints: (workItemId: string, points: number | undefined) => void;
  removeWorkItemFromTree: (workItemId: string, treeId: string) => void;
  removeWorkItemsFromTreeBulk: (items: Array<{ workItemId: string; treeId: string }>) => void;
  reparentWorkItem: (workItemId: string, newParentId: string | null, treeId?: string, backlogId?: string, strategy?: "move-to-tree" | "mirror", rank?: number) => void;
  setWorkItemRespawn: (workItemId: string, respawnEnabled: boolean, respawnIntervalDays?: number, respawnHour?: number, respawnMinute?: number) => void;
  respawnItem: (workItemId: string) => void;
  addBacklog: (name: string, parentId: string | null, treeId: string) => void;
  deleteBacklog: (backlogId: string, direction?: 'up' | 'down') => void;
  renameBacklog: (backlogId: string, name: string) => void;
  setBacklogHiddenStatusKeys: (backlogId: string, keys: string[]) => void;
  setBacklogViewMode: (backlogId: string, mode: 'list' | 'board') => void;
  reorderBacklogAmongSiblings: (
    backlogId: string,
    targetIndex: number,
    targetParentId?: string | null,
    treeId?: string,
  ) => void;
  moveBacklog: (backlogId: string, targetParentId: string | null, treeId: string) => void;
  addBacklogTree: (name: string) => void;
  deleteBacklogTree: (treeId: string) => void;
  renameBacklogTree: (treeId: string, name: string) => void;
  setTreePointsEnabled: (treeId: string, enabled: boolean | null) => void;
  reorderBacklogTree: (treeId: string, targetIndex: number) => void;
  resetToMockData: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  /** Coalesce many mutations into a single undo entry. */
  runBulk: (fn: () => void) => void;
  addHyperlink: (workItemId: string, url: string, altText: string) => void;
  updateHyperlink: (linkId: string, workItemId: string, url: string, altText: string) => void;
  removeHyperlink: (linkId: string, workItemId: string) => void;
  loadHyperlinksForItem: (workItemId: string) => Promise<void>;
  applyRealtimeWorkItem: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeWorkItemRank: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeWorkItemBoardRank: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeBacklog: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeBacklogTree: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeHyperlink: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

/**
 * Resolve duplicate work-item ranks in-place.  For each (treeId, backlogId,
 * parentId) group, items sharing a rank are re-numbered sequentially (ties
 * broken by ID for determinism).  Mutates `items` directly for performance.
 */
function dedupWorkItemRanksInPlace(items: Record<string, WorkItem>): void {
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

export function sanitizeData(data: any, orgId: string) {
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
        const origRank = (wi.ranks ?? {})[bId as string] ?? (wi.ranks ?? {})[cleanB] ?? 0;
        validRanks[cleanB] = origRank;
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
  dedupWorkItemRanksInPlace(cleanWorkItems);

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


/**
 * Suppress realtime echoes of locally-written ranks for this many ms so
 * rapid keyboard reordering doesn't cause bounce-back behavior when the
 * Supabase replication channel delivers our own writes back to us.
 */
const RANK_ECHO_SUPPRESS_MS = 800;
const recentlyWrittenRanks = new Map<string, number>(); // "wiId::blId" → timestamp
const recentlyWrittenBoardRanks = new Map<string, number>();

function suppressLocalRankEcho(workItemId: string, backlogId: string): boolean {
  const key = `${workItemId}::${backlogId}`;
  const ts = recentlyWrittenRanks.get(key);
  return ts !== undefined && (Date.now() - ts < RANK_ECHO_SUPPRESS_MS);
}

function suppressLocalBoardRankEcho(workItemId: string, backlogId: string): boolean {
  const key = `${workItemId}::${backlogId}`;
  const ts = recentlyWrittenBoardRanks.get(key);
  return ts !== undefined && (Date.now() - ts < RANK_ECHO_SUPPRESS_MS);
}

function recordRankWrite(rows: WorkItemBacklogRankUpsert[]) {
  const now = Date.now();
  for (const r of rows) recentlyWrittenRanks.set(`${r.workItemId}::${r.backlogId}`, now);
  // Lazy cleanup of expired entries
  for (const [k, ts] of recentlyWrittenRanks) {
    if (now - ts > RANK_ECHO_SUPPRESS_MS) recentlyWrittenRanks.delete(k);
  }
}

function recordBoardRankWrite(rows: WorkItemBoardRankUpsert[]) {
  const now = Date.now();
  for (const r of rows) recentlyWrittenBoardRanks.set(`${r.workItemId}::${r.backlogId}`, now);
  for (const [k, ts] of recentlyWrittenBoardRanks) {
    if (now - ts > RANK_ECHO_SUPPRESS_MS) recentlyWrittenBoardRanks.delete(k);
  }
}

const PENDING_RANK_UPSERTS_KEY = "pending_work_item_rank_upserts";
const PENDING_BOARD_RANK_UPSERTS_KEY = "pending_work_item_board_rank_upserts";
const PENDING_WORK_ITEM_UPSERTS_KEY = "pending_work_item_upserts";
const DATA_CACHE_KEY_PREFIX = "cached_app_data_";
const DATA_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes – stale-while-revalidate

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

interface CachedAppData {
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

function readCachedAppData(orgId: string): CachedAppData | null {
  try {
    const raw = localStorage.getItem(DATA_CACHE_KEY_PREFIX + orgId);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.orgId || cached.orgId !== orgId || !cached?.workItems || !cached?.timestamp) return null;
    if (Date.now() - cached.timestamp > DATA_CACHE_TTL_MS) return null;
    // Convert expandedSets arrays back to Set objects
    return cached;
  } catch {
    return null;
  }
}

function writeCachedAppData(orgId: string, data: Omit<CachedAppData, 'orgId' | 'timestamp'>): void {
  try {
    // Only cache if there's actual data to show.
    if (Object.keys(data.workItems).length === 0 && Object.keys(data.backlogs).length === 0) return;
    const cached: CachedAppData = { orgId, ...data, timestamp: Date.now() };
    localStorage.setItem(DATA_CACHE_KEY_PREFIX + orgId, JSON.stringify(cached));
  } catch {
    // Storage full or unavailable — not critical.
  }
}

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

function patchCachedWorkItems(orgId: string, workItemsPatch: Record<string, WorkItem>, selectedWorkItemIds?: string[]): void {
  const cached = readCachedAppData(orgId);
  if (!cached) return;
  const { orgId: _cachedOrgId, timestamp: _cachedTimestamp, ...cachedData } = cached;
  writeCachedAppData(orgId, {
    ...cachedData,
    workItems: { ...cachedData.workItems, ...workItemsPatch },
    selectedWorkItemIds: selectedWorkItemIds ?? cachedData.selectedWorkItemIds,
  });
}

function readPendingWorkItemUpserts(orgId: string): PendingWorkItemUpsert[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_WORK_ITEM_UPSERTS_KEY) ?? "[]");
    if (!Array.isArray(pending)) return [];
    return pending.filter((entry): entry is PendingWorkItemUpsert =>
      entry?.organizationId === orgId && entry?.item?.id && entry.item.backlogAssignments,
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
    if (tree) backlogTrees[treeId] = tree;
  };

  const addBacklog = (backlogId: string | null | undefined) => {
    if (!backlogId || backlogs[backlogId]) return;
    const backlog = fallback.backlogs[backlogId];
    if (!backlog) return;
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
    if (boardRankRows.length > 0) {
      const boardOk = await upsertWorkItemBoardRankRows(boardRankRows);
      if (!boardOk) return;
      removeQueuedBoardRankUpserts(boardRankRows);
    }
    removeQueuedWorkItemUpserts(items, organizationId);
  });
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

function persistRankUpserts(rows: WorkItemBacklogRankUpsert[]) {
  if (rows.length === 0) return;
  recordRankWrite(rows);
  queueRankUpsertsForRetry(rows);
  upsertWorkItemBacklogRankRows(rows).then((ok) => {
    if (!ok || typeof localStorage === "undefined") return;
    try {
      const savedRows = new Map(rows.map((row) => [`${row.workItemId}::${row.backlogId}`, row]));
      const existing = JSON.parse(localStorage.getItem(PENDING_RANK_UPSERTS_KEY) ?? "[]");
      if (!Array.isArray(existing)) return;
      const remaining = existing.filter((row) => {
        const saved = savedRows.get(`${row.workItemId}::${row.backlogId}`);
        return !saved || saved.rank !== row.rank || saved.organizationId !== row.organizationId;
      });
      if (remaining.length > 0) localStorage.setItem(PENDING_RANK_UPSERTS_KEY, JSON.stringify(remaining));
      else localStorage.removeItem(PENDING_RANK_UPSERTS_KEY);
    } catch {
      // Best-effort cleanup only.
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

function persistBoardRankUpserts(rows: WorkItemBoardRankUpsert[]) {
  if (rows.length === 0) return;
  recordBoardRankWrite(rows);
  queueBoardRankUpsertsForRetry(rows);
  upsertWorkItemBoardRankRows(rows).then((ok) => {
    if (!ok || typeof localStorage === "undefined") return;
    removeQueuedBoardRankUpserts(rows);
  });
}

async function flushPendingRankUpserts() {
  if (typeof localStorage === "undefined") return;
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_RANK_UPSERTS_KEY) ?? "[]");
    if (!Array.isArray(pending) || pending.length === 0) return;
    const ok = await upsertWorkItemBacklogRankRows(pending);
    if (ok) localStorage.removeItem(PENDING_RANK_UPSERTS_KEY);
  } catch {
    localStorage.removeItem(PENDING_RANK_UPSERTS_KEY);
  }
}

async function flushPendingBoardRankUpserts() {
  if (typeof localStorage === "undefined") return;
  try {
    const pending = readPendingBoardRankUpserts();
    if (pending.length === 0) return;
    const ok = await upsertWorkItemBoardRankRows(pending);
    if (ok) localStorage.removeItem(PENDING_BOARD_RANK_UPSERTS_KEY);
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
  // Debounce childrenIds re-sort from realtime rank events so batch
  // reorders don't cause visible jump-then-correct flickering.
  const pendingRankResorts = new Map<string, { parentId: string; treeId: string }>();
  let rankResortScheduled = false;
  const flushRankResorts = () => {
    rankResortScheduled = false;
    if (pendingRankResorts.size === 0) return;
    const toProcess = new Map(pendingRankResorts);
    pendingRankResorts.clear();
    set((state) => {
      const updatedItems = { ...state.workItems };
      let changed = false;
      for (const [, { parentId, treeId }] of toProcess) {
        const parent = updatedItems[parentId];
        if (!parent) continue;
        const sortedIds = [...parent.childrenIds].sort((a, b) => {
          const wiA = updatedItems[a];
          const wiB = updatedItems[b];
          const blA = wiA?.backlogAssignments[treeId];
          const blB = wiB?.backlogAssignments[treeId];
          const rA = wiA && blA ? (wiA.ranks[blA] ?? 0) : 0;
          const rB = wiB && blB ? (wiB.ranks[blB] ?? 0) : 0;
          return rA - rB;
        });
        updatedItems[parentId] = { ...parent, childrenIds: sortedIds };
        changed = true;
      }
      return changed ? { workItems: updatedItems } : state;
    });
  };

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

      const runLoad = async () => {

      // Restore from localStorage cache immediately so repeat visits show
      // the previous state without any loading spinner.  Fresh data from
      // Supabase replaces the cache asynchronously afterwards.
      const cached = readCachedAppData(orgId);
      if (cached && Object.keys(cached.workItems).length > 0) {
        const cachedDataWithPending = mergePendingWorkItems({
          workItems: cached.workItems,
          backlogs: cached.backlogs,
          backlogTrees: cached.backlogTrees,
        }, orgId, [], { backlogs: cached.backlogs, backlogTrees: cached.backlogTrees });
        const parseStoredIdsCached = (key: string): string[] => {
          try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
          } catch { return []; }
        };
        const storedBacklogIds = parseStoredIdsCached(`selection_${orgId}_backlogIds`);
        const storedTreeId: string | null = localStorage.getItem(`selection_${orgId}_treeId`);
        const storedWorkItemIds = parseStoredIdsCached(`selection_${orgId}_workItemIds`);
        const validBacklogIds = storedBacklogIds.filter((id) => cachedDataWithPending.backlogs[id]);
        const validTreeId = storedTreeId && cachedDataWithPending.backlogTrees[storedTreeId] ? storedTreeId : null;
        const validWorkItemIds = storedWorkItemIds.filter((id) => cachedDataWithPending.workItems[id]);

        const cachedSnapshotKey = buildCachedSnapshotKey(
          orgId,
          cached.timestamp,
          cachedDataWithPending,
          validBacklogIds,
          validTreeId,
          validWorkItemIds,
        );
        const currentState = get();
        const canSkipCachedApply =
          lastAppliedCachedSnapshotKey === cachedSnapshotKey &&
          currentState.organizationId === orgId &&
          Object.keys(currentState.backlogTrees).length > 0 &&
          !currentState.isLoading;
        if (!canSkipCachedApply) {
          lastAppliedCachedSnapshotKey = cachedSnapshotKey;
          set((state) => {
            const selectionUnchanged =
              sameStringArray(state.selectedBacklogIds, validBacklogIds) &&
              state.selectedTreeId === validTreeId &&
              sameStringArray(state.selectedWorkItemIds, validWorkItemIds);
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
              selectedBacklogIds: validBacklogIds,
              selectedTreeId: validTreeId,
              selectedWorkItemIds: validWorkItemIds,
              isLoading: false,
              loadingProgress: 100,
              undoStack: [],
              redoStack: [],
              expandedWorkItems: new Set<string>(),
              expandedBacklogs: new Set<string>(),
            };
          });
        }

        // Refresh in the background so the cache stays fresh.
        if (appDataBackgroundRefreshInFlight?.orgId !== orgId) {
          const backgroundPromise = (async () => {
          try {
            // Snapshot the mutation version before fetching so we can
            // detect whether the user made any edits while the network
            // round-trip was in-flight. If they did, we skip overwriting
            // state to avoid losing their changes.
            const versionBeforeFetch = localMutationVersion;
            const pendingAtLoad = readPendingWorkItemUpserts(orgId);
            await flushPendingWorkItemUpserts(orgId, { backlogs: get().backlogs, backlogTrees: get().backlogTrees }).catch(() => {});
            await flushPendingRankUpserts().catch(() => {});
            await flushPendingBoardRankUpserts().catch(() => {});
            const [rawData, allHyperlinks, dbChangeLog] = await Promise.all([
              loadFromSupabase(orgId),
              loadHyperlinksForWorkItems([], orgId).catch(() => ({} as Record<string, import('@/types/models').Hyperlink[]>)),
              loadChangeLog(orgId).catch(() => [] as ChangeLogEntry[]),
            ]);
            // If the user made any edits while we were fetching, skip
            // the state update so their changes aren't overwritten.
            // The fresh data is still written to the cache so the next
            // page load benefits from it.
            if (localMutationVersion !== versionBeforeFetch) {
              // User edited — don't overwrite, but still update cache
              // for next visit.
              const cleanDataBg = mergePendingWorkItems(sanitizeData(rawData, orgId), orgId, pendingAtLoad, { backlogs: get().backlogs, backlogTrees: get().backlogTrees });
              writeCachedAppData(orgId, {
                workItems: cleanDataBg.workItems,
                backlogs: cleanDataBg.backlogs,
                backlogTrees: cleanDataBg.backlogTrees,
                hyperlinks: allHyperlinks as Record<string, import('@/types/models').Hyperlink[]> ?? {},
                changeLog: dbChangeLog as ChangeLogEntry[],
                selectedBacklogIds: get().selectedBacklogIds,
                selectedTreeId: get().selectedTreeId,
                selectedWorkItemIds: get().selectedWorkItemIds,
              });
              return;
            }
            const cleanData = mergePendingWorkItems(sanitizeData(rawData, orgId), orgId, pendingAtLoad, { backlogs: get().backlogs, backlogTrees: get().backlogTrees });

        // Bug fix: if sanitizeData dropped ALL backlog assignments for an
        // item that existed in the current store with valid assignments,
        // preserve the current store's copy so the item doesn't disappear.
        // This guards against partial Supabase responses where trees or
        // backlogs referenced by an item happen to be missing from the
        // fetched dataset (e.g. replication lag, pagination gaps).
        const currentWorkItems = get().workItems;
        for (const [id, currentWi] of Object.entries(currentWorkItems)) {
          const cleanWi = cleanData.workItems[id];
          if (!cleanWi) continue;
          if (Object.keys(cleanWi.backlogAssignments).length === 0 &&
              Object.keys(currentWi.backlogAssignments).length > 0) {
            console.warn(
              `loadFromSupabase: preserving item ${id} from current store — ` +
              `sanitizeData dropped all ${Object.keys(currentWi.backlogAssignments).length} assignments. ` +
              `Missing trees/backlogs in Supabase response likely caused this.`
            );
            cleanData.workItems[id] = currentWi;
          }
        }

        const workItemIdSet = new Set(Object.keys(cleanData.workItems));
        const hyperlinks: Record<string, import('@/types/models').Hyperlink[]> = {};
        for (const [wiId, links] of Object.entries(allHyperlinks)) {
          if (workItemIdSet.has(wiId)) hyperlinks[wiId] = links;
        }
        writeCachedAppData(orgId, {
          workItems: cleanData.workItems,
          backlogs: cleanData.backlogs,
          backlogTrees: cleanData.backlogTrees,
          hyperlinks,
          changeLog: dbChangeLog as ChangeLogEntry[],
          selectedBacklogIds: get().selectedBacklogIds,
          selectedTreeId: get().selectedTreeId,
          selectedWorkItemIds: get().selectedWorkItemIds,
        });
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
        }
          } catch {
            // Background refresh failed — cached data is still shown.
          }
          })().finally(() => {
            if (appDataBackgroundRefreshInFlight?.promise === backgroundPromise) {
              appDataBackgroundRefreshInFlight = null;
            }
          });
          appDataBackgroundRefreshInFlight = { orgId, promise: backgroundPromise };
          void backgroundPromise;
        }
        return;
      }

      set((state) => state.isLoading && state.loadingProgress === 0 ? state : { isLoading: true, loadingProgress: 0 });

      // Safety timeout: if data loading takes longer than 15 seconds (e.g. due to
      // a hung network request), unblock the UI so the app renders in an empty state
      // rather than showing the loading spinner indefinitely. The isLoading check
      // prevents a no-op state update if the timeout fires after a successful load.
      // Safety timeout: if data loading takes longer than 15 seconds
      // (e.g. due to a hung network request), don't leave the UI
      // stuck in a loading spinner. Instead, flip isLoading to false
      // BUT set loadingProgress to -1 as a sentinel so App.tsx can
      // detect the failed load and retry.
      const timeoutId = setTimeout(() => {
        if (get().organizationId === orgId && get().isLoading) {
          set({ isLoading: false, loadingProgress: -1 });
        }
      }, 15000);

      try {
        if (get().organizationId !== orgId) return;
        set({ loadingProgress: 5 });

        // Fire flushPendingRankUpserts concurrently with the main data load
        // instead of blocking on it first.  If it fails or hangs the data
        // still arrives and the UI becomes interactive sooner.
        const pendingAtLoad = readPendingWorkItemUpserts(orgId);
        const rankFlushPromise = Promise.all([
          flushPendingWorkItemUpserts(orgId, { backlogs: get().backlogs, backlogTrees: get().backlogTrees }).catch(() => {}),
          flushPendingRankUpserts().catch(() => {}),
          flushPendingBoardRankUpserts().catch(() => {}),
        ]).catch(() => {});

        // Run the main data load, hyperlinks (org-scoped), change log, and
        // rank flush all concurrently. Hyperlinks can be fetched by
        // organization_id without first needing the resolved work-item id
        // list, so all waves overlap instead of running serially.
        // Each promise increments the progress bar as it finishes so the
        // bar reflects real work rather than staying frozen.
        // Load change log lazily on demand (when the user opens the history
        // panel) instead of eagerly on every page load.  This saves one
        // network round-trip on mobile for the common case.
        const [rawData, allHyperlinks] = await Promise.all([
          loadFromSupabase(orgId).then((r) => {
            if (get().organizationId === orgId) set({ loadingProgress: 50 });
            return r;
          }),
          loadHyperlinksForWorkItems([], orgId)
            .catch(() => ({} as Record<string, import('@/types/models').Hyperlink[]>))
            .then((r) => {
              if (get().organizationId === orgId) set((s) => ({ loadingProgress: Math.max(s.loadingProgress, 70) }));
              return r;
            }),
        ]);
        if (get().organizationId !== orgId) return;
        // Ensure the rank flush has had at least the duration of the main
        // data fetch to complete, but don't block the UI if it hasn't.
        rankFlushPromise.catch(() => {});
        const cleanData = mergePendingWorkItems(sanitizeData(rawData, orgId), orgId, pendingAtLoad, { backlogs: get().backlogs, backlogTrees: get().backlogTrees });
        set({ loadingProgress: 80 });

        // Filter hyperlinks to the work items that survived sanitization.
        const workItemIdSet = new Set(Object.keys(cleanData.workItems));
        const hyperlinks: Record<string, import('@/types/models').Hyperlink[]> = {};
        for (const [wiId, links] of Object.entries(allHyperlinks)) {
          if (workItemIdSet.has(wiId)) hyperlinks[wiId] = links;
        }
        set({ loadingProgress: 90 });

        const parseStoredIds = (key: string): string[] => {
          try {
            const raw = localStorage.getItem(key);
            const parsed = raw ? JSON.parse(raw) : [];
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        };
        const storedBacklogIds = parseStoredIds(`selection_${orgId}_backlogIds`);
        const storedTreeId: string | null = localStorage.getItem(`selection_${orgId}_treeId`);
        const storedWorkItemIds = parseStoredIds(`selection_${orgId}_workItemIds`);

        const validBacklogIds = storedBacklogIds.filter((id) => cleanData.backlogs[id]);
        const validTreeId = storedTreeId && cleanData.backlogTrees[storedTreeId] ? storedTreeId : null;
        const validWorkItemIds = storedWorkItemIds.filter((id) => cleanData.workItems[id]);

        // Expand all ancestor backlogs so selected backlog items are visible
        const expandedBacklogs = new Set<string>();
        for (const id of validBacklogIds) {
          let current = cleanData.backlogs[id];
          while (current?.parentId) {
            expandedBacklogs.add(current.parentId);
            current = cleanData.backlogs[current.parentId];
          }
        }

        // Expand all ancestor work items so selected work items are visible
        const expandedWorkItems = new Set<string>();
        for (const id of validWorkItemIds) {
          let current = cleanData.workItems[id];
          while (current?.parentId) {
            expandedWorkItems.add(current.parentId);
            current = cleanData.workItems[current.parentId];
          }
        }

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

        writeCachedAppData(orgId, {
          workItems: finalWorkItems,
          backlogs: cleanData.backlogs,
          backlogTrees: cleanData.backlogTrees,
          hyperlinks,
          changeLog: [],
          selectedBacklogIds: validBacklogIds,
          selectedTreeId: validTreeId,
          selectedWorkItemIds: validWorkItemIds,
        });

        set({
          ...cleanData,
          workItems: finalWorkItems,
          hyperlinks,
          // changeLog loaded lazily via loadChangeLog action.
          changeLog: [],
          isLoading: false,
          loadingProgress: 100,
          undoStack: [],
          redoStack: [],
          selectedBacklogIds: validBacklogIds,
          selectedTreeId: validTreeId,
          selectedWorkItemIds: validWorkItemIds,
          expandedBacklogs,
          expandedWorkItems,
        });

      } catch (err) {
        clearTimeout(timeoutId);
        if (get().organizationId === orgId) set({ isLoading: false, loadingProgress: 0 });
      }
      };

      const promise = Promise.resolve().then(runLoad).finally(() => {
        if (appDataLoadInFlight?.promise === promise) {
          appDataLoadInFlight = null;
        }
      });
      appDataLoadInFlight = { orgId, promise };
      return promise;
    },

    toggleWorkItemExpand: (id) =>
      set((s) => {
        const next = new Set(s.expandedWorkItems);
        next.has(id) ? next.delete(id) : next.add(id);
        return { expandedWorkItems: next };
      }),

    toggleBacklogExpand: (id) =>
      set((s) => {
        const next = new Set(s.expandedBacklogs);
        next.has(id) ? next.delete(id) : next.add(id);
        return { expandedBacklogs: next };
      }),

    expandWorkItemsRecursive: (id) =>
      set((s) => {
        const next = new Set(s.expandedWorkItems);
        const collect = (wId: string) => {
          const item = s.workItems[wId];
          if (!item || item.childrenIds.length === 0) return;
          next.add(wId);
          item.childrenIds.forEach(collect);
        };
        collect(id);
        return { expandedWorkItems: next };
      }),

    collapseWorkItemsRecursive: (id) =>
      set((s) => {
        const next = new Set(s.expandedWorkItems);
        const collect = (wId: string) => {
          next.delete(wId);
          const item = s.workItems[wId];
          if (item) item.childrenIds.forEach(collect);
        };
        collect(id);
        return { expandedWorkItems: next };
      }),

    expandBacklogsRecursive: (id) =>
      set((s) => {
        const next = new Set(s.expandedBacklogs);
        const collect = (bId: string) => {
          const backlog = s.backlogs[bId];
          if (!backlog || backlog.childrenIds.length === 0) return;
          next.add(bId);
          backlog.childrenIds.forEach(collect);
        };
        collect(id);
        return { expandedBacklogs: next };
      }),

    collapseBacklogsRecursive: (id) =>
      set((s) => {
        const next = new Set(s.expandedBacklogs);
        const collect = (bId: string) => {
          next.delete(bId);
          const backlog = s.backlogs[bId];
          if (backlog) backlog.childrenIds.forEach(collect);
        };
        collect(id);
        return { expandedBacklogs: next };
      }),

    selectTree: (treeId) =>
      set(() => {
        const orgId = get().organizationId;
        if (orgId) {
          localStorage.setItem(`selection_${orgId}_treeId`, treeId);
          localStorage.removeItem(`selection_${orgId}_backlogIds`);
          localStorage.removeItem(`selection_${orgId}_workItemIds`);
        }
        return { selectedTreeId: treeId, selectedBacklogIds: [], selectedWorkItemIds: [] };
      }),

    selectBacklog: (backlogId, treeId, ctrlKey) =>
      set((state) => {
        const ids =
          ctrlKey && state.selectedTreeId === treeId
            ? state.selectedBacklogIds.includes(backlogId)
              ? state.selectedBacklogIds.filter((id) => id !== backlogId)
              : [...state.selectedBacklogIds, backlogId]
            : [backlogId];
        const orgId = get().organizationId;
        if (orgId) {
          localStorage.setItem(`selection_${orgId}_backlogIds`, JSON.stringify(ids));
          localStorage.setItem(`selection_${orgId}_treeId`, treeId);
          localStorage.removeItem(`selection_${orgId}_workItemIds`);
        }
        return { selectedBacklogIds: ids, selectedTreeId: treeId, selectedWorkItemIds: [] };
      }),

    selectWorkItem: (workItemId, ctrlKey) =>
      set((state) => {
        const orgId = get().organizationId;
        if (!workItemId) {
          if (orgId) localStorage.removeItem(`selection_${orgId}_workItemIds`);
          return { selectedWorkItemIds: [] };
        }
        const ids = ctrlKey
          ? state.selectedWorkItemIds.includes(workItemId)
            ? state.selectedWorkItemIds.filter((id) => id !== workItemId)
            : [...state.selectedWorkItemIds, workItemId]
          : [workItemId];
        if (orgId) {
          localStorage.setItem(`selection_${orgId}_workItemIds`, JSON.stringify(ids));
        }
        return { selectedWorkItemIds: ids };
      }),

    clearWorkItemSelection: () => {
      const orgId = get().organizationId;
      if (orgId) localStorage.removeItem(`selection_${orgId}_workItemIds`);
      set({ selectedWorkItemIds: [] });
    },

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

      persistRankUpserts(
        siblings.flatMap((s) => {
          const updated = updatedItems[s.id];
          const blId = updated.backlogAssignments[treeId];
          if (!blId) return [];
          return { workItemId: updated.id, backlogId: blId, rank: updated.ranks[blId] ?? 0, organizationId: updated.organizationId ?? orgId };
        }),
      );
      const contextName = parentId ? (state.workItems[parentId]?.title ?? "Unknown Item") : "backlog";
      internalLog({ action: "Sort", entityType: "work_item", entityId: parentId ?? treeId, entityName: contextName, details: `${siblings.length} items sorted alphabetically` });

      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    reorderWorkItemInBoard: (workItemId, targetIndex, treeId, backlogIds) => {
      const state = get();
      const orgId = state.organizationId!;
      const mainItem = state.workItems[workItemId];
      if (!mainItem) return;

      const itemsToMoveIds = state.selectedWorkItemIds.includes(workItemId) ? state.selectedWorkItemIds : [workItemId];
      const backlogIdSet = new Set(backlogIds.map((id) => ensureCleanId(id, orgId)));

      // Collect all items visible in this backlog context (same logic as reorderWorkItemAmongSiblings)
      const mainEffectiveParentId = getEffectiveParentId(mainItem, treeId);
      const mainParentInContext =
        mainEffectiveParentId !== null &&
        backlogIdSet.has(state.workItems[mainEffectiveParentId]?.backlogAssignments[treeId]);

      const allSiblings = Object.values(state.workItems)
        .filter((wi) => {
          if (!backlogIdSet.has(wi.backlogAssignments[treeId])) return false;
          const wiEffectiveParentId = getEffectiveParentId(wi, treeId);
          if (mainParentInContext) {
            return wiEffectiveParentId === mainEffectiveParentId;
          }
          const wiParentInContext =
            wiEffectiveParentId !== null &&
            backlogIdSet.has(state.workItems[wiEffectiveParentId]?.backlogAssignments[treeId]);
          return !wiParentInContext;
        })
        .sort((a, b) => {
          // Sort by board rank instead of list rank
          const rankDiff = (a.boardRanks?.[a.backlogAssignments[treeId]] ?? 0) - (b.boardRanks?.[b.backlogAssignments[treeId]] ?? 0);
          return rankDiff !== 0 ? rankDiff : a.id.localeCompare(b.id);
        });

      const movingSet = new Set(itemsToMoveIds);
      const remaining = allSiblings.filter((s) => !movingSet.has(s.id));
      const movingBeforeTarget = allSiblings.filter((s, i) => movingSet.has(s.id) && i < targetIndex).length;
      const adjustedTarget = targetIndex - movingBeforeTarget;
      const clampedIdx = Math.max(0, Math.min(adjustedTarget, remaining.length));

      const movingItems = allSiblings.filter((s) => movingSet.has(s.id));
      const reordered = [...remaining];
      reordered.splice(clampedIdx, 0, ...movingItems);

      const updatedItems = { ...state.workItems };

      reordered.forEach((s, i) => {
        const blId = updatedItems[s.id].backlogAssignments[treeId];
        if (blId) {
          updatedItems[s.id] = {
            ...updatedItems[s.id],
            boardRanks: { ...(updatedItems[s.id].boardRanks ?? {}), [blId]: i },
          };
        }
      });

      // Re-sort the parent's childrenIds to match the new board rank order.
      if (mainParentInContext && mainEffectiveParentId && updatedItems[mainEffectiveParentId]) {
        const parent = updatedItems[mainEffectiveParentId];
        const sortedChildren = [...parent.childrenIds].sort((a, b) => {
          const wiA = updatedItems[a];
          const wiB = updatedItems[b];
          if (!wiA || !wiB) return 0;
          const blA = wiA.backlogAssignments[treeId];
          const blB = wiB.backlogAssignments[treeId];
          const rA = blA ? (wiA.boardRanks?.[blA] ?? 0) : 0;
          const rB = blB ? (wiB.boardRanks?.[blB] ?? 0) : 0;
          return rA !== rB ? rA - rB : a.localeCompare(b);
        });
        updatedItems[mainEffectiveParentId] = { ...parent, childrenIds: sortedChildren };
      }

      persistBoardRankUpserts(
        reordered.flatMap((s) => {
          const updated = updatedItems[s.id];
          const blId = updated.backlogAssignments[treeId];
          if (!blId) return [];
          return { workItemId: updated.id, backlogId: blId, rank: updated.boardRanks?.[blId] ?? 0, organizationId: updated.organizationId ?? orgId };
        }),
      );
      internalLog({ action: "Board Reorder", entityType: "work_item", entityId: workItemId, entityName: mainItem.title, details: `${itemsToMoveIds.length} items moved` });

      set({
        workItems: updatedItems,
        undoStack: pushUndoEntry(state),
        redoStack: [],
      });
    },

    moveWorkItemToBacklog: (workItemId, targetBacklogId, targetTreeId, strategy = "move", sourceTreeId) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;

      const cleanTargetBl = ensureCleanId(targetBacklogId, orgId);

      // Compute rank as min-1 among siblings in the NEW backlog to place item at top.
      // Use effective parent (respecting per-tree overrides) so items with
      // different global parents but the same tree-specific parent are
      // correctly grouped as siblings.
      const itemEffectiveParent = getEffectiveParentId(item, targetTreeId);
      let minRank = Infinity;
      Object.values(state.workItems).forEach((wi) => {
        if (wi.id === workItemId) return;
        if (getEffectiveParentId(wi, targetTreeId) !== itemEffectiveParent) return;
        if (wi.backlogAssignments[targetTreeId] === cleanTargetBl) {
          const wiRank = wi.ranks[cleanTargetBl] ?? 0;
          if (wiRank < minRank) minRank = wiRank;
        }
      });
      const newRootRank = minRank === Infinity ? 0 : minRank - 1;

      const updatedItems = { ...state.workItems };
      const changed: WorkItem[] = [];
      const removedRanks: Array<{ workItemId: string; backlogId: string }> = [];

      // A cross-tree move is when the root item is being added to a tree it
      // didn't already belong to.  In that case we must also propagate the new
      // tree assignment to every descendant that exists in the hierarchy
      // (regardless of whether they already have the target-tree assignment),
      // so that a subsequent removeWorkItemFromTree call doesn't delete them.
      const isCrossTreeMove = !item.backlogAssignments[targetTreeId];

      const moveRecursive = (id: string, isRoot: boolean) => {
        const wi = updatedItems[id];
        if (!wi) return;
        const oldBlId = wi.backlogAssignments[targetTreeId];
        // Only reassign descendants that actually live in this tree. Otherwise
        // we would silently add a stray tree assignment to items that belong
        // to a different tree, creating the same class of orphan sibling that
        // caused items to appear in the wrong backlog after a move.
        // Exception: for cross-tree moves the root is NEW to targetTreeId, so
        // its descendants (which also won't have targetTreeId yet) must be
        // included so they gain the new tree context.
        if (!isRoot && !oldBlId && !isCrossTreeMove) return;
        const newRanks = { ...wi.ranks };
        // Remove rank for old backlog, add rank for new backlog
        if (oldBlId && oldBlId !== cleanTargetBl) {
          delete newRanks[oldBlId];
          removedRanks.push({ workItemId: id, backlogId: oldBlId });
        }
        if (isRoot) {
          newRanks[cleanTargetBl] = newRootRank;
        } else {
          // Preserve existing rank value or default to current
          newRanks[cleanTargetBl] = newRanks[cleanTargetBl] ?? (wi.ranks[oldBlId] ?? 0);
        }
        // Remap status if the destination backlog's effective status set
        // doesn't include the current status (falls back to 'not_started').
        const destStatuses = getEffectiveStatuses(cleanTargetBl);
        const destStatusKeys = new Set(destStatuses.map((s) => s.key));
        const remappedStatus = destStatusKeys.has(wi.status) ? wi.status : ('not_started' as WorkItemStatus);
        updatedItems[id] = {
          ...wi,
          status: remappedStatus,
          backlogAssignments: { ...wi.backlogAssignments, [targetTreeId]: cleanTargetBl },
          ranks: newRanks,
        };
        changed.push(updatedItems[id]);
        wi.childrenIds.forEach((childId) => moveRecursive(childId, false));
      };

      moveRecursive(workItemId, true);

      // Compact ALL siblings in the target context (both moved items AND
      // pre-existing siblings) so no duplicate or gapped ranks remain after
      // the move.  Without this, moved descendants could retain ranks that
      // collide with existing items, causing display/ordering bugs.
      const targetSiblingsByParent = new Map<string | null, string[]>();
      for (const wi of Object.values(updatedItems)) {
        if (wi.backlogAssignments[targetTreeId] !== cleanTargetBl) continue;
        const pid = getEffectiveParentId(wi, targetTreeId) ?? null;
        if (!targetSiblingsByParent.has(pid)) targetSiblingsByParent.set(pid, []);
        targetSiblingsByParent.get(pid)!.push(wi.id);
      }
      for (const ids of targetSiblingsByParent.values()) {
        const sorted = [...ids]
          .map((id) => updatedItems[id])
          .filter((wi): wi is WorkItem => !!wi)
          .sort((a, b) => {
            const rA = a.ranks[cleanTargetBl] ?? 0;
            const rB = b.ranks[cleanTargetBl] ?? 0;
            return rA !== rB ? rA - rB : a.id.localeCompare(b.id);
          });
        for (let i = 0; i < sorted.length; i++) {
          const wi = sorted[i];
          if ((wi.ranks[cleanTargetBl] ?? 0) !== i) {
            const updated = { ...wi, ranks: { ...wi.ranks, [cleanTargetBl]: i } };
            updatedItems[wi.id] = updated;
            const idx = changed.findIndex((c) => c.id === wi.id);
            if (idx >= 0) {
              changed[idx] = updated;
            } else {
              changed.push(updated);
            }
          }
        }
      }

      // For cross-tree "move" (not mirror): remove the source tree assignment from
      // all moved items so the item no longer appears in the source tree.
      if (strategy === "move" && sourceTreeId && sourceTreeId !== targetTreeId) {
        for (const wi of [...changed]) {
          const sourceBl = wi.backlogAssignments[sourceTreeId];
          if (!sourceBl) continue;
          const newAssignments = { ...wi.backlogAssignments };
          delete newAssignments[sourceTreeId];
          const newRanks = { ...wi.ranks };
          delete newRanks[sourceBl];
          removedRanks.push({ workItemId: wi.id, backlogId: sourceBl });
          const updated = { ...wi, backlogAssignments: newAssignments, ranks: newRanks };
          updatedItems[wi.id] = updated;
          const idx = changed.findIndex((c) => c.id === wi.id);
          if (idx >= 0) changed[idx] = updated;
        }
      }

      // Compact ALL siblings in every source backlog context that had items
      // moved out, so no gaps remain (e.g. ranks 0,1,4,5 → 0,1,2,3).  Same
      // full densification as the target-side compaction above.
      const sourcedByContext = new Map<string, string[]>();
      for (const { backlogId } of removedRanks) {
        for (const wi of Object.values(updatedItems)) {
          for (const [tid, blId] of Object.entries(wi.backlogAssignments)) {
            if (blId !== backlogId) continue;
            const pid = getEffectiveParentId(wi, tid) ?? null;
            const key = `${tid}::${backlogId}::${pid ?? 'ROOT'}`;
            if (!sourcedByContext.has(key)) sourcedByContext.set(key, []);
            const arr = sourcedByContext.get(key)!;
            if (!arr.includes(wi.id)) arr.push(wi.id);
          }
        }
      }
      for (const ids of sourcedByContext.values()) {
        const firstWi = updatedItems[ids[0]];
        if (!firstWi) continue;
        // Determine the backlog for this group
        let blId: string | null = null;
        for (const [, bId] of Object.entries(firstWi.backlogAssignments)) {
          blId = bId;
          break;
        }
        if (!blId) continue;
        const sorted = [...ids]
          .map((id) => updatedItems[id])
          .filter((wi): wi is WorkItem => !!wi)
          .sort((a, b) => {
            const rA = a.ranks[blId!] ?? 0;
            const rB = b.ranks[blId!] ?? 0;
            return rA !== rB ? rA - rB : a.id.localeCompare(b.id);
          });
        for (let i = 0; i < sorted.length; i++) {
          const wi = sorted[i];
          if ((wi.ranks[blId] ?? 0) !== i) {
            const updated = { ...wi, ranks: { ...wi.ranks, [blId]: i } };
            updatedItems[wi.id] = updated;
            const idx = changed.findIndex((c) => c.id === wi.id);
            if (idx >= 0) {
              changed[idx] = updated;
            } else {
              changed.push(updated);
            }
          }
        }
      }

      upsertWorkItems(changed, orgId);
      // Clean up stale rank rows in the DB for backlogs that items were moved out of.
      deleteWorkItemBacklogRanks(removedRanks);
      const oldBacklogId = item.backlogAssignments[targetTreeId];
      const oldBacklogName = oldBacklogId ? state.backlogs[oldBacklogId]?.name : '?';
      const newBacklogName = state.backlogs[cleanTargetBl]?.name ?? cleanTargetBl;
      internalLog({ action: "Move to Backlog", entityType: "work_item", entityId: workItemId, entityName: item.title, details: `backlog: "${oldBacklogName}" → "${newBacklogName}"` });
      set({ workItems: updatedItems, undoStack: pushUndoEntry(state) });
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
      internalLog({ action: "Add", entityType: "work_item", entityId: id, entityName: title, details: `backlog: "${backlogName}", parent: ${parentId ? `"${state.workItems[parentId]?.title ?? parentId}"` : "none"}` });
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

      deleteWorkItems(idsToDelete)?.catch((err) => console.error("Delete work item failed", err));
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

      deleteWorkItems(allIdsToDelete)?.catch((err) => console.error("Bulk delete work items failed", err));
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

    setWorkItemStatus: (workItemId, status) => {
      const state = get();
      const orgId = state.organizationId!;
      const item = state.workItems[workItemId];
      if (!item) return;
      const updatedWorkItems = { ...state.workItems, [workItemId]: { ...item, status } };
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

        deleteWorkItems(idsToDelete)?.catch((err) => console.error("Delete work item failed", err));
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

      for (const { workItemId, treeId } of items) {
        if (!state.workItems[workItemId]) continue;

        const processItem = (id: string) => {
          const wi = updatedItems[id];
          if (!wi) return;
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

        deleteWorkItems(allIdsToDelete)?.catch((err) => console.error("Bulk remove from tree failed", err));
      }
      if (toUpsert.length > 0) {
        upsertWorkItems(toUpsert, orgId);
      }

      internalLog({ action: "Remove from Tree", entityType: "work_item", entityId: items[0].workItemId, entityName: `${items.length} items` });
      set({
        workItems: updatedItems,
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
        if (item.parentId && updatedItems[item.parentId]) {
          updatedItems[item.parentId] = {
            ...updatedItems[item.parentId],
            childrenIds: updatedItems[item.parentId].childrenIds.filter((id) => id !== workItemId),
          };
        }
        // Also remove from any per-tree parent entries that differ from global
        if (item.parentIds) {
          for (const treeParentId of Object.values(item.parentIds)) {
            if (treeParentId && treeParentId !== item.parentId && updatedItems[treeParentId]) {
              updatedItems[treeParentId] = {
                ...updatedItems[treeParentId],
                childrenIds: updatedItems[treeParentId].childrenIds.filter((id) => id !== workItemId),
              };
            }
          }
        }
        // Add to new parent
        if (newParentId && updatedItems[newParentId] && !updatedItems[newParentId].childrenIds.includes(workItemId)) {
          updatedItems[newParentId] = {
            ...updatedItems[newParentId],
            childrenIds: [...updatedItems[newParentId].childrenIds, workItemId],
          };
        }

        // Compute rank for the root item as max+1 among siblings in the new backlog.
        let maxRank = -1;
        Object.values(state.workItems).forEach((wi) => {
          if (wi.id === workItemId) return;
          if (getEffectiveParentId(wi, treeId) !== newParentId) return;
          if (wi.backlogAssignments[treeId] === cleanBlId) {
            const wiRank = wi.ranks[cleanBlId] ?? 0;
            if (wiRank > maxRank) maxRank = wiRank;
          }
        });

        updatedItems[workItemId] = {
          ...item,
          parentId: newParentId,
          parentIds: {},
          backlogAssignments: { [treeId]: cleanBlId },
          ranks: { [cleanBlId]: maxRank + 1 },
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

        // Dedup ranks for siblings that were previously in different backlogs and
        // are now merged into cleanBlId (same approach as moveWorkItemToBacklog).
        const movedByParent = new Map<string | null, string[]>();
        for (const id of changedDescendantIds) {
          const wi = updatedItems[id];
          if (!wi) continue;
          const pid = wi.parentId ?? null;
          if (!movedByParent.has(pid)) movedByParent.set(pid, []);
          movedByParent.get(pid)!.push(id);
        }
        for (const ids of movedByParent.values()) {
          if (ids.length < 2) continue;
          const sorted = [...ids].sort(
            (a, b) => (updatedItems[a]?.ranks[cleanBlId] ?? 0) - (updatedItems[b]?.ranks[cleanBlId] ?? 0),
          );
          let prevEffective = -Infinity;
          for (const id of sorted) {
            const sibling = updatedItems[id];
            if (!sibling) continue;
            const sibRank = sibling.ranks[cleanBlId] ?? 0;
            if (sibRank <= prevEffective) {
              const newRank = prevEffective + 1;
              updatedItems[id] = { ...updatedItems[id], ranks: { ...updatedItems[id].ranks, [cleanBlId]: newRank } };
              prevEffective = newRank;
            } else {
              prevEffective = sibRank;
            }
          }
        }
      } else if (strategy === "mirror" && treeId && backlogId) {
        // Add the new tree assignment while keeping all existing ones.
        // DON'T change the global parentId — store the new parent as a per-tree
        // override so existing tree relationships are undisturbed.
        const cleanBlId = ensureCleanId(backlogId, orgId);

        // Add to new parent's childrenIds only (leave old parent's list intact).
        if (newParentId && updatedItems[newParentId] && !updatedItems[newParentId].childrenIds.includes(workItemId)) {
          updatedItems[newParentId] = {
            ...updatedItems[newParentId],
            childrenIds: [...updatedItems[newParentId].childrenIds, workItemId],
          };
        }

        // Compute rank in the new backlog context.
        let maxRank = -1;
        Object.values(state.workItems).forEach((wi) => {
          if (wi.id === workItemId) return;
          if (getEffectiveParentId(wi, treeId) !== newParentId) return;
          if (wi.backlogAssignments[treeId] === cleanBlId) {
            const wiRank = wi.ranks[cleanBlId] ?? 0;
            if (wiRank > maxRank) maxRank = wiRank;
          }
        });

        updatedItems[workItemId] = {
          ...item,
          parentIds: { ...item.parentIds, [treeId]: newParentId },
          backlogAssignments: { ...item.backlogAssignments, [treeId]: cleanBlId },
          ranks: { ...item.ranks, [cleanBlId]: maxRank + 1 },
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

          if (!isOldParentStillNeeded && oldEffectiveParentId && updatedItems[oldEffectiveParentId]) {
            updatedItems[oldEffectiveParentId] = {
              ...updatedItems[oldEffectiveParentId],
              childrenIds: updatedItems[oldEffectiveParentId].childrenIds.filter((id) => id !== workItemId),
            };
          }
          if (newParentId && updatedItems[newParentId] && !updatedItems[newParentId].childrenIds.includes(workItemId)) {
            updatedItems[newParentId] = {
              ...updatedItems[newParentId],
              childrenIds: [...updatedItems[newParentId].childrenIds, workItemId],
            };
          }

          if (isBacklogChange) {
            // Same-tree reparent into a different backlog: migrate the item and all
            // its descendants to the new backlog, replacing the old assignment for
            // this tree (same logic as move-to-tree but scoped to one tree).
            let maxRank = -1;
            Object.values(state.workItems).forEach((wi) => {
              if (wi.id === workItemId) return;
              if (getEffectiveParentId(wi, treeId) !== newParentId) return;
              if (wi.backlogAssignments[treeId] === cleanBlId) {
                const wiRank = wi.ranks[cleanBlId!] ?? 0;
                if (wiRank > maxRank) maxRank = wiRank;
              }
            });

            const newRanks = { ...item.ranks };
            delete newRanks[currentBlId!];
            newRanks[cleanBlId!] = maxRank + 1;
            updatedItems[workItemId] = {
              ...item,
              parentIds: { ...item.parentIds, [treeId]: newParentId },
              backlogAssignments: { ...item.backlogAssignments, [treeId]: cleanBlId! },
              ranks: newRanks,
            };

            // Recursively migrate all descendants to the new backlog.
            const migrateDescendants = (id: string) => {
              const wi = updatedItems[id];
              if (!wi) return;
              const oldBlId = wi.backlogAssignments[treeId];
              const descRanks = { ...wi.ranks };
              if (oldBlId && oldBlId !== cleanBlId) delete descRanks[oldBlId];
              descRanks[cleanBlId!] = descRanks[cleanBlId!] ?? (oldBlId ? (wi.ranks[oldBlId] ?? 0) : 0);
              updatedItems[id] = {
                ...wi,
                backlogAssignments: { ...wi.backlogAssignments, [treeId]: cleanBlId! },
                ranks: descRanks,
              };
              changedDescendantIds.push(id);
              wi.childrenIds.forEach(migrateDescendants);
            };
            item.childrenIds.forEach(migrateDescendants);

            // Dedup ranks for siblings merged into cleanBlId.
            const movedByParent = new Map<string | null, string[]>();
            for (const id of changedDescendantIds) {
              const wi = updatedItems[id];
              if (!wi) continue;
              const pid = getEffectiveParentId(wi, treeId) ?? null;
              if (!movedByParent.has(pid)) movedByParent.set(pid, []);
              movedByParent.get(pid)!.push(id);
            }
            for (const ids of movedByParent.values()) {
              if (ids.length < 2) continue;
              const sorted = [...ids].sort(
                (a, b) => (updatedItems[a]?.ranks[cleanBlId!] ?? 0) - (updatedItems[b]?.ranks[cleanBlId!] ?? 0),
              );
              let prevEffective = -Infinity;
              for (const id of sorted) {
                const sibling = updatedItems[id];
                if (!sibling) continue;
                const sibRank = sibling.ranks[cleanBlId!] ?? 0;
                if (sibRank <= prevEffective) {
                  const newRank = prevEffective + 1;
                  updatedItems[id] = { ...updatedItems[id], ranks: { ...updatedItems[id].ranks, [cleanBlId!]: newRank } };
                  prevEffective = newRank;
                } else {
                  prevEffective = sibRank;
                }
              }
            }
          } else {
            // Same-tree, same-backlog reparent for a multi-tree item: only update
            // the rank for the current tree's backlog (avoid touching other trees).
            const blId = item.backlogAssignments[treeId] ?? null;
            const newRanks = { ...item.ranks };
            if (blId) {
              let maxRank = -1;
              Object.values(state.workItems).forEach((wi) => {
                if (wi.id === workItemId) return;
                if (getEffectiveParentId(wi, treeId) !== newParentId) return;
                if (wi.backlogAssignments[treeId] === blId) {
                  const wiRank = wi.ranks[blId] ?? 0;
                  if (wiRank > maxRank) maxRank = wiRank;
                }
              });
              newRanks[blId] = maxRank + 1;
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
          if (singleTreeOldParentId && updatedItems[singleTreeOldParentId]) {
            updatedItems[singleTreeOldParentId] = {
              ...updatedItems[singleTreeOldParentId],
              childrenIds: updatedItems[singleTreeOldParentId].childrenIds.filter((id) => id !== workItemId),
            };
          }
          // Add to new parent
          if (newParentId && updatedItems[newParentId] && !updatedItems[newParentId].childrenIds.includes(workItemId)) {
            updatedItems[newParentId] = {
              ...updatedItems[newParentId],
              childrenIds: [...updatedItems[newParentId].childrenIds, workItemId],
            };
          }

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
            let maxRank = -1;
            Object.values(state.workItems).forEach((wi) => {
              if (wi.id === workItemId) return;
              if (getEffectiveParentId(wi, treeId!) !== newParentId) return;
              if (wi.backlogAssignments[treeId!] === cleanBlId) {
                const wiRank = wi.ranks[cleanBlId!] ?? 0;
                if (wiRank > maxRank) maxRank = wiRank;
              }
            });

            const newRanks = { ...item.ranks };
            delete newRanks[currentBlId!];
            newRanks[cleanBlId!] = maxRank + 1;
            updatedItems[workItemId] = {
              ...item,
              parentId: newParentId,
              parentIds: clearedParentIds,
              backlogAssignments: { ...item.backlogAssignments, [treeId!]: cleanBlId! },
              ranks: newRanks,
            };

            // Recursively migrate all descendants to the new backlog.
            const migrateDescendants = (id: string) => {
              const wi = updatedItems[id];
              if (!wi) return;
              const oldBlId = wi.backlogAssignments[treeId!];
              const descRanks = { ...wi.ranks };
              if (oldBlId && oldBlId !== cleanBlId) delete descRanks[oldBlId];
              descRanks[cleanBlId!] = descRanks[cleanBlId!] ?? (oldBlId ? (wi.ranks[oldBlId] ?? 0) : 0);
              updatedItems[id] = {
                ...wi,
                backlogAssignments: { ...wi.backlogAssignments, [treeId!]: cleanBlId! },
                ranks: descRanks,
              };
              changedDescendantIds.push(id);
              wi.childrenIds.forEach(migrateDescendants);
            };
            item.childrenIds.forEach(migrateDescendants);

            // Dedup ranks for siblings that were previously in different backlogs and
            // are now merged into cleanBlId (same approach as moveWorkItemToBacklog).
            const movedByParent = new Map<string | null, string[]>();
            for (const id of changedDescendantIds) {
              const wi = updatedItems[id];
              if (!wi) continue;
              const pid = getEffectiveParentId(wi, treeId!) ?? null;
              if (!movedByParent.has(pid)) movedByParent.set(pid, []);
              movedByParent.get(pid)!.push(id);
            }
            for (const ids of movedByParent.values()) {
              if (ids.length < 2) continue;
              const sorted = [...ids].sort(
                (a, b) => (updatedItems[a]?.ranks[cleanBlId!] ?? 0) - (updatedItems[b]?.ranks[cleanBlId!] ?? 0),
              );
              let prevEffective = -Infinity;
              for (const id of sorted) {
                const sibling = updatedItems[id];
                if (!sibling) continue;
                const sibRank = sibling.ranks[cleanBlId!] ?? 0;
                if (sibRank <= prevEffective) {
                  const newRank = prevEffective + 1;
                  updatedItems[id] = { ...updatedItems[id], ranks: { ...updatedItems[id].ranks, [cleanBlId!]: newRank } };
                  prevEffective = newRank;
                } else {
                  prevEffective = sibRank;
                }
              }
            }
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
                let maxRank = -1;
                Object.values(state.workItems).forEach((wi) => {
                  if (wi.id === workItemId) return;
                  if (getEffectiveParentId(wi, tId) !== newParentId) return;
                  if (wi.backlogAssignments[tId] === blId) {
                    const wiRank = wi.ranks[blId] ?? 0;
                    if (wiRank > maxRank) maxRank = wiRank;
                  }
                });
                newRanks[blId] = maxRank + 1;
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
      deleteWorkItems(wiIdsToDelete)?.catch((err) => console.error("Delete work items failed", err));
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
      deleteWorkItems(wiIdsToDelete);
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

    undo: () =>
      set((state) => {
        const stack = [...state.undoStack];
        const prev = stack.pop();
        if (!prev) return state;
        bumpMutationVersion();
        return { ...prev, undoStack: stack, redoStack: [...state.redoStack, snapshot(state)] };
      }),

    redo: () =>
      set((state) => {
        const stack = [...state.redoStack];
        const next = stack.pop();
        if (!next) return state;
        bumpMutationVersion();
        return { ...next, undoStack: [...state.undoStack, snapshot(state)], redoStack: stack };
      }),

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

    loadHyperlinksForItem: async (workItemId) => {
      const links = await loadHyperlinksForWorkItems([workItemId]);
      set((state) => ({
        hyperlinks: { ...state.hyperlinks, [workItemId]: links[workItemId] ?? [] },
      }));
    },

    applyRealtimeWorkItem: (eventType, row) => {
      set((state) => {
        const id = row.id as string;

        if (eventType === 'DELETE') {
          if (!state.workItems[id]) return state;
          const oldItem = state.workItems[id];
          const updatedWorkItems = { ...state.workItems };
          delete updatedWorkItems[id];
          if (oldItem.parentId && updatedWorkItems[oldItem.parentId]) {
            updatedWorkItems[oldItem.parentId] = {
              ...updatedWorkItems[oldItem.parentId],
              childrenIds: updatedWorkItems[oldItem.parentId].childrenIds.filter((cid) => cid !== id),
            };
          }
          // Fix orphaned children in local state: items whose parentId points to
          // the just-deleted item but were not deleted themselves (e.g. due to a
          // data inconsistency).  Promote them to the deleted item's parent so
          // they don't appear as unexpected roots in other trees.
          const newParentForOrphans = oldItem.parentId ?? null;
          for (const wi of Object.values(updatedWorkItems)) {
            if (wi.parentId !== id) continue;
            updatedWorkItems[wi.id] = { ...wi, parentId: newParentForOrphans };
            if (newParentForOrphans && updatedWorkItems[newParentForOrphans]) {
              const gp = updatedWorkItems[newParentForOrphans];
              if (!gp.childrenIds.includes(wi.id)) {
                updatedWorkItems[newParentForOrphans] = {
                  ...gp,
                  childrenIds: [...gp.childrenIds, wi.id],
                };
              }
            }
          }
          return { workItems: updatedWorkItems };
        }

        // INSERT or UPDATE: preserve existing childrenIds and ranks from current state.
        // Ranks live in the separate work_item_backlog_ranks table and arrive
        // via applyRealtimeWorkItemRank; we keep the existing local ranks here.
        const rawAssignments = row.backlog_assignments as Record<string, unknown> | null;
        const parsedAssignments: Record<string, string> = {};
        if (rawAssignments && typeof rawAssignments === 'object') {
          for (const [tId, value] of Object.entries(rawAssignments)) {
            if (typeof value === 'string') {
              parsedAssignments[tId] = value;
            } else if (value && typeof value === 'object' && 'backlogId' in value) {
              // Legacy enriched format – extract plain backlogId
              parsedAssignments[tId] = (value as { backlogId: string }).backlogId;
            }
          }
        }
        // If the realtime payload did not include backlog_assignments at all
        // (missing key, null, or empty object), preserve the existing local
        // assignments so a partial UPDATE never silently wipes them.  Without
        // this guard, an external event like a status change arriving without
        // the backlog_assignments column would orphan the item.
        //
        // Also, when the payload DOES include backlog_assignments but is a
        // SUBSET of the local assignments (e.g. another client changed a
        // single tree assignment), MERGE with the local state so multi-tree
        // items don't vanish from the trees that weren't mentioned in the
        // realtime event.
        const existingAssignments = state.workItems[id]?.backlogAssignments ?? {};
        let effectiveAssignments: Record<string, string>;
        if (Object.keys(parsedAssignments).length > 0) {
          // Merge: locally-known trees not in the payload are preserved.
          effectiveAssignments = { ...existingAssignments, ...parsedAssignments };
          // If a tree IS in the payload but its value is missing/null/empty, remove it.
          for (const tId of Object.keys(effectiveAssignments)) {
            if (!effectiveAssignments[tId]) delete effectiveAssignments[tId];
          }
        } else {
          effectiveAssignments = existingAssignments;
        }

        // Seed initial ranks from the legacy work_items.rank column for new
        // INSERT events. This ensures items inserted by external sources (e.g.
        // the GitHub PR webhook) appear at the correct position immediately,
        // before the separate work_item_backlog_ranks realtime event arrives.
        const existingRanks = state.workItems[id]?.ranks ?? {};
        let initialRanks: Record<string, number> = existingRanks;
        if (eventType === 'INSERT' && Object.keys(existingRanks).length === 0) {
          const legacyRank = typeof row.rank === 'number' ? (row.rank as number) : null;
          if (legacyRank !== null) {
            const seeded: Record<string, number> = {};
            for (const blId of Object.values(parsedAssignments)) {
              seeded[blId] = legacyRank;
            }
            if (Object.keys(seeded).length > 0) initialRanks = seeded;
          }
        }

        // Parse parent_id_overrides if present in the payload; otherwise
        // preserve whatever the current local state already knows.  Without
        // this preservation, any realtime UPDATE silently strips per-tree
        // parent overrides and items collapse to the root level.
        let parsedParentIds: Record<string, string | null> | undefined;
        if ('parent_id_overrides' in row) {
          const raw = row.parent_id_overrides as unknown;
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const map: Record<string, string | null> = {};
            for (const [tId, val] of Object.entries(raw as Record<string, unknown>)) {
              if (val === null || typeof val === 'string') map[tId] = val as string | null;
            }
            parsedParentIds = Object.keys(map).length > 0 ? map : undefined;
          } else {
            parsedParentIds = undefined;
          }
        } else {
          parsedParentIds = state.workItems[id]?.parentIds;
        }

        const newItem: WorkItem = {
          id,
          title: row.title as string,
          description: (row.description as string | null) ?? undefined,
          points: (row.points as number | null) ?? undefined,
          status: ((row.status as string) ?? 'not_started') as WorkItemStatus,
          parentId: (row.parent_id as string | null) ?? null,
          parentIds: parsedParentIds,
          childrenIds: state.workItems[id]?.childrenIds ?? [],
          backlogAssignments: effectiveAssignments,
          ranks: initialRanks,
          boardRanks: state.workItems[id]?.boardRanks ?? {},
          organizationId: (row.organization_id as string) ?? undefined,
          respawnEnabled: (row.respawn_enabled as boolean) ?? false,
          respawnIntervalDays: (row.respawn_interval_days as number | null) ?? undefined,
          respawnHour: (row.respawn_hour as number | null) ?? undefined,
          respawnMinute: (row.respawn_minute as number | null) ?? undefined,
          respawnLastTriggeredAt: (row.respawn_last_triggered_at as string | null) ?? undefined,
        };

        const updatedWorkItems = { ...state.workItems, [id]: newItem };

        const oldItem = state.workItems[id];
        const oldParentId = oldItem?.parentId ?? null;

        if (eventType === 'INSERT' || oldParentId !== newItem.parentId) {
          // Remove from old parent (UPDATE reparent case)
          if (oldParentId && oldParentId !== newItem.parentId && updatedWorkItems[oldParentId]) {
            updatedWorkItems[oldParentId] = {
              ...updatedWorkItems[oldParentId],
              childrenIds: updatedWorkItems[oldParentId].childrenIds.filter((cid) => cid !== id),
            };
          }
          // Add to new parent if not already there (DO NOT sort — per-tree
          // rank order is maintained exclusively by local reorder actions
          // and applyRealtimeWorkItemRank/flushRankResorts; sorting here
          // with a non-tree-aware comparator causes bounceback creep).
          if (newItem.parentId && updatedWorkItems[newItem.parentId]) {
            const parent = updatedWorkItems[newItem.parentId];
            if (!parent.childrenIds.includes(id)) {
              updatedWorkItems[newItem.parentId] = { ...parent, childrenIds: [...parent.childrenIds, id] };
            }
          }
        }
        // Same parent: no-op — childrenIds order is maintained by the
        // local reorder actions and applyRealtimeWorkItemRank/flushRankResorts.
        // Re-sorting here with min-rank-across-all-backlogs would corrupt
        // the per-tree ordering for multi-backlog items.

        // Sync childrenIds for per-tree override parents.  Remove from any
        // override parent that no longer references this item, and add to any
        // new override parent.
        const oldOverrideParents = new Set<string>();
        if (oldItem?.parentIds) {
          for (const pid of Object.values(oldItem.parentIds)) {
            if (pid && pid !== oldParentId) oldOverrideParents.add(pid);
          }
        }
        const newOverrideParents = new Set<string>();
        if (newItem.parentIds) {
          for (const pid of Object.values(newItem.parentIds)) {
            if (pid && pid !== newItem.parentId) newOverrideParents.add(pid);
          }
        }
        for (const pid of oldOverrideParents) {
          if (newOverrideParents.has(pid)) continue;
          const parent = updatedWorkItems[pid];
          if (!parent) continue;
          updatedWorkItems[pid] = {
            ...parent,
            childrenIds: parent.childrenIds.filter((cid) => cid !== id),
          };
        }
        for (const pid of newOverrideParents) {
          const parent = updatedWorkItems[pid];
          if (!parent) continue;
          if (!parent.childrenIds.includes(id)) {
            updatedWorkItems[pid] = {
              ...parent,
              childrenIds: [...parent.childrenIds, id],
            };
          }
        }

        return { workItems: updatedWorkItems };
      });
    },

    applyRealtimeWorkItemRank: (eventType, row) => {
      const workItemId = row.work_item_id as string;
      const backlogId = row.backlog_id as string;
      if (eventType !== 'DELETE' && suppressLocalRankEcho(workItemId, backlogId)) return;

      set((state) => {
        const wi = state.workItems[workItemId];
        if (!wi) return state;

        if (eventType === 'DELETE') {
          const newRanks = { ...wi.ranks };
          delete newRanks[backlogId];
          const updatedWorkItems = { ...state.workItems, [workItemId]: { ...wi, ranks: newRanks } };
          return { workItems: updatedWorkItems };
        }

        // INSERT or UPDATE
        const newRank = (row.rank as number) ?? 0;
        const newRanks = { ...wi.ranks, [backlogId]: newRank };
        const updatedWorkItems = { ...state.workItems, [workItemId]: { ...wi, ranks: newRanks } };

        // NOTE: do NOT call dedupWorkItemRanksInPlace here.  A batch reorder
        // writes N rank rows to the DB; realtime events arrive one-by-one, so
        // between the first and last event the local state has transient rank
        // collisions.  Running dedup on each event bumps sibling ranks upward;
        // those inflated values get written to the DB if the user edits any
        // item before all events have arrived, permanently corrupting the order.
        // Dedup at load time (sanitizeData) is sufficient to repair any genuine
        // duplicates that escaped to the DB.

        // Debounce the childrenIds re-sort for this parent so that a batch
        // of N realtime rank events coalesces into a single sort in a
        // microtask.  Without this, each event re-sorts immediately with
        // partial rank data, causing the visible "jump then correct" flicker.
        const treeId = state.backlogs[backlogId]?.treeId;
        if (wi.parentId && treeId) {
          const key = `${wi.parentId}::${treeId}`;
          pendingRankResorts.set(key, { parentId: wi.parentId, treeId });
          if (!rankResortScheduled) {
            rankResortScheduled = true;
            queueMicrotask(flushRankResorts);
          }
        }

        return { workItems: updatedWorkItems };
      });
    },

    applyRealtimeWorkItemBoardRank: (eventType, row) => {
      const workItemId = row.work_item_id as string;
      const backlogId = row.backlog_id as string;
      if (eventType !== 'DELETE' && suppressLocalBoardRankEcho(workItemId, backlogId)) return;

      set((state) => {
        const wi = state.workItems[workItemId];
        if (!wi) return state;
        const current = wi.boardRanks ?? {};
        if (eventType === 'DELETE') {
          const next = { ...current };
          delete next[backlogId];
          return { workItems: { ...state.workItems, [workItemId]: { ...wi, boardRanks: next } } };
        }
        const next = { ...current, [backlogId]: (row.rank as number) ?? 0 };
        return { workItems: { ...state.workItems, [workItemId]: { ...wi, boardRanks: next } } };
      });
    },

    applyRealtimeBacklog: (eventType, row) => {
      set((state) => {
        const id = row.id as string;

        if (eventType === 'DELETE') {
          if (!state.backlogs[id]) return state;
          const bl = state.backlogs[id];
          const updatedBacklogs = { ...state.backlogs };
          delete updatedBacklogs[id];
          const updatedTrees = { ...state.backlogTrees };
          if (bl.parentId && updatedBacklogs[bl.parentId]) {
            updatedBacklogs[bl.parentId] = {
              ...updatedBacklogs[bl.parentId],
              childrenIds: updatedBacklogs[bl.parentId].childrenIds.filter((cid) => cid !== id),
            };
          } else if (updatedTrees[bl.treeId]) {
            updatedTrees[bl.treeId] = {
              ...updatedTrees[bl.treeId],
              rootBacklogIds: updatedTrees[bl.treeId].rootBacklogIds.filter((bid) => bid !== id),
            };
          }
          return { backlogs: updatedBacklogs, backlogTrees: updatedTrees };
        }

        // INSERT or UPDATE: preserve existing childrenIds from current state
        const newBacklog: Backlog = {
          id,
          name: row.name as string,
          parentId: (row.parent_id as string | null) ?? null,
          childrenIds: state.backlogs[id]?.childrenIds ?? [],
          treeId: row.tree_id as string,
          rank: row.rank as number,
          boardHiddenStatusKeys: (row.board_hidden_status_keys as string[] | null) ?? [],
          viewMode: ((row.view_mode as string | null) === 'board' ? 'board' : 'list'),
        };

        const updatedBacklogs = { ...state.backlogs, [id]: newBacklog };
        const updatedTrees = { ...state.backlogTrees };

        const sortBacklogIds = (ids: string[]) =>
          [...ids].sort((a, b) => (updatedBacklogs[a]?.rank ?? 0) - (updatedBacklogs[b]?.rank ?? 0));

        const oldBacklog = state.backlogs[id];
        const oldParentId = oldBacklog?.parentId ?? null;
        const oldTreeId = oldBacklog?.treeId ?? null;
        const parentChanged = oldParentId !== newBacklog.parentId || oldTreeId !== newBacklog.treeId;

        if (eventType === 'INSERT' || parentChanged) {
          // Remove from old location (UPDATE reparent case)
          if (oldBacklog && parentChanged) {
            if (oldParentId && updatedBacklogs[oldParentId]) {
              updatedBacklogs[oldParentId] = {
                ...updatedBacklogs[oldParentId],
                childrenIds: updatedBacklogs[oldParentId].childrenIds.filter((cid) => cid !== id),
              };
            } else if (oldTreeId && updatedTrees[oldTreeId]) {
              updatedTrees[oldTreeId] = {
                ...updatedTrees[oldTreeId],
                rootBacklogIds: updatedTrees[oldTreeId].rootBacklogIds.filter((bid) => bid !== id),
              };
            }
          }
          // Add to new location if not already present
          if (newBacklog.parentId && updatedBacklogs[newBacklog.parentId]) {
            const parent = updatedBacklogs[newBacklog.parentId];
            if (!parent.childrenIds.includes(id)) {
              updatedBacklogs[newBacklog.parentId] = { ...parent, childrenIds: sortBacklogIds([...parent.childrenIds, id]) };
            }
          } else if (updatedTrees[newBacklog.treeId]) {
            const tree = updatedTrees[newBacklog.treeId];
            if (!tree.rootBacklogIds.includes(id)) {
              updatedTrees[newBacklog.treeId] = { ...tree, rootBacklogIds: sortBacklogIds([...tree.rootBacklogIds, id]) };
            }
          }
        } else {
          // Same parent: re-sort in case rank changed
          if (newBacklog.parentId && updatedBacklogs[newBacklog.parentId]) {
            const parent = updatedBacklogs[newBacklog.parentId];
            updatedBacklogs[newBacklog.parentId] = { ...parent, childrenIds: sortBacklogIds(parent.childrenIds) };
          } else if (updatedTrees[newBacklog.treeId]) {
            const tree = updatedTrees[newBacklog.treeId];
            updatedTrees[newBacklog.treeId] = { ...tree, rootBacklogIds: sortBacklogIds(tree.rootBacklogIds) };
          }
        }

        return { backlogs: updatedBacklogs, backlogTrees: updatedTrees };
      });
    },

    applyRealtimeBacklogTree: (eventType, row) => {
      set((state) => {
        const id = row.id as string;

        if (eventType === 'DELETE') {
          if (!state.backlogTrees[id]) return state;
          const updatedTrees = { ...state.backlogTrees };
          delete updatedTrees[id];
          return { backlogTrees: updatedTrees };
        }

        // INSERT or UPDATE: preserve existing rootBacklogIds so backlogs stay attached
        const newTree: BacklogTree = {
          id,
          name: row.name as string,
          rank: row.rank as number,
          rootBacklogIds: state.backlogTrees[id]?.rootBacklogIds ?? [],
          pointsEnabled: (row as { points_enabled?: boolean | null }).points_enabled ?? null,
        };

        return { backlogTrees: { ...state.backlogTrees, [id]: newTree } };
      });
    },

    applyRealtimeHyperlink: (eventType, row) => {
      set((state) => {
        const id = row.id as string;
        const workItemId = row.work_item_id as string;

        if (eventType === 'DELETE') {
          const existing = state.hyperlinks[workItemId] ?? [];
          const filtered = existing.filter((l) => l.id !== id);
          if (filtered.length === existing.length) return state;
          return { hyperlinks: { ...state.hyperlinks, [workItemId]: filtered } };
        }

        // INSERT or UPDATE
        const link: Hyperlink = {
          id,
          workItemId,
          url: row.url as string,
          altText: (row.alt_text as string) ?? '',
          rank: (row.rank as number) ?? 0,
        };

        const existing = state.hyperlinks[workItemId] ?? [];
        const idx = existing.findIndex((l) => l.id === id);
        let newList: Hyperlink[];
        if (idx >= 0) {
          newList = [...existing];
          newList[idx] = link;
        } else {
          newList = [...existing, link];
        }
        newList.sort((a, b) => a.rank - b.rank);

        return { hyperlinks: { ...state.hyperlinks, [workItemId]: newList } };
      });
    },
  };
});
