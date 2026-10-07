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
import { validZoom, zoomStep, ZOOM_WIDTHS } from "@/lib/timeline";
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
