/**
 * Deadlines as a work item's own field.
 *
 * They used to live in names — "0930 Fortum — Analyst" — written by the job-ad
 * importer: no year, sortable only by name, lost when a name was edited. What is
 * pinned here is how a deadline reads, sorts and survives, and that switching
 * the feature off hides it without leaving a list sorted by something unseen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
}));

import { compareDeadlines, formatDeadline, isDeadlinePassed, wellFormedDeadline } from "@/lib/deadlineFormat";
import { listSortModes, sortTopLevel } from "@/lib/listSort";
import { countOpenAds } from "@/lib/autoPlace";
import { useAppStore } from "@/store/appStore";
import { upsertWorkItem } from "@/store/supabaseSync";
import { listSortModeFor, useListSortStore } from "@/store/listSortStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import type { WorkItem } from "@/types/models";

const ORG = "test-org";
const TREE = `${ORG}::bt-1`;
const BL = `${ORG}::bl-1`;
const ID = `${ORG}::wi-1`;

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

const seed = (items: WorkItem[] = [item(ID, { title: "Fortum — Analyst" })]) =>
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
    backlogs: { [BL]: { id: BL, name: "Jobs", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
    workItems: Object.fromEntries(items.map((i) => [i.id, i])),
    undoStack: [],
    redoStack: [],
  });

const deadlines = (on: boolean) =>
  useOrgSettingsStore.setState((s) => ({
    settings: { ...s.settings, [ORG]: { ...(s.settings[ORG] ?? ({} as never)), deadlinesEnabled: on } },
  }));

beforeEach(() => {
  (upsertWorkItem as unknown as { mockClear: () => void }).mockClear();
  useOrgStore.setState({ activeOrgId: ORG });
  deadlines(true);
  seed();
});

describe("how a deadline reads", () => {
  const NOW = new Date(2026, 8, 25);

  it("shows day and month this year, and the year only when it is another", () => {
    expect(formatDeadline("2026-09-30", NOW, "fi-FI")).toBe("30.9.");
    expect(formatDeadline("2027-01-15", NOW, "fi-FI")).toBe("15.1.2027");
  });

  it("counts the day itself as still open", () => {
    expect(isDeadlinePassed("2026-09-24", NOW)).toBe(true);
    expect(isDeadlinePassed("2026-09-25", NOW)).toBe(false);
    expect(isDeadlinePassed(undefined, NOW)).toBe(false);
  });

  it("takes only a real calendar date", () => {
    expect(wellFormedDeadline("2026-09-30")).toBe("2026-09-30");
    expect(wellFormedDeadline("2026-02-31")).toBeUndefined();
    expect(wellFormedDeadline("30.9.2026")).toBeUndefined();
    expect(wellFormedDeadline("")).toBeUndefined();
  });
});

describe("sorting by deadline", () => {
  it("puts the soonest first and items without one last", () => {
    const items = [
      item("a", { deadline: "2026-10-04" }),
      item("none"),
      item("b", { deadline: "2026-09-18" }),
      item("c", { deadline: "2026-09-30" }),
    ];
    const ctx = { teamsByItem: {}, teamNames: {}, statusPosition: () => null };
    expect(sortTopLevel(items, "deadline-asc", TREE, ctx).map((i) => i.id)).toEqual(["b", "c", "a", "none"]);
    expect([...items].sort(compareDeadlines).map((i) => i.id)).toEqual(["b", "c", "a", "none"]);
  });

  it("is offered only where the organization uses deadlines", () => {
    expect(listSortModes(false, true).map((m) => m.mode)).toContain("deadline-asc");
    expect(listSortModes(false, false).map((m) => m.mode)).not.toContain("deadline-asc");
    expect(listSortModes(false).map((m) => m.mode)).not.toContain("deadline-asc");
  });

  it("falls back to rank once deadlines are switched off, and returns with them", () => {
    // Otherwise the list would stay ordered by a field no one can see, with
    // nothing offered to undo it.
    useListSortStore.setState({ modeByBacklog: { [BL]: "deadline-asc" } });
    expect(listSortModeFor(BL)).toBe("deadline-asc");
    deadlines(false);
    expect(listSortModeFor(BL)).toBe("rank");
    deadlines(true);
    expect(listSortModeFor(BL)).toBe("deadline-asc");
  });
});

describe("setting a deadline", () => {
  const echo = (deadline: string | null) => ({
    id: ID,
    title: "Fortum — Analyst",
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
    deadline,
  });

  it("sets it, saves it, and can be undone", () => {
    useAppStore.getState().setWorkItemDeadline(ID, "2026-09-30");
    expect(useAppStore.getState().workItems[ID].deadline).toBe("2026-09-30");
    expect(upsertWorkItem).toHaveBeenCalledWith(expect.objectContaining({ deadline: "2026-09-30" }), ORG);
    useAppStore.getState().undo();
    expect(useAppStore.getState().workItems[ID].deadline).toBeUndefined();
  });

  it("keeps the date just set when its own save comes back over realtime", () => {
    // Stars were lost exactly this way: the echo rebuilt the item without them.
    useAppStore.getState().setWorkItemDeadline(ID, "2026-09-30");
    useAppStore.getState().applyRealtimeWorkItem("UPDATE", echo("2026-09-30"));
    expect(useAppStore.getState().workItems[ID].deadline).toBe("2026-09-30");
  });

  it("takes a deadline someone else changed or removed", () => {
    useAppStore.getState().applyRealtimeWorkItem("UPDATE", echo("2026-10-02"));
    expect(useAppStore.getState().workItems[ID].deadline).toBe("2026-10-02");
    useAppStore.getState().applyRealtimeWorkItem("UPDATE", echo(null));
    expect(useAppStore.getState().workItems[ID].deadline).toBeUndefined();
  });

  it("refuses a date that does not exist, and an empty one removes it", () => {
    useAppStore.getState().setWorkItemDeadline(ID, "2026-09-30");
    useAppStore.getState().setWorkItemDeadline(ID, "2026-02-31");
    expect(useAppStore.getState().workItems[ID].deadline).toBeUndefined();
  });

  it("goes with the item when it is duplicated", () => {
    seed([item(ID, { deadline: "2026-09-30" })]);
    const before = new Set(Object.keys(useAppStore.getState().workItems));
    useAppStore.getState().duplicateWorkItems([ID]);
    const copyId = Object.keys(useAppStore.getState().workItems).find((id) => !before.has(id))!;
    expect(useAppStore.getState().workItems[copyId].deadline).toBe("2026-09-30");
  });
});

describe("counting open job ads", () => {
  const NOW = new Date("2026-09-25T12:00:00Z");

  it("reads the item's own deadline", () => {
    const items = [
      { id: "gone", title: "Fortum — Analyst", deadline: "2026-09-20" },
      { id: "open", title: "Elisa — Lead", deadline: "2026-10-01" },
    ];
    expect(countOpenAds(items, new Set(), NOW)).toBe(1);
  });

  it("still reads a date in the name, for an organization without deadlines", () => {
    expect(countOpenAds([{ id: "old", title: "0920 Fortum — Analyst" }], new Set(), NOW)).toBe(0);
  });
});
