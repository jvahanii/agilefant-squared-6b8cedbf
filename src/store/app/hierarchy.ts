/**
 * Helpers on the item and list hierarchies: where an item ranks and sits, what
 * moving or removing one leaves behind, and what to select once some are gone.
 * Taken out of appStore.ts word for word.
 */
import { type Backlog, type Hyperlink, type WorkItem, getEffectiveParentId } from "@/types/models";
import type { AppState } from "./types";
import { visibleWorkItemIdsRef, visibleBacklogIdsRef } from "../navigationRefs";

/**
 * Given a set of work-item IDs that are about to be deleted, compute the best
 * work item to select afterwards.  Prefers the item immediately above the first
 * deleted item in the current visible order; falls back to the item below.
 */
export function computeNextWorkItemSelection(deletedIds: Set<string>, direction: 'up' | 'down' = 'up'): string | null {
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

/**
 * The backlogs the work item panel is showing: each selected backlog and
 * every backlog beneath it, since selecting a backlog shows its whole
 * subtree. Used to tell whether a move takes an item off screen.
 */
export function shownBacklogIds(backlogs: Record<string, Backlog>, selectedBacklogIds: string[]): Set<string> {
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
export function computeNextBacklogSelection(deletedIds: Set<string>, direction: 'up' | 'down' = 'up'): string | null {
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

/** Get the rank of a work item in a specific tree context. */
export function getWorkItemRank(item: WorkItem, treeId: string): number {
  const backlogId = item.backlogAssignments[treeId];
  return backlogId ? (item.ranks[backlogId] ?? 0) : 0;
}

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

export function dedupWorkItemRanksInPlace(items: Record<string, WorkItem>, repairs?: LoadRankRepair[]): void {
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

export const ensureCleanId = (id: string, orgId: string): string => {
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
export function findSurvivingAncestor(
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
export function repairOrphanedSurvivors(
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

export function applyWorkItemIdRenames(
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
export function buildCascadedShiftSet(
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

export function getVisibleBacklogIds(
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

export function assignSequentialRanksForContext(
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

/** Lists `childId` among `parentId`'s children, once, where that parent is there. Changes `items`. */
export function addChild(items: Record<string, WorkItem>, parentId: string | null, childId: string): void {
  const parent = parentId ? items[parentId] : undefined;
  if (!parentId || !parent || parent.childrenIds.includes(childId)) return;
  items[parentId] = { ...parent, childrenIds: [...parent.childrenIds, childId] };
}

/** Takes `childId` off `parentId`'s children, where that parent is there. Changes `items`. */
export function removeChild(items: Record<string, WorkItem>, parentId: string, childId: string): void {
  const parent = items[parentId];
  if (!parent) return;
  items[parentId] = { ...parent, childrenIds: parent.childrenIds.filter((id) => id !== childId) };
}

/**
 * One past the highest rank in list `backlogId` among the items under
 * `parentId` in `treeId` — the item being moved aside — so that it goes last
 * among its new siblings.
 */
export function nextRankAmongSiblings(
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
export function moveDescendantsToList(
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
export function spreadMergedSiblingRanks(
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
