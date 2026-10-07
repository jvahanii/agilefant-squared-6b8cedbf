/**
 * Dragging a bar on the timeline to change an item's dates.
 *
 * By its middle the work moves in time and keeps its length; by an end it
 * grows or shrinks. Pinned here: what each drag does to the dates, that an end
 * stops at the other end, that nothing is saved until the pointer is let go,
 * and that letting go does not also open the dates dialog.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
}));

import { TimelineView } from "@/components/TimelineView";
import { dayNumber, dragDates } from "@/lib/timeline";
import { useAppStore } from "@/store/appStore";
import { upsertWorkItem } from "@/store/supabaseSync";
import type { WorkItem } from "@/types/models";

const today = dayNumber("2026-10-07")!;

describe("what a drag does to the dates", () => {
  const span = { startedOn: "2026-10-01", endedOn: "2026-10-05" };

  it("moves both dates together, keeping the length", () => {
    expect(dragDates(span, "move", 3, today)).toEqual({ startedOn: "2026-10-04", endedOn: "2026-10-08" });
    expect(dragDates(span, "move", -10, today)).toEqual({ startedOn: "2026-09-21", endedOn: "2026-09-25" });
  });

  it("moves only the end taken hold of", () => {
    expect(dragDates(span, "start", -2, today)).toEqual({ startedOn: "2026-09-29" });
    expect(dragDates(span, "end", 4, today)).toEqual({ endedOn: "2026-10-09" });
  });

  it("stops an end at the other end: one day at the least, never inside out", () => {
    expect(dragDates(span, "start", 30, today)).toEqual({ startedOn: "2026-10-05" });
    expect(dragDates(span, "end", -30, today)).toEqual({ endedOn: "2026-10-01" });
  });

  it("changes nothing for a drag that goes nowhere", () => {
    expect(dragDates(span, "move", 0, today)).toEqual({});
    const oneDay = { startedOn: "2026-10-01", endedOn: "2026-10-01" };
    expect(dragDates(oneDay, "start", 5, today)).toEqual({});
    expect(dragDates(oneDay, "end", -5, today)).toEqual({});
  });

  it("moves the one date an item has", () => {
    expect(dragDates({ startedOn: "2026-10-01" }, "move", 2, today)).toEqual({ startedOn: "2026-10-03" });
    expect(dragDates({ endedOn: "2026-10-05" }, "move", -1, today)).toEqual({ endedOn: "2026-10-04" });
  });

  it("gives work still going an end, from where its open end is drawn: today", () => {
    const going = { startedOn: "2026-10-01" };
    expect(dragDates(going, "end", 2, today)).toEqual({ endedOn: "2026-10-09" });
    expect(dragDates(going, "end", -3, today)).toEqual({ endedOn: "2026-10-04" });
    // Not before it began.
    expect(dragDates(going, "end", -30, today)).toEqual({ endedOn: "2026-10-01" });
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
  const seed = (items: WorkItem[]) =>
    useAppStore.setState({
      organizationId: ORG,
      backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
      backlogs: { [BL]: { id: BL, name: "Work", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
      workItems: Object.fromEntries(items.map((i) => [i.id, i])),
      selectedWorkItemIds: [],
      undoStack: [],
      redoStack: [],
    });
  const show = (ids: string[]) =>
    render(<TimelineView treeId={TREE} rootIds={ids} backlogIds={new Set([BL])} isScrambled={false} />);
  const stored = (id: string) => useAppStore.getState().workItems[id];
  const bar = (id: string) => document.querySelector(`[data-timeline-row="${id}"] [data-bar-kind]`) as HTMLElement;

  // A short span is drawn at 24 pixels a day.
  const DAY = 24;
  const pointer = (el: Element, type: string, clientX: number) =>
    fireEvent(el, new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 }));
  const drag = (from: Element, days: number, release = true) => {
    pointer(from, "pointerdown", 500);
    pointer(bar("a"), "pointermove", 500 + days * DAY);
    if (release) pointer(bar("a"), "pointerup", 500 + days * DAY);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date(2026, 9, 7, 12));
    (upsertWorkItem as unknown as { mockClear: () => void }).mockClear();
    seed([item("a", { startedOn: "2026-10-01", endedOn: "2026-10-05" })]);
    return () => vi.useRealTimers();
  });

  it("moves the work when the bar is dragged by its middle", () => {
    show(["a"]);
    drag(bar("a"), 3);
    expect(stored("a")).toMatchObject({ startedOn: "2026-10-04", endedOn: "2026-10-08" });
  });

  it("changes one end when that end is dragged", () => {
    show(["a"]);
    drag(bar("a").querySelector('[data-handle="end"]')!, 2);
    expect(stored("a")).toMatchObject({ startedOn: "2026-10-01", endedOn: "2026-10-07" });
    drag(bar("a").querySelector('[data-handle="start"]')!, -1);
    expect(stored("a")).toMatchObject({ startedOn: "2026-09-30", endedOn: "2026-10-07" });
  });

  it("shows where the drag has got to, and saves nothing until it is let go", () => {
    show(["a"]);
    drag(bar("a"), 2, false);
    expect(screen.getByRole("status")).toHaveTextContent(/3\.10\.?\D+7\.10\.?|10\/3\D+10\/7/);
    expect(stored("a")).toMatchObject({ startedOn: "2026-10-01", endedOn: "2026-10-05" });
    expect(upsertWorkItem).not.toHaveBeenCalled();

    pointer(bar("a"), "pointerup", 500 + 2 * DAY);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(stored("a")).toMatchObject({ startedOn: "2026-10-03", endedOn: "2026-10-07" });
    expect(upsertWorkItem).toHaveBeenCalledTimes(1);
  });

  it("is one step to undo", () => {
    show(["a"]);
    drag(bar("a"), 5);
    useAppStore.getState().undo();
    expect(stored("a")).toMatchObject({ startedOn: "2026-10-01", endedOn: "2026-10-05" });
  });

  it("does not open the dates dialog when the drag is let go", () => {
    show(["a"]);
    drag(bar("a"), 3);
    fireEvent.click(bar("a")); // the click a release brings with it
    expect(screen.queryByLabelText("Started on")).not.toBeInTheDocument();
    // A plain click afterwards still does.
    vi.advanceTimersByTime(200);
    fireEvent.click(bar("a"));
    expect(screen.getByLabelText("Started on")).toHaveValue("2026-10-04");
  });

  it("still opens the dialog on a click that moved nothing", () => {
    show(["a"]);
    drag(bar("a"), 0);
    fireEvent.click(bar("a"));
    expect(screen.getByLabelText("Started on")).toBeInTheDocument();
    expect(upsertWorkItem).not.toHaveBeenCalled();
  });

  it("drops the drag when it is cancelled", () => {
    show(["a"]);
    drag(bar("a"), 4, false);
    pointer(bar("a"), "pointercancel", 0);
    expect(stored("a")).toMatchObject({ startedOn: "2026-10-01", endedOn: "2026-10-05" });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("gives work still going an end date when its open end is dragged", () => {
    seed([item("a", { startedOn: "2026-10-01" })]);
    show(["a"]);
    drag(bar("a").querySelector('[data-handle="end"]')!, -2);
    expect(stored("a")).toMatchObject({ startedOn: "2026-10-01", endedOn: "2026-10-05" });
  });
});
