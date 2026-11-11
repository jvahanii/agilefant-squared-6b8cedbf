/**
 * What a drop does, for each kind of thing dragged and each place it lands.
 *
 * AppLayout hands every finished drag to `handleDrop`, which looks the pair up
 * in `DROPS` — "workitem>board-column", "backlog-node>backlog", and so on — and
 * runs the matching function. A pair not in the table does nothing. The whole
 * drop is one undo step, however many store actions it takes.
 *
 * What is dragged and where it can land are declared by the components that
 * draw them (useDraggable / useDroppable `data`):
 *   workitem             a row, a board card or a search result
 *   backlog-node         a list in the tree panel
 *   tree-node            a tree in the tree panel
 *   board-column         a whole board column
 *   workitem-board-reorder  a slot between board cards
 *   workitem-reorder     a slot between list rows (or board cards: then it has a statusKey)
 *   workitem-parent      a row, to become its child
 *   workitem-root        the zone that makes an item top-level
 *   backlog              a list in the tree panel, to move into
 *   backlog-reorder      a slot between lists in the tree panel
 *   tree-reorder         a slot between trees
 */
import { toast } from "@/hooks/use-toast";
import { useAppStore } from "@/store/appStore";
import { requestTopLevelRerank } from "@/store/rerankGuardStore";
import { backlogsToMove, dropBacklogsAt } from "@/lib/backlogMove";
import { getEffectiveParentId, type WorkItemStatus } from "@/types/models";

/** The cross-tree question a drop onto another tree's list asks. */
export interface PendingCrossTreeDrop {
  workItemIds: string[];
  totalCount: number;
  targetBacklogId: string;
  targetTreeId: string;
  sourceTreeId: string;
  itemTitles: string[];
  sourceTreeName: string;
  targetTreeName: string;
}

/** A draggable's or droppable's `data`, as dnd-kit passes it on. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DropData = Record<string, any>;

interface Drop {
  dragged: DropData;
  target: DropData;
  /** The work items moved: the selection the drag carried, or the one item dragged. */
  draggedIds: string[];
  /** Ask whether to move or mirror items dropped on another tree's list. */
  askCrossTree: (question: PendingCrossTreeDrop) => void;
}

const store = () => useAppStore.getState();

/** How many items the ids stand for, children and their children included. */
export function countWithDescendants(ids: string[]): number {
  const { workItems } = store();
  const seen = new Set<string>();
  const collect = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    workItems[id]?.childrenIds.forEach(collect);
  };
  ids.forEach(collect);
  return seen.size;
}

/** The toast after items get a new parent; `parentTitle` null means they went to the top level. */
function toastReparented(count: number, parentTitle: string | null) {
  toast({
    title: parentTitle
      ? count === 1
        ? `Reparented to "${parentTitle}"`
        : `Reparented ${count} items to "${parentTitle}"`
      : count === 1
        ? "Moved to root (no parent)"
        : `Moved ${count} items to root`,
  });
}

const titleOf = (id: string) => store().workItems[id]?.title ?? "item";

/** Onto a board column: take its status, and go to the top of it. */
function toBoardColumn({ target, draggedIds }: Drop) {
  const statusKey = target.statusKey as WorkItemStatus;
  const treeId = target.treeId as string;
  const backlogIds = (target.backlogIds as string[]) ?? [];
  const { workItems } = store();
  draggedIds.forEach((id) => {
    const wi = workItems[id];
    if (wi && wi.status !== statusKey) store().setWorkItemStatus(id, statusKey);
  });
  // Index 0 places them before the column's first card.
  if (draggedIds.length > 0 && treeId && backlogIds.length > 0) {
    store().reorderWorkItemInBoard(draggedIds[0], 0, treeId, backlogIds);
  }
}

/**
 * Onto a list. In the same tree the items simply move there. Onto another
 * tree's list, items already in that tree just leave this one; the rest wait
 * for the answer to whether they move or are mirrored (answerCrossTree).
 */
