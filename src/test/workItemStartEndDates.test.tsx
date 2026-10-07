/**
 * The days work on an item started and ended.
 *
 * Two dates set by hand, either without the other. Pinned here: how the span
 * reads on a row, that each date can be set, changed and removed on its own,
 * that an end before its start is refused, that a bulk change touches only the
 * date edited, and that showing them on rows is each list's own choice.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
  updateBacklogStartEndDatesEnabled: vi.fn(),
}));

import { StartEndDatesDialog } from "@/components/StartEndDatesDialog";
import { describeStartEnd, endsBeforeItStarts, formatStartEnd } from "@/lib/workItemStartEnd";
import { useAppStore } from "@/store/appStore";
import { upsertWorkItem, updateBacklogStartEndDatesEnabled } from "@/store/supabaseSync";
import { useOrgStore } from "@/store/orgStore";
import type { WorkItem } from "@/types/models";

const ORG = "test-org";
const TREE = `${ORG}::bt-1`;
const BL = `${ORG}::bl-1`;
const A = `${ORG}::wi-a`;
const B = `${ORG}::wi-b`;

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
    undoStack: [],
    redoStack: [],
  });

const stored = (id: string) => useAppStore.getState().workItems[id];

beforeEach(() => {
  (upsertWorkItem as unknown as { mockClear: () => void }).mockClear();
  useOrgStore.setState({ activeOrgId: ORG });
  seed([item(A)]);
});

describe("how the span reads", () => {
  const NOW = new Date(2026, 9, 7);

  it("shows both dates, or one with the dash on the open side", () => {
    expect(formatStartEnd("2026-10-01", "2026-10-05", NOW, "fi-FI")).toBe("1.10.–5.10.");
    expect(formatStartEnd("2026-10-01", undefined, NOW, "fi-FI")).toBe("1.10.–");
    expect(formatStartEnd(undefined, "2026-10-05", NOW, "fi-FI")).toBe("–5.10.");
    expect(formatStartEnd(undefined, undefined, NOW, "fi-FI")).toBe("");
  });

  it("gives the year when it is not this one", () => {
    expect(formatStartEnd("2025-12-20", "2026-01-10", NOW, "fi-FI")).toBe("20.12.2025–10.1.");
  });

  it("says the same in words", () => {
    expect(describeStartEnd("2026-10-01", "2026-10-05")).toBe("Started 2026-10-01, ended 2026-10-05");
    expect(describeStartEnd("2026-10-01", undefined)).toBe("Started 2026-10-01, not ended");
    expect(describeStartEnd(undefined, "2026-10-05")).toBe("Ended 2026-10-05");
  });

  it("knows an end before its start, and lets the same day stand", () => {
    expect(endsBeforeItStarts("2026-10-05", "2026-10-01")).toBe(true);
    expect(endsBeforeItStarts("2026-10-05", "2026-10-05")).toBe(false);
    expect(endsBeforeItStarts("2026-10-05", undefined)).toBe(false);
  });
});

describe("setting the dates", () => {
  const set = (id: string, dates: { startedOn?: string | null; endedOn?: string | null }) =>
    useAppStore.getState().setWorkItemStartEnd(id, dates);

  it("sets each on its own, and leaves the other as it was", () => {
    set(A, { startedOn: "2026-10-01" });
    expect(stored(A)).toMatchObject({ startedOn: "2026-10-01" });
    expect(stored(A).endedOn).toBeUndefined();
    set(A, { endedOn: "2026-10-05" });
    expect(stored(A)).toMatchObject({ startedOn: "2026-10-01", endedOn: "2026-10-05" });
    expect(upsertWorkItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ startedOn: "2026-10-01", endedOn: "2026-10-05" }),
      ORG,
    );
  });

  it("removes a date on null, or on anything that is not a real date", () => {
    seed([item(A, { startedOn: "2026-10-01", endedOn: "2026-10-05" })]);
    set(A, { endedOn: null });
    expect(stored(A).endedOn).toBeUndefined();
    expect(stored(A).startedOn).toBe("2026-10-01");
    set(A, { startedOn: "2026-02-31" });
    expect(stored(A).startedOn).toBeUndefined();
  });

  it("saves nothing when nothing changes", () => {
    seed([item(A, { startedOn: "2026-10-01" })]);
    set(A, { startedOn: "2026-10-01" });
    set(A, {});
    expect(upsertWorkItem).not.toHaveBeenCalled();
  });

  it("can be undone", () => {
    set(A, { startedOn: "2026-10-01", endedOn: "2026-10-05" });
    useAppStore.getState().undo();
    expect(stored(A).startedOn).toBeUndefined();
    expect(stored(A).endedOn).toBeUndefined();
  });

  it("does not go with a copy: the copy's work has not started", () => {
    seed([item(A, { startedOn: "2026-10-01", endedOn: "2026-10-05" })]);
    const before = new Set(Object.keys(useAppStore.getState().workItems));
    useAppStore.getState().duplicateWorkItems([A]);
    const copyId = Object.keys(useAppStore.getState().workItems).find((id) => !before.has(id))!;
    expect(stored(copyId).startedOn).toBeUndefined();
    expect(stored(copyId).endedOn).toBeUndefined();
  });
});

describe("over realtime", () => {
  const echo = (over: Record<string, unknown> = {}) => ({
    id: A,
    title: A,
    description: null,
    status: "not_started",
    parent_id: null,
    backlog_assignments: { [TREE]: BL },
    rank: 0,
    organization_id: ORG,
    respawn_enabled: false,
    respawn_interval_days: null,
    respawn_hour: null,
    respawn_minute: null,
    respawn_last_triggered_at: null,
    points: null,
    rating: null,
    deadline: null,
    ...over,
  });

  it("takes dates someone else set, and their removal", () => {
    useAppStore.getState().applyRealtimeWorkItem("UPDATE", echo({ started_on: "2026-10-01", ended_on: "2026-10-05" }));
    expect(stored(A)).toMatchObject({ startedOn: "2026-10-01", endedOn: "2026-10-05" });
    useAppStore.getState().applyRealtimeWorkItem("UPDATE", echo({ started_on: "2026-10-01", ended_on: null }));
    expect(stored(A).endedOn).toBeUndefined();
  });

  it("keeps what it holds when a row does not carry the columns", () => {
    useAppStore.getState().setWorkItemStartEnd(A, { startedOn: "2026-10-01" });
    useAppStore.getState().applyRealtimeWorkItem("UPDATE", echo());
    expect(stored(A).startedOn).toBe("2026-10-01");
  });
});

describe("a list's own switch for showing them", () => {
  it("starts off, and is switched from the list", () => {
    expect(useAppStore.getState().backlogs[BL].startEndDatesEnabled ?? false).toBe(false);
    useAppStore.getState().setBacklogStartEndDatesEnabled(BL, true);
    expect(useAppStore.getState().backlogs[BL].startEndDatesEnabled).toBe(true);
    expect(updateBacklogStartEndDatesEnabled).toHaveBeenCalledWith(BL, true);
  });

  it("keeps what it holds when an echo of the list does not carry the column", () => {
    useAppStore.getState().setBacklogStartEndDatesEnabled(BL, true);
    useAppStore.getState().applyRealtimeBacklog("UPDATE", { id: BL, name: "Work", parent_id: null, tree_id: TREE, rank: 0 });
    expect(useAppStore.getState().backlogs[BL].startEndDatesEnabled).toBe(true);
  });
});

describe("the dialog", () => {
  const open = (ids: string[]) => render(<StartEndDatesDialog workItemIds={ids} open onOpenChange={vi.fn()} />);
  const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it("shows the item's dates and saves what is typed, tidying quick forms", () => {
    seed([item(A, { startedOn: "2026-10-01" })]);
    open([A]);
    expect(screen.getByLabelText("Started on")).toHaveValue("2026-10-01");
    expect(screen.getByLabelText("Ended on")).toHaveValue("");
    type("Ended on", "5.10.2026");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored(A)).toMatchObject({ startedOn: "2026-10-01", endedOn: "2026-10-05" });
  });

  it("removes a date whose field is emptied", () => {
    seed([item(A, { startedOn: "2026-10-01", endedOn: "2026-10-05" })]);
    open([A]);
    type("Ended on", "");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(stored(A).endedOn).toBeUndefined();
    expect(stored(A).startedOn).toBe("2026-10-01");
  });

  it("refuses an end before the start, and a date that is not one", () => {
    open([A]);
    type("Started on", "2026-10-05");
    type("Ended on", "2026-10-01");
    expect(screen.getByRole("alert")).toHaveTextContent("The end date is before the start date.");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    type("Ended on", "nonsense");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    type("Ended on", "2026-10-06");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("for several items, applies only the date that was edited", () => {
    seed([item(A, { startedOn: "2026-09-01" }), item(B, { startedOn: "2026-09-15" })]);
    open([A, B]);
    // Nothing edited yet: there is nothing to apply.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    type("Ended on", "2026-10-05");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    // Each keeps its own start; both get the end.
    expect(stored(A)).toMatchObject({ startedOn: "2026-09-01", endedOn: "2026-10-05" });
    expect(stored(B)).toMatchObject({ startedOn: "2026-09-15", endedOn: "2026-10-05" });
  });
});
