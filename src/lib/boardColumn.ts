/**
 * Which column a board card is drawn in, and where in it.
 *
 * The board (BoardView) draws the columns and the store (reorderWorkItemInBoard)
 * works out where a drop lands from the drop zone's index, so both must see the
 * same column in the same order. They used to sort separately: the store broke
 * ties by id where the board kept the order the cards were collected in, and
 * left out cards the board files under Not Started. A tie is common — a card
 * with no board rank yet is placed by its list rank, which can equal another
 * card's board rank — so a drop could swap two cards nobody touched.
 */
import type { WorkItem } from "@/types/models";

/** The column a card is drawn in: its status, or Not Started when the board has
 *  no column for that status. */
export function boardColumnKey(status: string, columnKeys: ReadonlySet<string>): string {
  return columnKeys.has(status) ? status : "not_started";
}

/** A card's place in its column: its board rank, or its list rank until it has one. */
export function boardRankOf(wi: WorkItem, treeId: string): number {
  const bl = wi.backlogAssignments[treeId];
  return wi.boardRanks?.[bl] ?? wi.ranks?.[bl] ?? 0;
}

/** Board order. Ties keep the order the cards were collected in (the sort is
 *  stable), so callers must collect from `Object.values` of the store's items. */
export function byBoardRank(treeId: string) {
  return (a: WorkItem, b: WorkItem) => boardRankOf(a, treeId) - boardRankOf(b, treeId);
}
