/**
 * A new account starts with one tree, two lists and no items, and the list
 * panel asks for a first item instead of "Select a list to view work items"
 * (2026-11-16: 15 of 34 new users never changed anything).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MemoryRouter } from "react-router-dom";

// What the next organisations update answers, and what it was asked.
const db = vi.hoisted(() => ({
  orgUpdate: { data: [] as unknown[], error: null as unknown },
  updates: [] as Array<{ table: string; values: unknown }>,
  upserts: [] as Array<{ table: string; rows: unknown }>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    let updating = false;
    for (const m of ["select", "eq", "in", "order", "range", "limit", "gte", "upsert", "insert", "delete", "maybeSingle", "single"]) {
      b[m] = () => b;
    }
    b.upsert = (rows: unknown) => {
      db.upserts.push({ table, rows });
      return b;
    };
    b.update = (values: unknown) => {
      updating = true;
      db.updates.push({ table, values });
      return b;
    };
    b.then = (ok: (v: unknown) => unknown) =>
      Promise.resolve(table === "organizations" && updating ? db.orgUpdate : { data: [], error: null }).then(ok);
    return b;
  };
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => {} };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    },
  };
});

import { WorkItemTreePanel } from "@/components/WorkItemTreePanel";
import { firstList } from "@/components/listPanel/firstList";
import { itemLines, MAX_PASTED_ITEMS } from "@/components/listPanel/itemLines";
import { gettingStartedSteps, NEW_ORG_DAYS } from "@/components/listPanel/startSteps";
import { toIsoDate } from "@/lib/deadlineFormat";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { starterContent } from "@/store/starterContent";
import { scopeMockDataToOrganization } from "@/store/sync/writes";
import type { WorkItem } from "@/types/models";
import { saveTryList, TRY_LIST_KEY, type TryItem } from "@/lib/tryList";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { starterShape } from "@/components/listPanel/startPresets";

const ORG = "org";
const starter = scopeMockDataToOrganization(ORG, structuredClone(starterContent));
const TREE = Object.keys(starter.backlogTrees)[0];
const [NOW, LATER] = starter.backlogTrees[TREE].rootBacklogIds;

function seed(state: Record<string, unknown> = {}, role: "owner" | "admin" | "member" = "owner") {
  useOrgStore.setState({
    activeOrgId: ORG,
    roleOverride: null,
    memberships: [{ organization_id: ORG, organization_name: "anna@example.com", organization_slug: "anna", role }],
  });
  useAppStore.setState({
    organizationId: ORG,
    workItems: {},
    backlogs: starter.backlogs,
    backlogTrees: starter.backlogTrees,
    selectedTreeId: null,
    selectedBacklogIds: [],
    selectedWorkItemIds: [],
    searchQuery: "",
    isLoading: false,
    workItemsLoading: false,
    workItemsRefreshing: false,
    loadingProgress: 100,
    ...state,
  } as never);
}

const renderPanel = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <WorkItemTreePanel />
      </TooltipProvider>
    </MemoryRouter>,
  );

describe("the starter content", () => {
  it("is one tree with two lists and no items", () => {
    expect(Object.values(starterContent.backlogTrees).map((t) => t.name)).toEqual(["My work"]);
    expect(Object.values(starterContent.backlogs).map((b) => b.name)).toEqual(["Now", "Later"]);
    expect(starterContent.workItems).toEqual({});
  });

  it("is what a new organisation is given", async () => {
    const source = await import("@/store/orgStore?raw").then((m) => m.default as string);
    expect(source).toContain("resetOrgData(orgId, structuredClone(starterContent))");
  });
});

describe("the first-item prompt", () => {
  beforeEach(() => seed());

  it("replaces 'Select a list' for a new account, and names where the item goes", () => {
    renderPanel();
    expect(screen.getByRole("heading", { name: "Add your first item" })).toBeTruthy();
    expect(screen.getByText("My work › Now")).toBeTruthy();
    expect(screen.queryByText("Select a list to view work items")).toBeNull();
    // Nothing to filter yet, and on a phone it pushed the box down.
    expect(screen.queryByPlaceholderText(/Filter items/)).toBeNull();
  });

  it("adds the item to the first list and opens that list", () => {
    renderPanel();
    const input = screen.getByRole("textbox", { name: "First item" });
    fireEvent.change(input, { target: { value: "  Plan the kick-off  " } });
    act(() => {
      fireEvent.submit(input.closest("form")!);
    });
    const state = useAppStore.getState();
    const items = Object.values(state.workItems) as WorkItem[];
    expect(items.map((i) => i.title)).toEqual(["Plan the kick-off"]);
    expect(items[0].backlogAssignments[TREE]).toBe(NOW);
    expect(state.selectedBacklogIds).toEqual([NOW]);
    expect(screen.queryByRole("heading", { name: "Add your first item" })).toBeNull();
    expect(screen.getByPlaceholderText(/Filter items/)).toBeTruthy();
  });

  it("does nothing with an empty title", () => {
    renderPanel();
    const input = screen.getByRole("textbox", { name: "First item" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form")!);
    expect(useAppStore.getState().workItems).toEqual({});
  });

  it("uses the list already selected", () => {
    seed({ selectedTreeId: TREE, selectedBacklogIds: [LATER] });
    renderPanel();
    expect(screen.getByText("My work › Later")).toBeTruthy();
  });

  it("is not shown once the organisation has items", () => {
    const item = {
      id: `${ORG}::wi-1`, title: "Elsewhere", status: "not_started", parentId: null, childrenIds: [],
      backlogAssignments: { [TREE]: LATER }, ranks: { [LATER]: 0 }, organizationId: ORG,
    } as unknown as WorkItem;
    seed({ workItems: { [item.id]: item }, selectedTreeId: TREE, selectedBacklogIds: [NOW] });
    renderPanel();
    expect(screen.queryByRole("heading", { name: "Add your first item" })).toBeNull();
    expect(screen.getByText("No work items in this list")).toBeTruthy();
  });

  it("is not shown while the items are still loading", () => {
    seed({ workItemsLoading: true });
    renderPanel();
    expect(screen.queryByRole("heading", { name: "Add your first item" })).toBeNull();
  });
});

describe("pasting a list into the first-item box", () => {
  beforeEach(() => seed());

  const type = (value: string) => {
    const input = screen.getByRole("textbox", { name: "First item" });
    fireEvent.change(input, { target: { value } });
    return input;
  };
  const titlesInNow = () =>
    (Object.values(useAppStore.getState().workItems) as WorkItem[])
      .filter((i) => i.backlogAssignments[TREE] === NOW)
      .sort((a, b) => a.ranks[NOW] - b.ranks[NOW])
      .map((i) => i.title);

  it("adds one item per line, in order, without the list markers", () => {
    renderPanel();
    type("- [ ] Book the venue\n\n2. Send invites\r\n• Order coffee  \n");
    expect(screen.getByRole("button", { name: "Add 3 items" })).toBeTruthy();
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Add 3 items" }));
    });
    expect(titlesInNow()).toEqual(["Book the venue", "Send invites", "Order coffee"]);
    expect(useAppStore.getState().selectedBacklogIds).toEqual([NOW]);
  });

  it("adds on Enter, but Shift+Enter is a new line", () => {
    renderPanel();
    const input = type("One");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(useAppStore.getState().workItems).toEqual({});
    act(() => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    expect(titlesInNow()).toEqual(["One"]);
  });

  it("adds at most a hundred from one paste, and says so", () => {
    renderPanel();
    type(Array.from({ length: 150 }, (_, i) => `Line ${i + 1}`).join("\n"));
    expect(screen.getByRole("status").textContent).toContain("first 100");
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: `Add ${MAX_PASTED_ITEMS} items` }));
    });
    const titles = titlesInNow();
    expect(titles).toHaveLength(MAX_PASTED_ITEMS);
    expect(titles.at(-1)).toBe("Line 100");
  });

  it("keeps titles that only look like markers", () => {
    expect(itemLines("3.5 hours of review\n-5 degrees outside\n2024 plan\n[x] Shipped")).toEqual([
      "3.5 hours of review",
      "-5 degrees outside",
      "2024 plan",
      "Shipped",
    ]);
  });
});

describe("the getting-started steps", () => {
  const today = new Date(2026, 10, 16);
  const item = (id: string, extra: Partial<WorkItem> = {}) =>
    ({
      id: `${ORG}::${id}`, title: id, status: "not_started", parentId: null, childrenIds: [],
      backlogAssignments: { [TREE]: NOW }, ranks: { [NOW]: 0 }, organizationId: ORG,
      createdOn: toIsoDate(new Date()), ...extra,
    }) as unknown as WorkItem;

  beforeEach(() => {
    localStorage.clear();
  });

  it("tick off from the items themselves", () => {
    const fresh = (extra: Partial<WorkItem> = {}) => item("a", { createdOn: "2026-11-15", ...extra });
    expect(gettingStartedSteps([fresh()], today)).toEqual([
      { key: "more", done: false },
      { key: "nest", done: false },
      { key: "done", done: false },
    ]);
    expect(
      gettingStartedSteps([fresh(), fresh({ parentId: "x" }), fresh({ status: "done" })], today)?.every((s) => s.done),
    ).toBe(true);
  });

  it("are only for a new organisation", () => {
    expect(gettingStartedSteps([], today)).toBeNull();
    const old = new Date(today);
    old.setDate(old.getDate() - NEW_ORG_DAYS - 1);
    expect(gettingStartedSteps([item("a", { createdOn: "2026-11-15" }), item("b", { createdOn: toIsoDate(old) })], today)).toBeNull();
    expect(gettingStartedSteps([item("a", { createdOn: undefined })], today)).toBeNull();
  });

  it("appear once the first item is added, and stay closed once closed", () => {
    seed();
    const { unmount } = renderPanel();
    expect(screen.queryByRole("heading", { name: "Getting started" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "First item" }), { target: { value: "First" } });
    act(() => {
      fireEvent.submit(screen.getByRole("textbox", { name: "First item" }).closest("form")!);
    });
    expect(screen.getByRole("heading", { name: "Getting started" })).toBeTruthy();
    expect(screen.getByText("0 of 3 done")).toBeTruthy();
    expect(screen.getByText(/press Tab/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close getting started" }));
    expect(screen.queryByRole("heading", { name: "Getting started" })).toBeNull();
    unmount();
    renderPanel();
    expect(screen.getByText("1 item")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Getting started" })).toBeNull();
  });

  it("say when the basics are done", () => {
    seed({
      workItems: Object.fromEntries(
        [item("a"), item("b", { parentId: `${ORG}::a` }), item("c", { status: "done" })].map((i) => [i.id, i]),
      ),
      selectedTreeId: TREE,
      selectedBacklogIds: [NOW],
    });
    renderPanel();
    expect(screen.getByRole("heading", { name: "That's the basics" })).toBeTruthy();
    expect(screen.getByText("3 of 3 done")).toBeTruthy();
  });
});

describe("naming the organisation from the first-item box", () => {
  beforeEach(() => {
    db.updates.length = 0;
    db.orgUpdate = { data: [{ id: ORG }], error: null };
  });

  const rename = async (name: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Rename it" }));
    const input = screen.getByRole("textbox", { name: "Organisation name" });
    fireEvent.change(input, { target: { value: name } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
  };

  it("shows the name it was given and renames it, for the owner", async () => {
    seed();
    renderPanel();
    expect(screen.getByText("anna@example.com")).toBeTruthy();
    await rename("  Kick-off team  ");
    expect(db.updates).toEqual([{ table: "organizations", values: { name: "Kick-off team" } }]);
    expect(useOrgStore.getState().memberships[0].organization_name).toBe("Kick-off team");
    expect(screen.getByText("Kick-off team")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Organisation name" })).toBeNull();
  });

  it("says so when the rename is refused, and keeps the old name", async () => {
    seed();
    db.orgUpdate = { data: [], error: null };
    renderPanel();
    await rename("Mine");
    expect(screen.getByRole("alert").textContent).toMatch(/owner or admin/);
    expect(useOrgStore.getState().memberships[0].organization_name).toBe("anna@example.com");
  });

  it("is not offered to a plain member", () => {
    seed({}, "member");
    renderPanel();
    expect(screen.getByRole("heading", { name: "Add your first item" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Rename it" })).toBeNull();
  });

  it("leaves the first-item box focused", () => {
    seed();
    renderPanel();
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "First item" }));
  });
});

describe("firstList", () => {
  it("is the first list of the first tree that has one", () => {
    expect(
      firstList(
        {
          a: { id: "a", name: "A", rank: 0, rootBacklogIds: [] },
          b: { id: "b", name: "B", rank: 1, rootBacklogIds: ["b2", "b1"] },
        },
        {
          b1: { id: "b1", name: "B1", parentId: null, childrenIds: [], treeId: "b", rank: 0 },
          b2: { id: "b2", name: "B2", parentId: null, childrenIds: [], treeId: "b", rank: 1 },
        },
      ),
    ).toEqual({ treeId: "b", backlogId: "b1" });
    expect(firstList({}, {})).toBeNull();
  });
});

describe("a list made on /try before signing up", () => {
  const tried: TryItem[] = [
    { id: "1", title: "Plan the kick-off", depth: 0, done: false },
    { id: "2", title: "Book a room", depth: 1, done: true },
    { id: "3", title: "Send invites", depth: 1, done: false },
    { id: "4", title: "Renew passport", depth: 0, done: false },
  ];
  beforeEach(() => {
    localStorage.clear();
    seed({ undoStack: [], redoStack: [] });
  });

  it("comes into the new account's first list once, nested, with its done marks, as one undo step", () => {
    saveTryList(tried);
    renderPanel();
    const state = useAppStore.getState();
    const items = Object.values(state.workItems) as WorkItem[];
    const byTitle = Object.fromEntries(items.map((i) => [i.title, i]));
    expect(items).toHaveLength(4);
    const parent = byTitle["Plan the kick-off"];
    expect(parent.parentId).toBeNull();
    expect(parent.status).toBe("in_progress");
    expect(parent.childrenIds.map((id) => state.workItems[id].title)).toEqual(["Book a room", "Send invites"]);
    expect(byTitle["Book a room"]).toMatchObject({ parentId: parent.id, status: "done" });
    expect(byTitle["Renew passport"].ranks[NOW]).toBeGreaterThan(parent.ranks[NOW]);
    expect(items.every((i) => i.backlogAssignments[TREE] === NOW)).toBe(true);
    expect(state.selectedBacklogIds).toEqual([NOW]);
    expect(state.undoStack).toHaveLength(1);
    expect(localStorage.getItem(TRY_LIST_KEY)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Add your first item" })).toBeNull();
  });

  it("is saved in one request, so no child reaches the database before its parent", async () => {
    saveTryList(tried);
    db.upserts = [];
    renderPanel();
    await waitFor(() => expect(db.upserts.some((u) => u.table === "work_items")).toBe(true));
    const saves = db.upserts.filter((u) => u.table === "work_items");
    expect(saves).toHaveLength(1);
    const rows = saves[0].rows as Array<{ title: string; parent_id: string | null }>;
    expect(rows.map((r) => r.title).sort()).toEqual(["Book a room", "Plan the kick-off", "Renew passport", "Send invites"]);
    expect(rows.filter((r) => r.parent_id !== null)).toHaveLength(2);
  });

  it("is left alone by an account that already has items", () => {
    saveTryList(tried);
    const existing = { id: `${ORG}::wi-1`, title: "Old", parentId: null, childrenIds: [], status: "not_started", ranks: { [NOW]: 0 }, backlogAssignments: { [TREE]: NOW }, organizationId: ORG } as WorkItem;
    seed({ workItems: { [existing.id]: existing }, selectedTreeId: TREE, selectedBacklogIds: [NOW] });
    renderPanel();
    expect(Object.keys(useAppStore.getState().workItems)).toEqual([existing.id]);
    expect(localStorage.getItem(TRY_LIST_KEY)).not.toBeNull();
  });

  it("is not brought in while the items are still loading", () => {
    saveTryList(tried);
    seed({ workItemsLoading: true });
    renderPanel();
    expect(useAppStore.getState().workItems).toEqual({});
    expect(localStorage.getItem(TRY_LIST_KEY)).not.toBeNull();
  });

  it("is not brought in after a week", () => {
    saveTryList(tried, new Date(Date.now() - 8 * 86_400_000));
    renderPanel();
    expect(useAppStore.getState().workItems).toEqual({});
    expect(screen.getByRole("heading", { name: "Add your first item" })).toBeTruthy();
  });
});

describe("who it is for", () => {
  beforeEach(() => {
    seed({ changeLog: [] });
    useOrgSettingsStore.setState({ settings: {} } as never);
    db.upserts = [];
  });
  const names = () => {
    const { backlogTrees, backlogs } = useAppStore.getState();
    const tree = backlogTrees[TREE];
    return [tree.name, ...tree.rootBacklogIds.map((id) => backlogs[id].name)];
  };
  const choose = async (label: RegExp) => {
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: label }));
    });
  };

  it("is asked of a new organisation's owner, with just me chosen", () => {
    renderPanel();
    expect(screen.getByRole("group", { name: "Who is it for?" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Just me/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("link", { name: "Team settings" })).toBeNull();
  });

  it("a team gets a backlog and a sprint board with story points, and says how to add people", async () => {
    renderPanel();
    await choose(/A team/);
    expect(names()).toEqual(["Team", "Backlog", "This sprint"]);
    expect(screen.getByText("Team › Backlog")).toBeTruthy();
    expect(useAppStore.getState().backlogs[LATER].viewMode).toBe("board");
    expect(useOrgSettingsStore.getState().settings[ORG]).toMatchObject({ boardsEnabled: true, pointsEnabled: true });
    expect(screen.getByRole("link", { name: "Team settings" }).getAttribute("href")).toBe("/settings/team");
    expect((screen.getByRole("radio", { name: /A team/ }) as HTMLInputElement).checked).toBe(true);
    const logged = useAppStore.getState().changeLog.find((e) => e.action === "Start chosen");
    expect(logged).toMatchObject({ entityType: "organization", entityId: ORG, details: "team" });
  });

  it("choosing just me again puts the start back as it was", async () => {
    renderPanel();
    await choose(/A team/);
    await choose(/Just me/);
    expect(names()).toEqual(["My work", "Now", "Later"]);
    expect(useAppStore.getState().backlogs[LATER].viewMode).toBe("list");
    expect(useOrgSettingsStore.getState().settings[ORG]).toMatchObject({ boardsEnabled: false, pointsEnabled: false });
    expect(useAppStore.getState().changeLog.filter((e) => e.action === "Start chosen").map((e) => e.details)).toEqual(["own", "team"]);
  });

  it("is not asked of a member, who cannot rename lists or change settings", () => {
    seed({}, "member");
    renderPanel();
    expect(screen.queryByRole("group", { name: "Who is it for?" })).toBeNull();
  });

  it("is not asked once the lists are the person's own, so nothing of theirs is renamed", () => {
    const { backlogs } = useAppStore.getState();
    seed({ backlogs: { ...backlogs, [NOW]: { ...backlogs[NOW], name: "Errands" } } });
    renderPanel();
    expect(screen.getByRole("heading", { name: "Add your first item" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Who is it for?" })).toBeNull();
  });

  it("recognises only the two starts, untouched", () => {
    const { backlogTrees, backlogs } = useAppStore.getState();
    expect(starterShape(backlogTrees, backlogs)?.kind).toBe("own");
    const nested = { ...backlogs, [NOW]: { ...backlogs[NOW], childrenIds: ["x"] } };
    expect(starterShape(backlogTrees, nested)).toBeNull();
    const renamedTree = { [TREE]: { ...backlogTrees[TREE], name: "Home" } };
    expect(starterShape(renamedTree, backlogs)).toBeNull();
  });
});

describe("arriving from the try-out", () => {
  const tried: TryItem[] = [{ id: "1", title: "From the try-out", depth: 0, done: false }];
  beforeEach(() => {
    localStorage.clear();
    seed({ changeLog: [], undoStack: [], redoStack: [] });
    useOrgSettingsStore.setState({ settings: {} } as never);
  });

  it("still asks who it is for and offers the rename, in the getting-started panel", async () => {
    saveTryList(tried);
    renderPanel();
    expect(screen.queryByRole("heading", { name: "Add your first item" })).toBeNull();
    const panel = screen.getByRole("region", { name: /Getting started|That's the basics/ });
    expect(within(panel).getByRole("group", { name: "Who is it for?" })).toBeTruthy();
    expect(within(panel).getByText(/Your organisation is called/)).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(panel).getByRole("radio", { name: /A team/ }));
    });
    const { backlogTrees, backlogs } = useAppStore.getState();
    expect([backlogTrees[TREE].name, backlogs[NOW].name, backlogs[LATER].name]).toEqual(["Team", "Backlog", "This sprint"]);
    expect(Object.values(useAppStore.getState().workItems).map((i) => i.title)).toEqual(["From the try-out"]);
  });

  it("offers neither to a member", () => {
    saveTryList(tried);
    seed({}, "member");
    renderPanel();
    expect(screen.queryByRole("group", { name: "Who is it for?" })).toBeNull();
    expect(screen.queryByText(/Your organisation is called/)).toBeNull();
  });
});
