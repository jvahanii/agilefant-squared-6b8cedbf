/**
 * List ↔ board rank reconciliation.
 *
 * List rank and board rank are separate stored attributes, but they must never
 * contradict each other for items that share the same status *and* the same
 * list context (same effective parent + same backlog).  The rule:
 *
 *   If A is above B in the list and both have the same status, then A must be
 *   above B in that status column on the board — and vice versa after a board
 *   drag.
 *
 * The reconciliation works by *slot redistribution*: the set of rank values
 * already held by the same-status members of a group is kept intact and simply
 * re-handed-out following the order coming from the other view.  Items of other
 * statuses (and items outside the group) therefore never move.
 */

export interface RankSyncMember {
  id: string;
  status: string;
  /** Current rank in the view that is being reconciled (the target view). */
  rank: number;
}

/**
 * Reassign the rank values held by same-status members so that their order
 * follows `desiredOrder` (the order coming from the source view).
 *
 * Returns only the ids whose rank actually changes.
 */
export function redistributeRanksByStatus(
  members: RankSyncMember[],
  desiredOrder: string[],
): Record<string, number> {
  const byId = new Map(members.map((m) => [m.id, m]));
  const groups = new Map<string, RankSyncMember[]>();
  for (const m of members) {
    const list = groups.get(m.status) ?? [];
    list.push(m);
    groups.set(m.status, list);
  }

  const result: Record<string, number> = {};
  for (const [status, group] of groups) {
    if (group.length < 2) continue;
    // Rank slots currently occupied by this status group, ascending.
    const slots = group.map((m) => m.rank).sort((a, b) => a - b);
    // Group members in the order dictated by the source view.
    const ordered = desiredOrder.filter((id) => byId.get(id)?.status === status);
    // Any member missing from desiredOrder keeps its relative position at the end.
    for (const m of group) if (!ordered.includes(m.id)) ordered.push(m.id);

    ordered.forEach((id, i) => {
      const slot = slots[i];
      if (slot === undefined) return;
      if (byId.get(id)!.rank !== slot) result[id] = slot;
    });
  }
  return result;
}

/**
 * List ranks for one sibling group (same backlog, same effective parent) after
 * a board drop, so that the group's cards in that column follow `columnOrder`.
 *
 * `siblings` is the whole group in list order (as the list draws it: rank, then
 * id), with each item's rank as the list reads it (a missing rank reads as 0).
 * The cards in the column take over the list positions the column's cards
 * already hold, in column order; everything else keeps its position. Each
 * position keeps the rank value it had — which is exactly the slot
 * redistribution of `redistributeRanksByStatus` while ranks are distinct.
 *
 * Ranks are not always distinct: two items can share one, or an item can lack
 * one and read as 0. Handing such slots round left the column's cards on equal
 * ranks, which the list then ordered by id, not as the board showed them. So a
 * rank that is not above the one before it is raised to one more than that,
 * which may move later items up by one too; their order does not change.
 *
 * Returns only the ids whose rank changes.
 */
export function listRanksFollowingColumn(
  siblings: { id: string; rank: number }[],
  columnOrder: string[],
): Record<string, number> {
  const inGroup = new Set(siblings.map((s) => s.id));
  const columnCards = columnOrder.filter((id) => inGroup.has(id));
  const inColumn = new Set(columnCards);
  // One card alone has no order to express, as in redistributeRanksByStatus.
  if (inColumn.size < 2) return {};

  let next = 0;
  const order = siblings.map((s) => (inColumn.has(s.id) ? columnCards[next++] : s.id));
  const rankOf = new Map(siblings.map((s) => [s.id, s.rank]));

  const result: Record<string, number> = {};
  let previous = -Infinity;
  order.forEach((id, position) => {
    const slot = siblings[position].rank;
    const rank = slot > previous ? slot : previous + 1;
    if (rank !== rankOf.get(id)) result[id] = rank;
    previous = rank;
  });
  return result;
}

/**
 * Compute a board rank that inserts `movedId` into an existing column so that
 * its position relative to the given same-context siblings matches their list
 * order.  `columnCards` must be the column's cards in board order.
 *
 * Returns the board rank to assign, or `null` when no meaningful constraint
 * exists (in which case the caller should append to the column).
 */
export function boardRankFromListPosition(
  movedId: string,
  movedListRank: number,
  columnCards: { id: string; boardRank: number; listRank: number | null }[],
): number | null {
  const others = columnCards.filter((c) => c.id !== movedId);
  if (others.length === 0) return null;

  // Constrained siblings = column cards that have a comparable list rank.
  const siblings = others.filter((c) => c.listRank !== null);
  if (siblings.length === 0) return null;

  // First sibling that should come *after* the moved item in the list.
  const nextSibling = siblings.find((c) => (c.listRank as number) > movedListRank);
  if (!nextSibling) return null; // belongs at the end → caller appends

  const idx = others.findIndex((c) => c.id === nextSibling.id);
  const prev = idx > 0 ? others[idx - 1].boardRank : null;
  const next = nextSibling.boardRank;
  if (prev === null) return next - 1;
  return prev + (next - prev) / 2;
}
