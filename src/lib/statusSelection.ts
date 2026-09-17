/**
 * Where the selection goes after a status change moved the selected items.
 *
 * In a list sorted by status, marking an item done sends it to the done group,
 * possibly far down the list. Selection used to follow it there, as if the list
 * were in rank order, where a status change never moves anything. Working down
 * a list one item at a time then lost its place on every key press. So when the
 * change moved the selection, the row below the old spot is selected instead —
 * the next item in the order that was on screen — or the row above when there
 * is nothing below.
 *
 * Returns null when nothing should change: the change moved no selected item,
 * or no other row is left to select.
 */
export function rowAfterStatusMove({
  visibleBefore,
  selectedIds,
  orderBefore,
  orderAfter,
  isInsideSelected,
}: {
  /** The rows as shown before the change, top to bottom. */
  visibleBefore: readonly string[];
  selectedIds: readonly string[];
  /** The top-level items in the list's sort order, before and after. */
  orderBefore: readonly string[];
  orderAfter: readonly string[];
  /** Whether a row is a descendant of a selected item — it moves with it. */
  isInsideSelected: (id: string) => boolean;
}): string | null {
  const moved = selectedIds.some((id) => {
    const before = orderBefore.indexOf(id);
    return before !== -1 && before !== orderAfter.indexOf(id);
  });
  if (!moved) return null;

  const selected = new Set(selectedIds);
  const leaves = (id: string) => selected.has(id) || isInsideSelected(id);
  const first = visibleBefore.findIndex((id) => selected.has(id));
  if (first === -1) return null;

  for (let i = first + 1; i < visibleBefore.length; i++) {
    if (!leaves(visibleBefore[i])) return visibleBefore[i];
  }
  for (let i = first - 1; i >= 0; i--) {
    if (!leaves(visibleBefore[i])) return visibleBefore[i];
  }
  return null;
}
