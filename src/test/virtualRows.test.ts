/**
 * Row re-measuring, and the width watching around it.
 *
 * The list view keys rows by work item id, so React reuses their DOM nodes.
 * Clearing the virtualizer's cached heights therefore leaves them at the
 * estimate — a wrapped title keeps a one-line slot and the next row is painted
 * over it, which is what a container width change used to do.
 *
 * Watching for that width change has a trap of its own, which froze the live
 * app: re-measuring changes the list's height, that toggles the vertical
 * scrollbar, and the scrollbar changes clientWidth — so watching clientWidth
 * measures forever.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { observeWidthForRemeasure, remeasureRenderedRows } from "@/lib/virtualRows";

function container(indices: (number | null)[], widths: { offset: number; client: number }): HTMLElement {
  const el = document.createElement("div");
  for (const i of indices) {
    const row = document.createElement("div");
    if (i !== null) row.setAttribute("data-index", String(i));
    el.appendChild(row);
  }
  Object.defineProperty(el, "offsetWidth", { get: () => widths.offset, configurable: true });
  Object.defineProperty(el, "clientWidth", { get: () => widths.client, configurable: true });
  return el;
}

/** A ResizeObserver whose callbacks this test fires by hand. */
const callbacks: (() => void)[] = [];
class FakeResizeObserver {
  disconnected = false;
  private cb: () => void;
  constructor(cb: () => void) {
    this.cb = cb;
    callbacks.push(() => {
      if (!this.disconnected) this.cb();
    });
  }
  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true;
  }
}

beforeEach(() => {
  callbacks.length = 0;
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
});
afterEach(() => vi.unstubAllGlobals());

const fireResize = () => callbacks.forEach((cb) => cb());

describe("remeasureRenderedRows", () => {
  it("measures every rendered row, and nothing else", () => {
    const el = container([0, 1, 2, null], { offset: 300, client: 300 });
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

describe("observeWidthForRemeasure", () => {
  /** Runs scheduled frames immediately, like a browser that never idles. */
  const immediate = { schedule: (cb: () => void) => { cb(); return 1; }, cancel: () => {} };

  it("re-measures when the panel really gets narrower", () => {
    const widths = { offset: 400, client: 400 };
    const el = container([0, 1], widths);
    const measure = vi.fn();
    observeWidthForRemeasure(el, measure, immediate);

    widths.offset = 250;
    widths.client = 250;
    fireResize();
    expect(measure).toHaveBeenCalledTimes(2);
  });

  it("ignores a scrollbar appearing, which changes only clientWidth", () => {
    const widths = { offset: 400, client: 400 };
    const el = container([0, 1], widths);
    const measure = vi.fn();
    observeWidthForRemeasure(el, measure, immediate);

    widths.client = 385; // the vertical scrollbar, not a resize
    fireResize();
    expect(measure).not.toHaveBeenCalled();
  });

  it("gives up rather than measuring forever when the width oscillates", () => {
    const widths = { offset: 400, client: 400 };
    const el = container([0], widths);
    const measure = vi.fn();
    const onRunaway = vi.fn();
    let clock = 0;
    observeWidthForRemeasure(el, measure, { ...immediate, now: () => clock, onRunaway });

    // Every re-measure flips the width back and forth, within the same second.
    for (let i = 0; i < 200; i++) {
      widths.offset = i % 2 === 0 ? 385 : 400;
      clock += 1;
      fireResize();
    }
    expect(onRunaway).toHaveBeenCalledTimes(1);
    expect(measure.mock.calls.length).toBeLessThanOrEqual(20);

    // And it stays stopped.
    widths.offset = 123;
    fireResize();
    expect(measure.mock.calls.length).toBeLessThanOrEqual(20);
  });

  it("keeps working when the changes are spread over time", () => {
    const widths = { offset: 400, client: 400 };
    const el = container([0], widths);
    const measure = vi.fn();
    const onRunaway = vi.fn();
    let clock = 0;
    observeWidthForRemeasure(el, measure, { ...immediate, now: () => clock, onRunaway });

    for (let i = 0; i < 50; i++) {
      widths.offset = 300 + i;
      clock += 2000; // seconds apart: someone dragging a pane, not a loop
      fireResize();
    }
    expect(onRunaway).not.toHaveBeenCalled();
    expect(measure).toHaveBeenCalledTimes(50);
  });

  it("stops observing when disposed, and copes with no container", () => {
    const widths = { offset: 400, client: 400 };
    const el = container([0], widths);
    const measure = vi.fn();
    const dispose = observeWidthForRemeasure(el, measure, immediate);
    dispose();

    widths.offset = 200;
    fireResize();
    expect(measure).not.toHaveBeenCalled();
    expect(() => observeWidthForRemeasure(null, measure, immediate)()).not.toThrow();
  });
});
