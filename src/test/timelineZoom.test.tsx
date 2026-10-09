/**
 * Zooming the timeline.
 *
 * The scale is chosen from the span of the dates until the reader zooms; from
 * then on theirs is used, for every list and on the next visit, until they
 * hand the choice back. Pinned here: the steps and where they stop, that the
 * bars are redrawn at the new scale, that the choice is kept, and that the day
 * in the middle of the screen stays there.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { TimelineView } from "@/components/TimelineView";
import {
  dayNumber,
  fitWidth,
  MIN_FIT_WIDTH,
  scrollToShow,
  spanOf,
  validZoom,
  widthToShow,
  yearTicks,
  zoomStep,
  ZOOM_WIDTHS,
} from "@/lib/timeline";
import { overlayOpen } from "@/lib/overlayLock";
import { useAppStore } from "@/store/appStore";
import type { WorkItem } from "@/types/models";

describe("the steps", () => {
  it("go to the next width in or out", () => {
    expect(zoomStep(24, 1)).toBe(40);
    expect(zoomStep(24, -1)).toBe(16);
    expect(zoomStep(10, -1)).toBe(6);
  });

  it("stop at the ends of the scale", () => {
    expect(zoomStep(ZOOM_WIDTHS[ZOOM_WIDTHS.length - 1], 1)).toBeNull();
    expect(zoomStep(ZOOM_WIDTHS[0], -1)).toBeNull();
  });

  it("include every width the automatic scale uses, so zooming starts from it", () => {
    for (const auto of [24, 10, 4, 2]) expect(ZOOM_WIDTHS).toContain(auto);
  });

  it("take a stored zoom only when it is one of the widths", () => {
    expect(validZoom("16")).toBe(16);
    expect(validZoom("17")).toBeNull();
    expect(validZoom(null)).toBeNull();
    expect(validZoom("wide")).toBeNull();
    // Fitted is a choice too, and is kept like the others.
    expect(validZoom("fit")).toBe("fit");
  });
});

describe("fitting the whole span to the screen", () => {
  const span = (days: number) => ({ start: 100, end: 100 + days - 1 });

  it("gives a day whatever width makes the span fill the room there is", () => {
    expect(fitWidth(span(1000), 1000)).toBe(1);
    expect(fitWidth(span(4000), 1000)).toBe(0.25);
    expect(fitWidth(span(100), 1000)).toBe(10);
  });

  it("does not stretch a few days across the whole screen", () => {
    expect(fitWidth(span(5), 1000)).toBe(ZOOM_WIDTHS[ZOOM_WIDTHS.length - 1]);
  });

  it("never draws a day at nothing at all, however long the span", () => {
    expect(fitWidth(span(1_000_000), 1000)).toBe(MIN_FIT_WIDTH);
  });

  it("has no answer without room to measure", () => {
    expect(fitWidth(span(100), 0)).toBeNull();
    expect(fitWidth(span(100), -20)).toBeNull();
  });

  it("names the years on the axis, each with the part of it shown", () => {
    const range = { start: dayNumber("2024-11-01")!, end: dayNumber("2026-02-10")! };
    expect(yearTicks(range)).toEqual([
      { from: dayNumber("2024-11-01"), days: 61, label: "2024" },
      { from: dayNumber("2025-01-01"), days: 365, label: "2025" },
      { from: dayNumber("2026-01-01"), days: 41, label: "2026" },
    ]);
  });
});

describe("a dialog open over the page", () => {
  it("is known to be open, so the page's Tab leaves the key to it", () => {
    expect(overlayOpen()).toBe(false);
    for (const role of ["dialog", "alertdialog", "menu"]) {
      const layer = document.createElement("div");
      layer.setAttribute("role", role);
      document.body.appendChild(layer);
      expect(overlayOpen(), role).toBe(true);
      layer.remove();
      expect(overlayOpen()).toBe(false);
    }
  });
});

describe("on the timeline", () => {
  const ORG = "test-org";
  const TREE = `${ORG}::bt-1`;
  const BL = `${ORG}::bl-1`;
  const item = (id: string, over: Partial<WorkItem> = {}): WorkItem => ({
    id,
    title: id,
    status: "not_started",
    parentId: null,
    childrenIds: [],
    backlogAssignments: { [TREE]: BL },
    ranks: { [BL]: 0 },
    ...over,
  });
  const show = () =>
    render(<TimelineView treeId={TREE} rootIds={["a"]} backlogIds={new Set([BL])} isScrambled={false} />);
  const bar = () => document.querySelector('[data-timeline-row="a"] [data-bar-kind]') as HTMLElement;
  const barWidth = () => parseFloat(bar().style.width);

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 12));
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
      backlogs: { [BL]: { id: BL, name: "Work", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
      // Five days, in a span short enough to be drawn at 24 pixels a day.
      workItems: { a: item("a", { startedOn: "2026-10-01", endedOn: "2026-10-05" }) },
      selectedWorkItemIds: [],
    });
    return () => vi.useRealTimers();
  });

  it("redraws the bars wider when zoomed in and narrower when zoomed out", () => {
    show();
    expect(barWidth()).toBe(5 * 24);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(barWidth()).toBe(5 * 40);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(barWidth()).toBe(5 * 16);
  });

  it("stops at the ends of the scale", () => {
    show();
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    for (let i = 0; i < ZOOM_WIDTHS.length; i++) fireEvent.click(zoomIn);
    expect(zoomIn).toBeDisabled();
    expect(barWidth()).toBe(5 * ZOOM_WIDTHS[ZOOM_WIDTHS.length - 1]);

    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    for (let i = 0; i < ZOOM_WIDTHS.length; i++) fireEvent.click(zoomOut);
    expect(zoomOut).toBeDisabled();
    expect(barWidth()).toBe(5 * ZOOM_WIDTHS[0]);
  });

  it("offers the way back only once a zoom has been chosen, and takes it", () => {
    show();
    expect(screen.queryByRole("button", { name: "Reset zoom" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(barWidth()).toBe(5 * 24);
    expect(screen.queryByRole("button", { name: "Reset zoom" })).not.toBeInTheDocument();
  });

  it("keeps the zoom for the next visit, and forgets it when handed back", () => {
    const first = show();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    first.unmount();

    const second = show();
    expect(barWidth()).toBe(5 * 40);
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    second.unmount();

    show();
    expect(barWidth()).toBe(5 * 24);
  });

  it("keeps the day in the middle of the screen where it is", () => {
    show();
    const region = screen.getByRole("region", { name: "Timeline" });
    // 280 pixels of names, then 480 of calendar: its middle is 240 pixels in.
    Object.defineProperty(region, "clientWidth", { configurable: true, value: 760 });
    region.scrollLeft = 120;
    // Day 15 of the span is in the middle: (120 + 240) / 24.
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(region.scrollLeft).toBe(15 * 40 - 240);
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(region.scrollLeft).toBe(120);
  });

  it("moves a bar by whole days at the scale it is zoomed to", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const pointer = (type: string, clientX: number) =>
      fireEvent(bar(), new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 }));
    pointer("pointerdown", 500);
    pointer("pointermove", 500 + 2 * 40);
    pointer("pointerup", 500 + 2 * 40);
    expect(useAppStore.getState().workItems.a).toMatchObject({ startedOn: "2026-10-03", endedOn: "2026-10-07" });
  });
});

describe("fit all, on the timeline", () => {
  const ORG = "test-org";
  const TREE = `${ORG}::bt-1`;
  const BL = `${ORG}::bl-1`;
  const item = (id: string, startedOn: string, endedOn: string): WorkItem => ({
    id,
    title: id,
    status: "not_started",
    parentId: null,
    childrenIds: [],
    backlogAssignments: { [TREE]: BL },
    ranks: { [BL]: 0 },
    startedOn,
    endedOn,
  });
  const bars = () => [...document.querySelectorAll("[data-bar-kind]")] as HTMLElement[];
  const rightEdge = (bar: HTMLElement) => parseFloat(bar.style.left) + parseFloat(bar.style.width);
  // jsdom lays nothing out: say how wide the view is. 280 pixels of names and
  // 1000 of calendar.
  const VIEW = 1280;
  let clientWidth: PropertyDescriptor | undefined;

  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 9, 12));
    clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get(this: HTMLElement) {
        return this.getAttribute("aria-label") === "Timeline" ? VIEW : 0;
      },
    });
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
      backlogs: { [BL]: { id: BL, name: "Work", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
      // Nearly three years end to end: far more than a screen at any zoom step.
      workItems: { old: item("old", "2024-01-08", "2024-03-01"), now: item("now", "2026-10-01", "2026-10-05") },
      selectedWorkItemIds: [],
    });
    return () => {
      vi.useRealTimers();
      if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth);
    };
  });
  const show = () =>
    render(<TimelineView treeId={TREE} rootIds={["old", "now"]} backlogIds={new Set([BL])} isScrambled={false} />);

  it("does not fit a long span on the screen until asked", () => {
    show();
    expect(Math.max(...bars().map(rightEdge))).toBeGreaterThan(VIEW - 280);
    expect(screen.getByRole("button", { name: "Fit all" })).toHaveAttribute("aria-pressed", "false");
  });

  it("zooms out until every bar is on the screen", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Fit all" }));
    expect(bars()).toHaveLength(2);
    for (const bar of bars()) {
      expect(parseFloat(bar.style.left)).toBeGreaterThanOrEqual(0);
      expect(rightEdge(bar)).toBeLessThanOrEqual(VIEW - 280);
    }
    expect(screen.getByRole("button", { name: "Fit all" })).toHaveAttribute("aria-pressed", "true");
  });

  it("names the years once months are too narrow to name", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Fit all" }));
    const axis = [...document.querySelectorAll("[data-axis]")];
    expect(new Set(axis.map((el) => el.getAttribute("data-axis")))).toEqual(new Set(["year"]));
    expect(axis.map((el) => el.textContent)).toEqual(["2024", "2025", "2026"]);
  });

  it("is kept for the next visit, and handed back with Reset zoom", () => {
    const first = show();
    fireEvent.click(screen.getByRole("button", { name: "Fit all" }));
    first.unmount();

    show();
    expect(Math.max(...bars().map(rightEdge))).toBeLessThanOrEqual(VIEW - 280);
    fireEvent.click(screen.getByRole("button", { name: "Reset zoom" }));
    expect(Math.max(...bars().map(rightEdge))).toBeGreaterThan(VIEW - 280);
  });

  it("can be zoomed in from, a step at a time", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Fit all" }));
    const fitted = parseFloat(bars()[1].style.width);
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    // A five-day bar at the first step wider than the fitted scale: 2 pixels a day.
    expect(parseFloat(bars()[1].style.width)).toBe(5 * 2);
    expect(5 * 2).toBeGreaterThan(fitted);
  });
});

describe("bringing a selection into view", () => {
  const today = dayNumber("2026-10-09")!;

  describe("the days it covers", () => {
    it("run from the earliest bar's first day to the latest bar's last, and so take in all between", () => {
      expect(
        spanOf(
          [
            { startedOn: "2026-10-01", endedOn: "2026-10-05" },
            { startedOn: "2026-06-10", endedOn: "2026-06-12" },
            { endedOn: "2026-11-02" },
          ],
          today,
        ),
      ).toEqual({ from: dayNumber("2026-06-10"), to: dayNumber("2026-11-02") });
    });

    it("count work still going as far as today", () => {
      expect(spanOf([{ startedOn: "2026-10-01" }], today)).toEqual({ from: dayNumber("2026-10-01"), to: today });
    });

    it("are none when nothing selected has a date", () => {
      expect(spanOf([{}, {}], today)).toBeNull();
      expect(spanOf([], today)).toBeNull();
    });
  });

  describe("the zoom it takes", () => {
    it("is left alone when the days already fit", () => {
      expect(widthToShow(30, 1000, 24)).toBeNull();
      expect(widthToShow(100, 1000, 10)).toBeNull();
    });

    it("is the widest step that fits them, never a wider one than now", () => {
      expect(widthToShow(60, 1000, 24)).toBe(16);
      expect(widthToShow(200, 1000, 24)).toBe(4);
    });

    it("is narrower than every step only for a span no step can hold", () => {
      expect(widthToShow(2000, 1000, 2)).toBe(0.5);
    });

    it("has no answer without room to measure", () => {
      expect(widthToShow(60, 0, 24)).toBeNull();
    });
  });

  describe("where the calendar is scrolled to", () => {
    const range = { start: 1000, end: 1999 };
    const days = (from: number, to: number) => ({ from: 1000 + from, to: 1000 + to });

    it("is left alone when the days are already in view", () => {
      // Days 20–29 at 10 pixels: 200–300, inside 100–600.
      expect(scrollToShow(days(20, 29), range, 10, 100, 500)).toBeNull();
    });

    it("brings days off to the left in at the left edge, with a little air", () => {
      expect(scrollToShow(days(5, 9), range, 10, 400, 500)).toBe(50 - 16);
    });

    it("brings days off to the right in at the right edge, with a little air", () => {
      // Ends at 1000; a view 500 wide must start at 500, plus the air.
      expect(scrollToShow(days(95, 99), range, 10, 0, 500)).toBe(1000 - 500 + 16);
    });

    it("never scrolls before the start of the calendar", () => {
      expect(scrollToShow(days(0, 2), range, 10, 400, 500)).toBe(0);
    });
  });

  describe("on the timeline", () => {
    const ORG = "test-org";
    const TREE = `${ORG}::bt-1`;
    const BL = `${ORG}::bl-1`;
    const item = (id: string, dates: Partial<WorkItem>): WorkItem => ({
      id,
      title: id,
      status: "not_started",
      parentId: null,
      childrenIds: [],
      backlogAssignments: { [TREE]: BL },
      ranks: { [BL]: 0 },
      ...dates,
    });
    const VIEW = 1280; // 280 pixels of names, 1000 of calendar
    const CALENDAR = VIEW - 280;
    let clientWidth: PropertyDescriptor | undefined;
    const region = () => screen.getByRole("region", { name: "Timeline" });
    const row = (id: string) => document.querySelector(`[data-timeline-row="${id}"]`) as HTMLElement;
    const bar = (id: string) => row(id).querySelector("[data-bar-kind]") as HTMLElement;
    const inView = (id: string) => {
      const left = parseFloat(bar(id).style.left);
      const right = left + parseFloat(bar(id).style.width);
      return left >= region().scrollLeft && right <= region().scrollLeft + CALENDAR;
    };
    const dayPixels = () => parseFloat(bar("now").style.width) / 5;

    beforeEach(() => {
      localStorage.clear();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 9, 9, 12));
      clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
      Object.defineProperty(HTMLElement.prototype, "clientWidth", {
        configurable: true,
        get(this: HTMLElement) {
          return this.getAttribute("aria-label") === "Timeline" ? VIEW : 0;
        },
      });
      useAppStore.setState({
        organizationId: ORG,
        backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
        backlogs: { [BL]: { id: BL, name: "Work", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
        workItems: {
          old: item("old", { startedOn: "2024-01-08", endedOn: "2024-03-01" }),
          now: item("now", { startedOn: "2026-10-01", endedOn: "2026-10-05" }),
          undated: item("undated", {}),
        },
        selectedWorkItemIds: [],
      });
      return () => {
        vi.useRealTimers();
        if (clientWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", clientWidth);
      };
    });
    const show = () => {
      const view = render(
        <TimelineView treeId={TREE} rootIds={["old", "now", "undated"]} backlogIds={new Set([BL])} isScrambled={false} />,
      );
      // Every row, dated or not.
      fireEvent.click(screen.getByRole("checkbox", { name: "With dates only" }));
      return view;
    };

    it("opens on today, with the old work far off to the left", () => {
      show();
      expect(inView("now")).toBe(true);
      expect(inView("old")).toBe(false);
    });

    it("scrolls to an item's bar when its row is selected, at the scale it was", () => {
      show();
      const before = dayPixels();
      fireEvent.click(row("old"));
      expect(inView("old")).toBe(true);
      expect(dayPixels()).toBe(before);
    });

    it("zooms out to show two selected items and everything between them", () => {
      show();
      const before = dayPixels();
      fireEvent.click(row("old"));
      fireEvent.click(row("now"), { ctrlKey: true });
      expect(useAppStore.getState().selectedWorkItemIds.sort()).toEqual(["now", "old"]);
      expect(inView("old")).toBe(true);
      expect(inView("now")).toBe(true);
      expect(dayPixels()).toBeLessThan(before);
    });

    it("changes nothing for a selection already on screen", () => {
      show();
      const scrolled = region().scrollLeft;
      const before = dayPixels();
      fireEvent.click(row("now"));
      expect(region().scrollLeft).toBe(scrolled);
      expect(dayPixels()).toBe(before);
    });

    it("changes nothing for a row with no dates", () => {
      show();
      const scrolled = region().scrollLeft;
      fireEvent.click(row("undated"));
      expect(region().scrollLeft).toBe(scrolled);
    });

    it("does not zoom back in for a smaller selection, and leaves a zoom made afterwards alone", () => {
      show();
      fireEvent.click(row("old"));
      fireEvent.click(row("now"), { ctrlKey: true });
      const zoomedOut = dayPixels();
      fireEvent.click(row("now"));
      expect(dayPixels()).toBe(zoomedOut);
      // Zooming in by hand is not undone by the selection still being there.
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      expect(dayPixels()).toBeGreaterThan(zoomedOut);
    });
  });
});