function toList({ dragged, target, draggedIds, askCrossTree }: Drop) {
  const sourceTreeId = dragged.treeId as string;
  const targetTreeId = target.treeId as string;
  if (sourceTreeId === targetTreeId) {
    store().moveWorkItemsToBacklog(draggedIds, target.backlogId, target.treeId);
    return;
  }

  const s = store();
  const inTarget = (id: string) => s.workItems[id]?.backlogAssignments?.[targetTreeId] !== undefined;
  draggedIds.filter(inTarget).forEach((id) => store().removeWorkItemFromTree(id, sourceTreeId));

  const notInTarget = draggedIds.filter((id) => !inTarget(id));
  if (notInTarget.length === 0) return;
  askCrossTree({
    workItemIds: notInTarget,
    totalCount: countWithDescendants(notInTarget),
    targetBacklogId: target.backlogId,
    targetTreeId,
    sourceTreeId,
    itemTitles: notInTarget.map((id) => s.workItems[id]?.title ?? "").filter(Boolean),
    sourceTreeName: s.backlogTrees[sourceTreeId]?.name ?? sourceTreeId,
    targetTreeName: s.backlogTrees[targetTreeId]?.name ?? targetTreeId,
  });
}

/**
 * Onto an item: become its children. The item itself, if among the dragged,
 * stays put. The new parent opens, and the moved items end up selected — they
 * used to vanish into a closed branch, out of sight and, when a drag did not
 * start from the selection, not selected either.
 */
function toParentItem({ target, draggedIds }: Drop) {
  const parentId = target.workItemId;
  const ids = draggedIds.filter((id) => id !== parentId && store().workItems[id]);
  ids.forEach((id) => store().reparentWorkItem(id, parentId, target.treeId, target.backlogId));
  if (ids.length === 0) return;
  showUnder(parentId, target.treeId);
  store().selectWorkItemRange(ids, false);
  toastReparented(ids.length, titleOf(parentId));
}

/** Open an item and every item above it in the tree, so its children are in view. */
function showUnder(parentId: string, treeId: string | undefined) {
  const { workItems, expandedWorkItems } = store();
  const expanded = new Set(expandedWorkItems);
  const before = expanded.size;
  const seen = new Set<string>();
  for (let id: string | null = parentId; id && workItems[id] && !seen.has(id); ) {
    seen.add(id);
    expanded.add(id);
    id = treeId ? getEffectiveParentId(workItems[id], treeId) : workItems[id].parentId;
  }
  if (expanded.size !== before) useAppStore.setState({ expandedWorkItems: expanded });
}

/** Onto the root zone: become top-level items. */
function toRoot({ target, draggedIds }: Drop) {
  draggedIds.forEach((id) => store().reparentWorkItem(id, null, target.treeId, target.backlogId));
  toastReparented(draggedIds.length, null);
}

/** Into a slot between board cards: the board's own order, in that column. */
function toBoardSlot({ target, draggedIds }: Drop) {
  if (draggedIds.length === 0) return;
  store().reorderWorkItemInBoard(
    draggedIds[0],
    target.index as number,
    target.treeId as string,
    target.backlogIds as string[],
    target.statusKey as string | undefined,
  );
}

/**
 * Into a slot between list rows. A slot that carries a status is a board's,
 * and goes the board's way. Otherwise the items move to the slot's list and
 * parent, then into its place — all of it as one move, so that cancelling the
 * re-rank question (a list sorted by something other than rank) leaves nothing
 * half-moved.
 */
function toListSlot(drop: Drop) {
  const { target, draggedIds } = drop;
  const treeId = target.treeId as string;
  const backlogIds = target.backlogIds as string[];
  const statusKey = target.statusKey as string | undefined;
  if (statusKey && draggedIds.length > 0) {
    store().reorderWorkItemInBoard(draggedIds[0], target.index as number, treeId, backlogIds, statusKey);
    return;
  }
  // A drop between top-level items sets a top-level rank. The drop index
  // counts rows as shown, which after saving the shown order is the rank
  // order too, so the item lands where it was dropped.
  requestTopLevelRerank({
    treeId,
    backlogId: store().selectedBacklogIds[0] ?? backlogIds[0],
    backlogIds,
    touchesTopLevel: (target.parentId as string | null) === null,
    proceed: () => placeInList(drop),
  });
}

