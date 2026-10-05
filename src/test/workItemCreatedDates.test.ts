/**
 * The day a work item was made, as a field of its own.
 *
 * Nothing used to record it. What is pinned here: every new item gets today's
 * date on the user's own calendar, the date can be corrected but not removed,
 * lists sort by it with the undated ones last either way, and switching the
 * feature off hides it without leaving a list sorted by something unseen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
}));

import { toIsoDate } from "@/lib/deadlineFormat";
import { formatCreatedOn } from "@/lib/workItemCreated";
import { isCreatedSort, listSortModes, sortTopLevel } from "@/lib/listSort";
import { PUBLISHABLE_ATTRIBUTES } from "@/lib/publicBacklog";
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

const seed = (items: WorkItem[] = [item(ID, { title: "Fortum - Analyst" })]) =>
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
    backlogs: { [BL]: { id: BL, name: "Jobs", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
    workItems: Object.fromEntries(items.map((i) => [i.id, i])),
    undoStack: [],
    redoStack: [],
  });

const createdDates = (on: boolean) =>
  useOrgSettingsStore.setState((s) => ({
    settings: { ...s.settings, [ORG]: { ...(s.settings[ORG] ?? ({} as never)), createdDatesEnabled: on } },
  }));

const newIds = (before: Set<string>) => Object.keys(useAppStore.getState().workItems).filter((id) => !before.has(id));

beforeEach(() => {
  (upsertWorkItem as unknown as { mockClear: () => void }).mockClear();
  useOrgStore.setState({ activeOrgId: ORG });
  createdDates(true);
  seed();
});

describe("how a created date reads", () => {
  it("reads as a deadline does: day and month, the year only when it is another", () => {
    const NOW = new Date(2026, 9, 5);
    expect(formatCreatedOn("2026-09-30", NOW, "fi-FI")).toBe("30.9.");
    expect(formatCreatedOn("2025-12-01", NOW, "fi-FI")).toBe("1.12.2025");
  });
});

describe("sorting by created date", () => {
  const items = [
    item("mid", { createdOn: "2026-09-18" }),
    item("unknown"),
    item("new", { createdOn: "2026-10-04" }),
    item("old", { createdOn: "2026-05-02" }),
  ];
  const ctx = { teamsByItem: {}, teamNames: {}, statusPosition: () => null };

  it("puts the newest first, or the oldest, on request", () => {
    expect(sortTopLevel(items, "created-desc", TREE, ctx).map((i) => i.id)).toEqual(["new", "mid", "old", "unknown"]);
    expect(sortTopLevel(items, "created-asc", TREE, ctx).map((i) => i.id)).toEqual(["old", "mid", "new", "unknown"]);
  });

  it("keeps items whose day was never recorded last either way", () => {
    // Unknown is not "oldest", and not "newest" either.
    for (const mode of ["created-desc", "created-asc"] as const) {
      expect(sortTopLevel(items, mode, TREE, ctx).at(-1)?.id).toBe("unknown");
    }
  });

  it("is offered only where the organization shows created dates", () => {
    const modes = (on: boolean) => listSortModes(false, false, on).map((m) => m.mode);
    expect(modes(true)).toEqual(expect.arrayContaining(["created-desc", "created-asc"]));
    expect(modes(false).some(isCreatedSort)).toBe(false);
    expect(listSortModes(false).some((m) => isCreatedSort(m.mode))).toBe(false);
  });

  it("falls back to rank once created dates are switched off, and returns with them", () => {
    useListSortStore.setState({ modeByBacklog: { [BL]: "created-desc" } });
    expect(listSortModeFor(BL)).toBe("created-desc");
    createdDates(false);
    expect(listSortModeFor(BL)).toBe("rank");
    createdDates(true);
    expect(listSortModeFor(BL)).toBe("created-desc");
  });
});

describe("new items", () => {
  const today = () => toIsoDate(new Date());

  it("are dated today when added", () => {
    const before = new Set(Object.keys(useAppStore.getState().workItems));
    useAppStore.getState().addWorkItem("Elisa - Lead", null, BL, TREE);
    const [id] = newIds(before);
    expect(useAppStore.getState().workItems[id].createdOn).toBe(today());
  });

  it("are dated today when several are added at once", () => {
    const before = new Set(Object.keys(useAppStore.getState().workItems));
    useAppStore.getState().bulkAddWorkItems(["One", "Two"], null, BL, TREE);
    const ids = newIds(before);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(useAppStore.getState().workItems[id].createdOn).toBe(today());
  });

  it("are dated today when copied, whenever the original was made", () => {
    seed([item(ID, { createdOn: "2025-01-15" })]);
    const before = new Set(Object.keys(useAppStore.getState().workItems));
    useAppStore.getState().duplicateWorkItems([ID]);
    const [copyId] = newIds(before);
    expect(useAppStore.getState().workItems[copyId].createdOn).toBe(today());
    expect(useAppStore.getState().workItems[ID].createdOn).toBe("2025-01-15");
  });
});

describe("correcting a created date", () => {
  const echo = (over: Record<string, unknown> = {}) => ({
    id: ID,
    title: "Fortum - Analyst",
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

  it("sets it on an item that had none, saves it, and can be undone", () => {
    useAppStore.getState().setWorkItemCreatedOn(ID, "2026-08-01");
    expect(useAppStore.getState().workItems[ID].createdOn).toBe("2026-08-01");
    expect(upsertWorkItem).toHaveBeenCalledWith(expect.objectContaining({ createdOn: "2026-08-01" }), ORG);
    useAppStore.getState().undo();
    expect(useAppStore.getState().workItems[ID].createdOn).toBeUndefined();
  });

  it("changes it, but neither removes it nor takes a date that does not exist", () => {
    useAppStore.getState().setWorkItemCreatedOn(ID, "2026-08-01");
    useAppStore.getState().setWorkItemCreatedOn(ID, "");
    useAppStore.getState().setWorkItemCreatedOn(ID, "2026-02-31");
    expect(useAppStore.getState().workItems[ID].createdOn).toBe("2026-08-01");
    useAppStore.getState().setWorkItemCreatedOn(ID, "2026-07-15");
    expect(useAppStore.getState().workItems[ID].createdOn).toBe("2026-07-15");
  });

  it("takes a date someone else set, over realtime", () => {
    useAppStore.getState().applyRealtimeWorkItem("UPDATE", echo({ created_on: "2026-06-10" }));
    expect(useAppStore.getState().workItems[ID].createdOn).toBe("2026-06-10");
  });

  it("keeps the date it holds when an echo does not carry the column", () => {
    // A row from before the column, or a partial one: it must not blank the date.
    useAppStore.getState().setWorkItemCreatedOn(ID, "2026-08-01");
    useAppStore.getState().applyRealtimeWorkItem("UPDATE", echo());
    expect(useAppStore.getState().workItems[ID].createdOn).toBe("2026-08-01");
  });
});

describe("publishing", () => {
  it("is an attribute a public link can show or hide", () => {
    expect(PUBLISHABLE_ATTRIBUTES.map((a) => a.key)).toContain("created");
  });
});
