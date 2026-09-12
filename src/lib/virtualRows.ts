/**
 * Keeping a virtualised list's row heights honest when its width changes.
 *
 * A row's height depends on the width it has: a long title wraps onto two or
 * three lines. When the panel's width changes, cached heights go stale and the
 * rows end up painted on top of each other.
 */

/** Re-measures per second above which the width is taken to be oscillating. */
const RUNAWAY_LIMIT = 20;
const RUNAWAY_WINDOW_MS = 1000;

/**
 * Re-measure the rows a virtualizer currently has in the DOM.
 *
 * Use this — never `virtualizer.measure()` — when something outside the list
 * changes how tall its rows are. `measure()` *clears* every cached height back
 * to `estimateSize`, and lists keyed by item id keep the same DOM nodes across
 * that, so React never re-runs the `measureElement` refs: wrapped rows stay
 * stuck at the estimate and the rows below are painted on top of them.
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

export interface WidthRemeasureOptions {
  /** Test seams for the frame scheduler and the clock. */
  schedule?: (callback: () => void) => number;
  cancel?: (handle: number) => void;
  now?: () => number;
  /** Called instead of warning when observing gives up, for tests. */
  onRunaway?: (measures: number) => void;
}

/**
 * Re-measure the rendered rows whenever the container's width really changes.
 * Returns a disposer.
 *
 * Two things keep this from locking up the page, both learned the hard way —
 * an earlier version froze the tab on any list long enough to scroll:
 *
 * - It watches `offsetWidth`, not `clientWidth`. Re-measuring changes the
 *   list's total height, which can add or remove the vertical scrollbar; that
 *   changes `clientWidth` without the panel resizing at all, and measuring
 *   again at the new width can change the heights back. `offsetWidth` counts
 *   the scrollbar's space, so it doesn't move.
 * - It measures on the next frame instead of inside the observer's callback,
 *   at most once per frame, and gives up if the width will not settle. A stale
 *   row height is a visual glitch; a busy loop is a dead tab.
 */
export function observeWidthForRemeasure(
  container: HTMLElement | null,
  measureElement: (node: HTMLElement) => void,
  options: WidthRemeasureOptions = {},
): () => void {
  if (!container || typeof ResizeObserver === "undefined") return () => {};

  const schedule = options.schedule ?? ((cb: () => void) => requestAnimationFrame(cb));
  const cancel = options.cancel ?? ((handle: number) => cancelAnimationFrame(handle));
  const now = options.now ?? (() => Date.now());

  let lastWidth = container.offsetWidth;
  // `pending` rather than the handle alone: a scheduler that runs its callback
  // synchronously would return its handle only after the callback had already
  // cleared it, leaving the guard set forever and every later resize ignored.
  let pending = false;
  let handle: number | null = null;
  let windowStart = now();
  let measuresInWindow = 0;
  let stopped = false;

  const measure = () => {
    pending = false;
    handle = null;
    if (stopped) return;
    const at = now();
    if (at - windowStart > RUNAWAY_WINDOW_MS) {
      windowStart = at;
      measuresInWindow = 0;
    }
    measuresInWindow += 1;
    if (measuresInWindow > RUNAWAY_LIMIT) {
      stopped = true;
      observer.disconnect();
      if (options.onRunaway) options.onRunaway(measuresInWindow);
      else console.warn("[virtualRows] the list's width kept changing while re-measuring; stopped watching it to keep the page responsive");
      return;
    }
    remeasureRenderedRows(container, measureElement);
  };

  const observer = new ResizeObserver(() => {
    if (stopped || pending) return;
    const width = container.offsetWidth;
    if (width === lastWidth) return;
    lastWidth = width;
    pending = true;
    handle = schedule(measure);
  });

  observer.observe(container);
  return () => {
    stopped = true;
    if (handle !== null) cancel(handle);
    observer.disconnect();
  };
}