/** The list-slot move itself: list, then parent, then place among the siblings. */
function placeInList({ target, draggedIds }: Drop) {
  const parentId = target.parentId as string | null;
  const treeId = target.treeId as string;
  const backlogIds = target.backlogIds as string[];
  const backlogId = target.backlogId as string | undefined;

  // A slot among the rows of a sub-list (a parent list shows its sub-lists'
  // items together) moves the items into that sub-list first.
  if (backlogId) {
    const { workItems } = store();
    const idsToMove = draggedIds.filter((id) => {
      const current = workItems[id]?.backlogAssignments[treeId];
      return !!current && current !== backlogId;
    });
    if (idsToMove.length > 0) store().moveWorkItemsToBacklog(idsToMove, backlogId, treeId);
  }

  // Read again: the move above has changed the items.
  const { workItems } = store();
  const reparented: string[] = [];
  for (const id of draggedIds) {
    const wi = workItems[id];
    if (!wi || getEffectiveParentId(wi, treeId) === parentId) continue;
    store().reparentWorkItem(id, parentId, treeId, backlogId ?? backlogIds[0] ?? "");
    reparented.push(id);
  }
  // One call places the whole selection: reorderWorkItemAmongSiblings moves
  // every selected item, not just the one named, so a call per dragged item
  // would only add undo entries.
  if (draggedIds.length > 0) {
    store().reorderWorkItemAmongSiblings(draggedIds[0], target.index as number, treeId, backlogIds);
  }
  if (reparented.length > 0) toastReparented(reparented.length, parentId ? titleOf(parentId) : null);
}

/** A list into a slot between lists: the selection, if the list is in it, lands there together, in tree order. */
function listToListSlot({ dragged, target }: Drop) {
  const parentId = target.parentId as string | null;
  const s = store();
  const ids = backlogsToMove(dragged.backlogId as string, s.selectedBacklogIds, s.backlogs, s.backlogTrees, parentId);
  dropBacklogsAt(useAppStore.getState, ids, parentId, target.treeId as string, target.index as number);
}

/** A list onto a list: becomes its sub-list, with the rest of the selection. */
function listIntoList({ dragged, target }: Drop) {
  const parentId = target.backlogId as string;
  const s = store();
  const ids = backlogsToMove(dragged.backlogId as string, s.selectedBacklogIds, s.backlogs, s.backlogTrees, parentId);
  ids.forEach((id) => store().moveBacklog(id, parentId, target.treeId as string));
}

/** A tree into a slot between trees. */
function treeToTreeSlot({ dragged, target }: Drop) {
  store().reorderBacklogTree(dragged.treeId as string, target.index as number);
}

/** What each drag does on each drop target, keyed "dragged type>target type". */
const DROPS: Record<string, (drop: Drop) => void> = {
  "workitem>board-column": toBoardColumn,
  "workitem>backlog": toList,
  "workitem>workitem-parent": toParentItem,
  "workitem>workitem-root": toRoot,
  "workitem>workitem-board-reorder": toBoardSlot,
  "workitem>workitem-reorder": toListSlot,
  "backlog-node>backlog-reorder": listToListSlot,
  "backlog-node>backlog": listIntoList,
  "tree-node>tree-reorder": treeToTreeSlot,
};

/** Carry out a finished drag of `dragged` onto `target`. */
export function handleDrop(
  dragged: DropData | undefined,
  target: DropData | undefined,
  askCrossTree: (question: PendingCrossTreeDrop) => void,
) {
  const draggedIds: string[] = dragged?.selectedIds ?? [dragged?.workItemId];
  const key = `${dragged?.type}>${target?.type}`;
  // Multi-item drags and chained moves (list, parent, place) are one undo step.
  store().runBulk(() => {
    if (!dragged || !target || !Object.prototype.hasOwnProperty.call(DROPS, key)) return;
    DROPS[key]({ dragged, target, draggedIds, askCrossTree });
  });
}

/** The answer to the cross-tree question: "move" leaves the source tree, anything else mirrors. */
export function answerCrossTree(question: PendingCrossTreeDrop, answer: string) {
  const { workItemIds, targetBacklogId, targetTreeId, sourceTreeId } = question;
  store().runBulk(() => {
    store().moveWorkItemsToBacklog(workItemIds, targetBacklogId, targetTreeId);
    if (answer === "move") workItemIds.forEach((id) => store().removeWorkItemFromTree(id, sourceTreeId));
  });
}
