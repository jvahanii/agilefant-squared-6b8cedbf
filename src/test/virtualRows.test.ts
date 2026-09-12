/**
 * Re-measuring rendered rows, the safe alternative to virtualizer.measure().
 *
 * The list view keys rows by work item id, so React reuses their DOM nodes.
 * Clearing the virtualizer's cached heights therefore leaves them at the
 * estimate — a wrapped title keeps a one-line slot and the next row is painted
 * over it, which is what a container width change used to do.
 */
import { describe, it, expect, vi } from "vitest";
import { remeasureRenderedRows } from "@/lib/virtualRows";

function container(indices: (number | null)[]): HTMLElement {
  const el = document.createElement("div");
  for (const i of indices) {
    const row = document.createElement("div");
    if (i !== null) row.setAttribute("data-index", String(i));
    el.appendChild(row);
  }
  return el;
}

describe("remeasureRenderedRows", () => {
  it("measures every rendered row, and nothing else", () => {
    const el = container([0, 1, 2, null]);
    const measure = vi.fn();

    expect(remeasureRenderedRows(el, measure)).toBe(3);
    expect(measure).toHaveBeenCalledTimes(3);
    expect(measure.mock.calls.map(([node]) => (node as HTMLElement).getAttribute("data-index"))).toEqual(["0", "1", "2"]);
  });

  it("does nothing without a container", () => {
    const measure = vi.fn();
    expect(remeasureRenderedRows(null, measure)).toBe(0);
    expect(measure).not.toHaveBeenCalled();
  });
});
