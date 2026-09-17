import type { Backlog, BacklogTree } from "@/types/models";

interface BacklogMoveStore {
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
  moveBacklog: (backlogId: string, targetParentId: string | null, treeId: string) => void;
  reorderBacklogAmongSiblings: (backlogId: string, targetIndex: number, targetParentId?: string | null, treeId?: string) => void;
}

/**
 * Drop backlogs into a slot: under `targetParentId` (or at the root of
 * `treeId`), at `slotIndex` among the siblings as they are shown.
 *
 * One backlog keeps the long-standing behaviour exactly. Several land together,
 * in the order given, starting where the slot is. The slot counts the siblings
 * as shown — possibly including some of the moved backlogs themselves — so the
 * moved ones are first gathered at the end, which leaves only the others ahead
 * of the insertion point, and then placed one after another from there.
 */
export function dropBacklogsAt(
  get: () => BacklogMoveStore,
  ids: string[],
  targetParentId: string | null,
  treeId: string,
  slotIndex: number,
) {
  if (ids.length === 0) return;
  const inTarget = (id: string) => {
    const bl = get().backlogs[id];
    return !!bl && bl.parentId === targetParentId && bl.treeId === treeId;
  };

  if (ids.length === 1) {
    const [id] = ids;
    if (!get().backlogs[id]) return;
    if (!inTarget(id)) get().moveBacklog(id, targetParentId, treeId);
    get().reorderBacklogAmongSiblings(id, slotIndex, targetParentId, treeId);
    return;
  }

  const moved = new Set(ids);
  const shown = targetParentId
    ? (get().backlogs[targetParentId]?.childrenIds ?? [])
    : (get().backlogTrees[treeId]?.rootBacklogIds ?? []);
  const base = shown.slice(0, slotIndex).filter((id) => !moved.has(id)).length;

  for (const id of ids) {
    if (!get().backlogs[id]) continue;
    if (!inTarget(id)) get().moveBacklog(id, targetParentId, treeId);
    get().reorderBacklogAmongSiblings(id, Number.MAX_SAFE_INTEGER, targetParentId, treeId);
  }
  ids
    .filter((id) => get().backlogs[id])
    .forEach((id, i) => get().reorderBacklogAmongSiblings(id, base + i, targetParentId, treeId));
}

/**
 * The backlogs a drag of `draggedId` carries, in the order they appear in
 * their tree.
 *
 * Dragging a backlog that is part of a multi-selection moves the whole
 * selection; dragging one outside it moves only that one, as before. A selected
 * backlog whose ancestor is also selected is left out — it travels inside its
 * ancestor, and moving it separately would pull it out of there. So is any
 * backlog the drop target sits in (or is): a backlog cannot move into itself.
 */
export function backlogsToMove(
  draggedId: string,
  selectedIds: string[],
  backlogs: Record<string, Backlog>,
  trees: Record<string, BacklogTree>,
  targetParentId: string | null,
): string[] {
  const selected = new Set(selectedIds.filter((id) => backlogs[id]));
  if (!selected.has(draggedId)) return backlogs[draggedId] ? [draggedId] : [];

  const hasSelectedAncestor = (id: string) => {
    for (let p = backlogs[id]?.parentId; p; p = backlogs[p]?.parentId) {
      if (selected.has(p)) return true;
    }
    return false;
  };
  const containsTarget = (id: string) => {
    for (let t: string | null | undefined = targetParentId; t; t = backlogs[t]?.parentId) {
      if (t === id) return true;
    }
    return false;
  };

  // Tree order: every root of the dragged backlog's tree, depth first.
  const treeId = backlogs[draggedId].treeId;
  const ordered: string[] = [];
  const visit = (id: string) => {
    if (!backlogs[id]) return;
    ordered.push(id);
    backlogs[id].childrenIds.forEach(visit);
  };
  (trees[treeId]?.rootBacklogIds ?? []).forEach(visit);
  // Anything the walk missed (a selection outside this tree) keeps selection order.
  for (const id of selected) if (!ordered.includes(id)) ordered.push(id);

  return ordered.filter((id) => selected.has(id) && !hasSelectedAncestor(id) && !containsTarget(id));
}
