/**
 * Re-measure the rows a virtualizer currently has in the DOM.
 *
 * Use this — never `virtualizer.measure()` — when something outside the list
 * changes how tall its rows are, such as the container's width making titles
 * wrap. `measure()` *clears* every cached height back to `estimateSize`, and
 * lists keyed by item id keep the same DOM nodes across that, so React never
 * re-runs the `measureElement` refs: wrapped rows stay stuck at the estimate
 * and the rows below are painted on top of them.
 *
 * Reading each rendered row instead keeps every known height and replaces it
 * with what the DOM actually shows. Rows that are not rendered are measured
 * when they next mount.
 */
export function remeasureRenderedRows(
  container: HTMLElement | null,
  measureElement: (node: HTMLElement) => void,
): number {
  if (!container) return 0;
  // The virtualizer finds a row's index from this attribute, so only elements
  // carrying it can be measured.
  const rows = container.querySelectorAll<HTMLElement>("[data-index]");
  rows.forEach((row) => measureElement(row));
  return rows.length;
}
