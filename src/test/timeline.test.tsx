/**
 * The timeline view: a list's items against a calendar, by start and end date.
 *
 * Two halves. The arithmetic — which days are drawn, how wide, where a bar
 * sits — is pure and pinned exactly. The view is pinned for what a person
 * relies on: which rows it shows, what each kind of bar means, that clicking a
 * row selects it and clicking a bar edits its dates.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
  updateBacklogViewMode: vi.fn(),
}));

import { TimelineView } from "@/components/TimelineView";
import {
  barFor,
  barPixels,
  dayIso,
  dayNumber,
  dayWidth,
  isWeekend,
  monthTicks,
  timelineRange,
  todayNumber,
  weekStarts,
} from "@/lib/timeline";
import { useAppStore } from "@/store/appStore";
import { visibleWorkItemIdsRef } from "@/store/navigationRefs";
import type { WorkItem } from "@/types/models";

const day = (iso: string) => dayNumber(iso)!;

describe("counting days", () => {
  it("turns a date into a day number and back", () => {
    expect(day("1970-01-01")).toBe(0);
    expect(day("2026-10-07") - day("2026-10-01")).toBe(6);
    expect(dayIso(day("2026-10-07"))).toBe("2026-10-07");
  });

  it("keeps every day one unit wide across a clock change", () => {
    // Finland's clocks go back on 25 October 2026; the days either side still differ by one.
    expect(day("2026-10-26") - day("2026-10-24")).toBe(2);
  });

  it("refuses anything that is not a date", () => {
    expect(dayNumber("7.10.2026")).toBeNull();
    expect(dayNumber("")).toBeNull();
    expect(dayNumber(undefined)).toBeNull();
  });

  it("reads today off the reader's own calendar", () => {
    expect(todayNumber(new Date(2026, 9, 7, 23, 30))).toBe(day("2026-10-07"));
    expect(todayNumber(new Date(2026, 9, 7, 0, 5))).toBe(day("2026-10-07"));
  });

  it("knows its weekends and Mondays", () => {
    expect(isWeekend(day("2026-10-10"))).toBe(true); // Saturday
    expect(isWeekend(day("2026-10-11"))).toBe(true); // Sunday
    expect(isWeekend(day("2026-10-12"))).toBe(false); // Monday
    expect(weekStarts({ start: day("2026-10-01"), end: day("2026-10-20") }).map(dayIso)).toEqual([
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
  });
});

describe("the span drawn", () => {
  const today = day("2026-10-07");

  it("runs from a week before the earliest date to a week after the latest", () => {
    const range = timelineRange([{ startedOn: "2026-09-10", endedOn: "2026-09-20" }, { endedOn: "2026-11-02" }], today);
    expect(dayIso(range.start)).toBe("2026-09-03");
    expect(dayIso(range.end)).toBe("2026-11-09");
  });

  it("always takes in today", () => {
    const past = timelineRange([{ startedOn: "2026-06-01", endedOn: "2026-06-10" }], today);
    expect(past.end).toBe(today + 7);
    const future = timelineRange([{ startedOn: "2026-12-01" }], today);
    expect(future.start).toBe(today - 7);
  });

  it("is the month around today when nothing has a date", () => {
    const range = timelineRange([{}, {}], today);
    expect(range).toEqual({ start: today - 15, end: today + 15 });
  });

  it("gives a day less room the longer the span", () => {
    const span = (days: number) => dayWidth({ start: 0, end: days - 1 });
    expect(span(31)).toBe(24);
    expect(span(120)).toBe(10);
    expect(span(400)).toBe(4);
    expect(span(1500)).toBe(2);
  });

  it("labels each month with the part of it shown, the year on the first and on January", () => {
    const ticks = monthTicks({ start: day("2026-11-20"), end: day("2027-02-03") }, "en-GB");
    expect(ticks.map((t) => [t.label, t.days])).toEqual([
      ["Nov 2026", 11],
      ["Dec", 31],
      ["Jan 2027", 31],
      ["Feb", 3],
    ]);
  });
});

describe("an item's bar", () => {
  const today = day("2026-10-07");

  it("is a closed span when the work has both dates", () => {
    expect(barFor({ startedOn: "2026-10-01", endedOn: "2026-10-05" }, today)).toEqual({
      kind: "span",
      from: day("2026-10-01"),
      to: day("2026-10-05"),
    });
  });

  it("runs to today, open-ended, when the work has started and not ended", () => {
    expect(barFor({ startedOn: "2026-10-01" }, today)).toEqual({ kind: "ongoing", from: day("2026-10-01"), to: today });
    expect(barFor({ startedOn: "2026-10-07" }, today)?.kind).toBe("ongoing");
  });

  it("is a marker on its start when that is still to come", () => {
    expect(barFor({ startedOn: "2026-11-01" }, today)).toEqual({ kind: "planned", from: day("2026-11-01"), to: day("2026-11-01") });
  });

  it("is a marker on its end when no start was recorded", () => {
    expect(barFor({ endedOn: "2026-10-05" }, today)?.kind).toBe("end-only");
  });

  it("is nothing when the item has neither date", () => {
    expect(barFor({}, today)).toBeNull();
  });

  it("draws an end before its start as the days between, rather than not at all", () => {
    expect(barFor({ startedOn: "2026-10-05", endedOn: "2026-10-01" }, today)).toMatchObject({
      from: day("2026-10-01"),
      to: day("2026-10-05"),
    });
  });

  it("covers both its first and its last day", () => {
    const range = { start: day("2026-09-24"), end: day("2026-10-14") };
    const bar = barFor({ startedOn: "2026-10-01", endedOn: "2026-10-05" }, today)!;
    expect(barPixels(bar, range, 24)).toEqual({ left: 7 * 24, width: 5 * 24 });
  });
});

describe("the view", () => {
  const ORG = "test-org";
  const TREE = `${ORG}::bt-1`;
  const BL = `${ORG}::bl-1`;
  const item = (id: string, rank: number, over: Partial<WorkItem> = {}): WorkItem => ({
    id,
    title: id,
    status: "not_started",
    parentId: null,
    childrenIds: [],
    backlogAssignments: { [TREE]: BL },
    ranks: { [BL]: rank },
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

  const show = (rootIds: string[]) =>
    render(<TimelineView treeId={TREE} rootIds={rootIds} backlogIds={new Set([BL])} isScrambled={false} />);
  const rows = () => [...document.querySelectorAll("[data-timeline-row]")].map((el) => el.getAttribute("data-timeline-row"));
  const row = (id: string) => document.querySelector(`[data-timeline-row="${id}"]`) as HTMLElement;
  const barKind = (id: string) => row(id).querySelector("[data-bar-kind]")?.getAttribute("data-bar-kind") ?? null;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 7, 12));
    return () => vi.useRealTimers();
  });

  it("draws each kind of bar for what the dates say", () => {
    seed([
      item("done", 1, { startedOn: "2026-10-01", endedOn: "2026-10-05" }),
      item("going", 2, { startedOn: "2026-10-03" }),
      item("later", 3, { startedOn: "2026-11-01" }),
      item("ended", 4, { endedOn: "2026-10-02" }),
    ]);
    show(["done", "going", "later", "ended"]);
    expect(barKind("done")).toBe("span");
    expect(barKind("going")).toBe("ongoing");
    expect(barKind("later")).toBe("planned");
    expect(barKind("ended")).toBe("end-only");
    expect(document.querySelector("[data-timeline-today]")).toBeInTheDocument();
  });

  it("starts with the dated rows only once anything has a date, and shows the rest on request", () => {
    seed([item("dated", 1, { startedOn: "2026-10-01" }), item("undated", 2)]);
    show(["dated", "undated"]);
    expect(rows()).toEqual(["dated"]);
    fireEvent.click(screen.getByRole("checkbox", { name: "With dates only" }));
    expect(rows()).toEqual(["dated", "undated"]);
    expect(barKind("undated")).toBeNull();
  });

  it("shows every row while nothing has a date yet, so there is something to set one on", () => {
    seed([item("a", 1), item("b", 2)]);
    show(["a", "b"]);
    expect(rows()).toEqual(["a", "b"]);
    expect(screen.getByRole("checkbox", { name: "With dates only" })).not.toBeChecked();
  });

  it("keeps the parent of a dated row, and opens every branch", () => {
    seed([
      item("parent", 1, { childrenIds: ["child", "other"] }),
      item("child", 1, { parentId: "parent", startedOn: "2026-10-01" }),
      item("other", 2, { parentId: "parent" }),
      item("loose", 2),
    ]);
    show(["parent", "loose"]);
    // The parent has no dates of its own; it is there as the way to its child.
    expect(rows()).toEqual(["parent", "child"]);
    expect(barKind("parent")).toBeNull();
  });

  it("selects a row on click, and publishes its rows for the arrow keys", () => {
    seed([item("a", 1, { startedOn: "2026-10-01" }), item("b", 2, { startedOn: "2026-10-02" })]);
    show(["a", "b"]);
    expect(visibleWorkItemIdsRef.current).toEqual(["a", "b"]);
    fireEvent.click(within(row("b")).getByText("b"));
    expect(useAppStore.getState().selectedWorkItemIds).toEqual(["b"]);
    expect(row("b")).toHaveAttribute("aria-selected", "true");
  });

  it("opens the dates for the bar clicked, and saves what is set there", () => {
    seed([item("a", 1, { startedOn: "2026-10-01" })]);
    show(["a"]);
    fireEvent.click(row("a").querySelector("[data-bar-kind]")!);
    expect(screen.getByLabelText("Started on")).toHaveValue("2026-10-01");
    fireEvent.change(screen.getByLabelText("Ended on"), { target: { value: "2026-10-05" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(useAppStore.getState().workItems.a.endedOn).toBe("2026-10-05");
    expect(barKind("a")).toBe("span");
  });

  it("lets an undated row be given dates from its empty track", () => {
    seed([item("a", 1)]);
    show(["a"]);
    fireEvent.click(screen.getByRole("button", { name: "Set start and end dates for a" }));
    expect(screen.getByLabelText("Started on")).toHaveValue("");
  });

  it("says so when the list is empty", () => {
    seed([]);
    show([]);
    expect(screen.getByText("Nothing in this list yet.")).toBeInTheDocument();
  });
});

describe("a list that prefers its timeline", () => {
  it("remembers it, as it would a board", () => {
    const ORG = "test-org";
    const BL = `${ORG}::bl-1`;
    useAppStore.setState({
      organizationId: ORG,
      backlogs: { [BL]: { id: BL, name: "Work", parentId: null, childrenIds: [], treeId: `${ORG}::bt-1`, rank: 0 } },
    });
    useAppStore.getState().setBacklogViewMode(BL, "timeline");
    expect(useAppStore.getState().backlogs[BL].viewMode).toBe("timeline");
    // And reads it back from the database, where an older app sees a list.
    useAppStore.getState().applyRealtimeBacklog("UPDATE", { id: BL, name: "Work", parent_id: null, tree_id: `${ORG}::bt-1`, rank: 0, view_mode: "timeline" });
    expect(useAppStore.getState().backlogs[BL].viewMode).toBe("timeline");
    useAppStore.getState().applyRealtimeBacklog("UPDATE", { id: BL, name: "Work", parent_id: null, tree_id: `${ORG}::bt-1`, rank: 0, view_mode: "nonsense" });
    expect(useAppStore.getState().backlogs[BL].viewMode).toBe("list");
  });
});
