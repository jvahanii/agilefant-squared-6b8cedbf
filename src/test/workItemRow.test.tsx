/**
 * A work item's row in the list, pinned as it is: what it draws, what its
 * right-click menu offers, and what each entry, click and shortcut opens.
 *
 * Written before the row (WorkItemNodeContent) was taken apart into smaller
 * pieces, so that taking it apart changes nothing: the snapshots are of the
 * row as it was.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { render, act, fireEvent, screen, cleanup, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "or", "not", "order", "range", "limit", "gte", "lte", "upsert", "insert", "update", "delete", "maybeSingle", "single"]) {
    builder[m] = () => builder;
  }
  builder.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok);
  const channel = { on: () => channel, subscribe: () => channel, unsubscribe: () => {} };
  return {
    supabase: {
      from: () => builder,
      rpc: () => Promise.resolve({ data: null, error: null }),
      channel: () => channel,
      removeChannel: () => {},
      auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    },
  };
});

// Changes made from the row are saved; here they must not be.
vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
}));

// jsdom lays nothing out, so the list would draw no rows: draw them all.
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, getItemKey = (i) => i }: { count: number; getItemKey?: (i: number) => string | number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: index * 32, size: 32 })),
    getTotalSize: () => count * 32,
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));

// Nor does it scroll.
Element.prototype.scrollIntoView ??= () => {};

// jsdom has no DOMRect, which a right-click menu uses to place itself.
if (typeof globalThis.DOMRect === "undefined") {
  class RectForTests {
    constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
    get top() { return this.y; }
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get bottom() { return this.y + this.height; }
    toJSON() { return { x: this.x, y: this.y, width: this.width, height: this.height }; }
    static fromRect(r: { x?: number; y?: number; width?: number; height?: number } = {}) {
      return new RectForTests(r.x, r.y, r.width, r.height);
    }
  }
  (globalThis as unknown as { DOMRect: unknown }).DOMRect = RectForTests;
}

import { WorkItemTreePanel } from "@/components/WorkItemTreePanel";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useLabelsStore } from "@/store/labelsStore";
import { useTeamStore } from "@/store/teamStore";
import { useClosedPostingsStore } from "@/store/closedPostingsStore";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { useSnoozeStore } from "@/store/snoozeStore";
import { useListSortStore } from "@/store/listSortStore";
import { setCurrentUser } from "@/lib/currentUser";
import type { WorkItem } from "@/types/models";

const ORG = "org";
const TREE = "org::tree-1";
const TREE2 = "org::tree-2";
const LIST = "org::bl-1";
const CHILD_LIST = "org::bl-1a";
const ELSEWHERE = "org::bl-2";
const OTHER = "org::bl-9";

const item = (id: string, over: Partial<WorkItem> = {}): WorkItem =>
  ({
    id,
    title: `Item ${id}`,
    status: "not_started",
    parentId: null,
    childrenIds: [],
    backlogAssignments: { [TREE]: LIST },
    ranks: { [LIST]: 0 },
    boardRanks: {},
    organizationId: ORG,
    ...over,
  }) as WorkItem;

const ALL_ON = {
  timeLoggingEnabled: true, pointsEnabled: true, labelsEnabled: true, customStatusesEnabled: true,
  savingsIncomeEnabled: true, boardsEnabled: true, burnupsEnabled: true, persistNotificationsEnabled: false,
  publicLinksEnabled: true, ratingsEnabled: true, deadlinesEnabled: true, createdDatesEnabled: true,
  startEndDatesEnabled: true, scramblingEnabled: true,
};
const ALL_OFF = Object.fromEntries(Object.keys(ALL_ON).map((k) => [k, false]));

/**
 * List:        A (multi-tree, everything set) › A1 (done, 2 points), A2 (5 points)
 *              B (closed ad)
 *              D, whose parent P is in another list of the tree
 * Child list:  C
 * Elsewhere:   P › D
 * Tree 2:      A as well, in "Other"
 */
function seed({
  selected = [] as string[],
  expanded = ["A"],
  settings = ALL_ON as Record<string, boolean>,
  view = "list" as "list" | "board",
  query = "",
} = {}) {
  const items = [
    item("A", {
      points: 3, rating: 4, deadline: "2020-01-02", createdOn: "2020-01-01", startedOn: "2020-01-03", endedOn: "2020-01-05",
      respawnEnabled: true, respawnIntervalDays: 3, respawnHour: 7,
      childrenIds: ["A1", "A2"],
      backlogAssignments: { [TREE]: LIST, [TREE2]: OTHER }, ranks: { [LIST]: 0, [OTHER]: 0 },
    } as Partial<WorkItem>),
    item("A1", { parentId: "A", status: "done", points: 2 }),
    item("A2", { parentId: "A", points: 5, ranks: { [LIST]: 1 } }),
    item("B", { ranks: { [LIST]: 1 } }),
    item("D", { parentId: "P", ranks: { [LIST]: 2 } }),
    item("P", { childrenIds: ["D"], backlogAssignments: { [TREE]: ELSEWHERE }, ranks: { [ELSEWHERE]: 0 } }),
    item("C", { backlogAssignments: { [TREE]: CHILD_LIST }, ranks: { [CHILD_LIST]: 0 } }),
  ];
  useOrgStore.setState({ activeOrgId: ORG });
  useOrgSettingsStore.setState({ settings: { [ORG]: settings } } as never);
  useAppStore.setState({
    organizationId: ORG,
    workItems: Object.fromEntries(items.map((i) => [i.id, i])),
    backlogs: {
      [LIST]: { id: LIST, name: "List", parentId: null, childrenIds: [CHILD_LIST], treeId: TREE, rank: 0, viewMode: view, ratingsEnabled: true, createdDatesEnabled: true, startEndDatesEnabled: true },
      [CHILD_LIST]: { id: CHILD_LIST, name: "Child list", parentId: LIST, childrenIds: [], treeId: TREE, rank: 0, ratingsEnabled: true, createdDatesEnabled: true, startEndDatesEnabled: true },
      [ELSEWHERE]: { id: ELSEWHERE, name: "Elsewhere", parentId: null, childrenIds: [], treeId: TREE, rank: 1 },
      [OTHER]: { id: OTHER, name: "Other", parentId: null, childrenIds: [], treeId: TREE2, rank: 0 },
    } as never,
    backlogTrees: {
      [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [LIST, ELSEWHERE], rank: 0 },
      [TREE2]: { id: TREE2, name: "Tree two", rootBacklogIds: [OTHER], rank: 1 },
    } as never,
    hyperlinks: { A: [{ id: "h1", workItemId: "A", url: "https://example.com", altText: "", rank: 0 }] },
    selectedTreeId: TREE,
    selectedBacklogIds: [LIST],
    selectedWorkItemIds: selected,
    expandedWorkItems: new Set(expanded),
    searchQuery: query,
    isLoading: false,
    loadingProgress: 100,
  } as never);
  useLabelsStore.setState({
    labels: {
      urgent: { id: "urgent", organizationId: ORG, name: "Urgent", color: "#ff0000" },
      later: { id: "later", organizationId: ORG, name: "Later", color: "#00ff00" },
    },
    byEntity: { "work_item:A": ["urgent"] },
  } as never);
  useTeamStore.setState({
    teams: [
      { id: "t1", name: "Red", organization_id: ORG },
      { id: "t2", name: "Blue", organization_id: ORG },
    ],
    workItemTeams: { A: ["t1"] },
  } as never);
  useClosedPostingsStore.setState({ closed: new Set(["B"]), unknown: new Set(["D"]) } as never);
  setCurrentUser({ id: "me", email: null, fullName: null } as never);
  render(
    <TooltipProvider>
      <WorkItemTreePanel />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  cleanup();
  // A sort chosen in one test is kept, as it is for a reader; start from rank.
  useListSortStore.getState().setMode(LIST, "rank");
  useScrambledItemsStore.setState({ byItem: new Map() } as never);
});

/** Ids React makes up differ from run to run; the rest is the row as drawn. */
const normalize = (html: string) => html.replace(/:r[0-9a-z]+:/g, ":r:");

const rowOf = (id: string) => document.querySelector(`[data-work-item-id="${id}"]`) as HTMLElement;

/** Each row drawn, in order, as its whole wrapper (row and any inline input). */
/** Each board card drawn, in order. */
function cardsAsDrawn() {
  return [...document.querySelectorAll("[data-board-card-id]")].map((card) => ({
    id: card.getAttribute("data-board-card-id"),
    html: normalize(card.outerHTML),
  }));
}

/** Each search result drawn, in order. */
function resultsAsDrawn() {
  return [...document.querySelectorAll("[role=listbox][aria-label='Search results'] [role=option]")].map((r) => normalize(r.outerHTML));
}

function rowsAsDrawn() {
  return [...document.querySelectorAll("[data-work-item-id]")].map((row) => ({
    id: row.getAttribute("data-work-item-id"),
    html: normalize((row.parentElement?.parentElement ?? row).outerHTML),
  }));
}

/** What is open over the list: dialogs by their headings, and inline inputs. */
function opened() {
  const dialogs = [...document.querySelectorAll("[role=dialog],[role=alertdialog]")].map((d) => {
    const heading = d.querySelector("h1,h2,h3,[id$='-title']");
    return (heading?.textContent ?? d.textContent ?? "").trim().slice(0, 80);
  });
  const inline = [...document.querySelectorAll("textarea,input")]
    .filter((el) => !el.closest("[role=dialog],[role=alertdialog],[role=menu]"))
    .map((el) => `${el.tagName.toLowerCase()}${(el as HTMLInputElement).placeholder ? ` "${(el as HTMLInputElement).placeholder}"` : ""}=${(el as HTMLInputElement).value}`)
    .filter((s) => !s.includes("Search") && !s.includes("Filter"));
  return { dialogs, inline };
}

/** A menu's entries as offered: role, text and whether it can be chosen. */
function menuEntries(menu: HTMLElement) {
  return [...menu.querySelectorAll("[role^=menuitem],[role=separator]")]
    .filter((el) => el.closest("[role=menu]") === menu)
    .map((el) => {
      const role = el.getAttribute("role");
      if (role === "separator") return "—";
      const state = el.getAttribute("aria-checked") === "true" ? " [x]" : el.hasAttribute("data-disabled") ? " (disabled)" : "";
      return `${role}: ${(el.textContent ?? "").trim()}${state}`;
    });
}

const menus = () => screen.queryAllByRole("menu");

function openMenu(id: string) {
  fireEvent.contextMenu(rowOf(id));
  return menus()[0];
}

/** A dropdown opens from the keyboard here: jsdom has no pointer events for it. */
function openDropdown(trigger: HTMLElement) {
  fireEvent.keyDown(trigger, { key: "Enter" });
}

function openSub(name: string) {
  const before = menus().length;
  fireEvent.click(screen.getByRole("menuitem", { name }));
  const after = menus();
  return after.length > before ? after[after.length - 1] : null;
}

async function settle(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** A duplicate opens its name for editing 50 ms on; wait for that, so the result does not depend on timing. */
const AFTER_DUPLICATE_MS = 120;

describe("a row as drawn", () => {
  it("with everything the organization can switch on", () => {
    seed();
    expect(rowsAsDrawn()).toMatchSnapshot();
  });

  it("with everything switched off", () => {
    seed({ settings: ALL_OFF });
    expect(rowsAsDrawn()).toMatchSnapshot();
  });

  it("selected, alone and with others", () => {
    seed({ selected: ["A", "B"] });
    expect(rowsAsDrawn().filter((r) => r.id === "A" || r.id === "B")).toMatchSnapshot();
  });

  it("with its name scrambled", () => {
    useScrambledItemsStore.setState({ byItem: new Map([["B", "me"]]) } as never);
    seed();
    expect(rowsAsDrawn().find((r) => r.id === "B")).toMatchSnapshot();
  });
});

describe("a board card as drawn", () => {
  it("with everything the organization can switch on", () => {
    seed({ view: "board" });
    expect(cardsAsDrawn()).toMatchSnapshot();
  });

  it("selected", () => {
    seed({ view: "board", selected: ["A"] });
    expect(cardsAsDrawn().find((c) => c.id === "A")).toMatchSnapshot();
  });

  it("is renamed in place on a double click", () => {
    seed({ view: "board" });
    fireEvent.doubleClick(document.querySelector('[data-board-card-id="B"]')!);
    const input = document.querySelector('[data-board-card-id="B"] input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useAppStore.getState().workItems.B.title).toBe("Renamed");
  });
});

/** The panel without its rows (recorded on their own above): header, filter bar, lists. */
function panelAsDrawn() {
  const panel = document.querySelector("[role=combobox]")!.closest(".h-full.flex.flex-col")!.cloneNode(true) as HTMLElement;
  panel.querySelectorAll("[data-index]").forEach((row) => row.remove());
  return normalize(panel.outerHTML);
}

const filterBox = () => document.querySelector("[role=combobox]") as HTMLInputElement;

/**
 * A label or team chip under the filter box. Looked for there, not in the whole
 * panel: naming every button of every row took jsdom about 4 s, and pushed
 * these tests past the time limit whenever the machine was busy.
 */
const chip = (name: string) => within(filterBox().parentElement!.parentElement!).getByRole("button", { name });

async function typeSearch(text: string) {
  await act(async () => {
    fireEvent.change(filterBox(), { target: { value: text } });
  });
  await settle();
}

describe("the list panel", () => {
  it("draws its header and filter bar", () => {
    seed();
    expect(panelAsDrawn()).toMatchSnapshot();
  });

  it("draws them with everything switched off", () => {
    seed({ settings: ALL_OFF });
    expect(panelAsDrawn()).toMatchSnapshot();
  });

  it("offers to wake the items snoozed in the list", () => {
    useSnoozeStore.setState({
      snoozes: { C: { id: "s", userId: "me", workItemId: "C", organizationId: ORG, snoozedUntil: "2999-01-01T00:00:00Z", note: null, createdAt: "", updatedAt: "" } },
    } as never);
    seed();
    const button = screen.getByTitle(/hidden by snooze/);
    expect(button.textContent).toBe("Snoozed: 1");
    useSnoozeStore.setState({ snoozes: {} } as never);
  });

  it("shows the label and team chips while the filter box is focused", () => {
    seed();
    fireEvent.focus(filterBox());
    expect(normalize(filterBox().parentElement!.parentElement!.outerHTML)).toMatchSnapshot();
  });

  it("lists the items with a label chosen, and goes to one", async () => {
    seed();
    fireEvent.focus(filterBox());
    fireEvent.click(chip("Urgent"));
    await settle();
    expect(panelAsDrawn()).toMatchSnapshot();
    fireEvent.click(document.querySelector("[role=option]")!);
    await settle(120);
    expect({ selected: useAppStore.getState().selectedWorkItemIds, filtered: !!screen.queryByText("Label filter results") }).toEqual({ selected: ["A"], filtered: false });
  });

  it("lists the items with a team chosen", async () => {
    seed();
    fireEvent.focus(filterBox());
    fireEvent.click(chip("Red"));
    await settle();
    expect(screen.getByText("Team filter results")).toBeInTheDocument();
    expect([...document.querySelectorAll("[role=option]")].map((o) => o.textContent)).toMatchSnapshot();
  });

  it("suggests commands as one is typed, and Tab completes the first", async () => {
    seed();
    fireEvent.focus(filterBox());
    await typeSearch("/du");
    const suggestions = [...document.querySelectorAll("[aria-label='Search commands'] [role=option]")].map((o) => o.textContent);
    fireEvent.keyDown(filterBox(), { key: "Tab" });
    expect({ suggestions, completed: useAppStore.getState().searchQuery }).toMatchSnapshot();
  });

  it("moves through the results with the arrow keys and opens the chosen one with Enter", async () => {
    seed();
    await typeSearch("Item");
    const titles = [...document.querySelectorAll("[aria-label='Search results'] [role=option]")].map((o) => o.textContent);
    fireEvent.keyDown(filterBox(), { key: "ArrowDown" });
    fireEvent.keyDown(filterBox(), { key: "ArrowDown" });
    const active = document.querySelector("[aria-label='Search results'] [aria-selected=true]")?.textContent;
    fireEvent.keyDown(filterBox(), { key: "Enter" });
    await settle(120);
    expect({ titles, active, selected: useAppStore.getState().selectedWorkItemIds, query: useAppStore.getState().searchQuery }).toMatchSnapshot();
  });

  it("finds lists by name too, and opens one", async () => {
    seed();
    await typeSearch("Elsewhere");
    const titles = [...document.querySelectorAll("[aria-label='Search results'] [role=option]")].map((o) => o.textContent);
    fireEvent.click(screen.getByText("(list)").closest("[role=option]")!);
    await settle();
    expect({ titles, list: useAppStore.getState().selectedBacklogIds }).toMatchSnapshot();
  });

  it("counts the items, and the one selected", () => {
    seed({ selected: ["B"] });
    expect(screen.getByRole("heading", { name: /List/ }).parentElement!.textContent).toMatchSnapshot();
  });

  it("ranks an item and a list of the same name", async () => {
    seed();
    await act(async () => {
      useAppStore.setState((s) => ({ workItems: { ...s.workItems, B: { ...s.workItems.B, title: "Other" } } }));
    });
    await typeSearch("Other");
    expect([...document.querySelectorAll("[aria-label='Search results'] [role=option]")].map((o) => o.textContent)).toMatchSnapshot();
  });

  it("says when nothing is found", async () => {
    seed();
    await typeSearch("zzqx");
    expect(panelAsDrawn()).toMatchSnapshot();
  });

  it("clears the search and the filters with Escape", async () => {
    seed();
    fireEvent.focus(filterBox());
    fireEvent.click(chip("Urgent"));
    await typeSearch("Item");
    fireEvent.keyDown(filterBox(), { key: "Escape" });
    await settle();
    expect({ query: useAppStore.getState().searchQuery, filtered: !!screen.queryByText(/filter results/) }).toEqual({ query: "", filtered: false });
  });

  it("focuses the filter box with /", () => {
    seed();
    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(filterBox());
  });

  it("offers the list's sorts, and sorts the top level by one", async () => {
    seed();
    openDropdown(screen.getByTitle("Sort top-level items"));
    const entries = menuEntries(menus()[0]);
    fireEvent.click(within(menus()[0]).getAllByRole("menuitemradio").find((m) => /Z.*A|Name.*desc|descending/i.test(m.textContent ?? "")) ?? within(menus()[0]).getAllByRole("menuitemradio")[1]);
    await settle();
    expect({ entries, rows: rowsAsDrawn().map((r) => r.id), button: document.querySelector("[title^='Sorted by'],[title='Sort top-level items']")?.getAttribute("title") }).toMatchSnapshot();
  });

  it("opens a new item's field with the add button, and adds it", async () => {
    seed();
    fireEvent.click(screen.getByTitle("Add work item (Enter)"));
    const field = screen.getByPlaceholderText("Work item title…");
    fireEvent.change(field, { target: { value: "New one" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await settle();
    expect(Object.values(useAppStore.getState().workItems).some((w) => w.title === "New one" && !w.parentId)).toBe(true);
  });

  it("opens the list's time log from the header", async () => {
    seed();
    fireEvent.click(screen.getByTitle("Log time for this list"));
    await settle();
    expect(opened().dialogs).toEqual(["Time Log"]);
  });

  it("offers the list's own menu when its header is right-clicked", () => {
    seed();
    fireEvent.contextMenu(screen.getByRole("heading", { name: /List/ }));
    expect(menuEntries(menus()[0])).toMatchSnapshot();
  });

  it("adds an item with Insert: a child of the selected one, or at the top", async () => {
    seed({ selected: ["B"] });
    fireEvent.keyDown(window, { key: "Insert" });
    await settle();
    const child = opened().inline;
    cleanup();
    seed();
    fireEvent.keyDown(window, { key: "Insert" });
    await settle();
    expect({ child, top: opened().inline }).toMatchSnapshot();
  });
});

describe("a search result as drawn", () => {
  it("lists what matches, with where it is", async () => {
    seed();
    // Typed after the list is shown: opening a list clears the search box.
    await act(async () => {
      useAppStore.getState().setSearchQuery("Item");
    });
    await settle();
    expect(resultsAsDrawn()).toMatchSnapshot();
  });
});

describe("a row's right-click menu", () => {
  it("offers, for one item", () => {
    seed();
    expect(menuEntries(openMenu("A"))).toMatchSnapshot();
  });

  it("offers, for an item of several selected", () => {
    seed({ selected: ["A", "B"] });
    expect(menuEntries(openMenu("A"))).toMatchSnapshot();
  });

  it("offers, with everything switched off", () => {
    seed({ settings: ALL_OFF });
    expect(menuEntries(openMenu("B"))).toMatchSnapshot();
  });

  it("offers, for a name I scrambled and one someone else did", () => {
    useScrambledItemsStore.setState({ byItem: new Map([["B", "me"], ["D", "them"]]) } as never);
    seed({ selected: ["B"] });
    const mine = menuEntries(openMenu("B"));
    cleanup();
    useScrambledItemsStore.setState({ byItem: new Map([["B", "me"], ["D", "them"]]) } as never);
    seed();
    const theirs = menuEntries(openMenu("D"));
    expect({ mine, theirs }).toMatchSnapshot();
  });

  it("does not offer scrambling where the organization has it off, but a name I scrambled keeps its entries", () => {
    useScrambledItemsStore.setState({ byItem: new Map([["B", "me"]]) } as never);
    seed({ settings: { ...ALL_ON, scramblingEnabled: false } });
    const plain = menuEntries(openMenu("D")).join(" | ");
    cleanup();
    useScrambledItemsStore.setState({ byItem: new Map([["B", "me"]]) } as never);
    seed({ settings: { ...ALL_ON, scramblingEnabled: false } });
    const mine = menuEntries(openMenu("B")).join(" | ");
    expect(plain).not.toContain("Scramble");
    expect(mine).toContain("Show real name…");
    expect(mine).toContain("Unscramble name…");
  });

  for (const sub of ["Status", "Insert icon", "Move to list", "Labels", "Assign teams", "Snooze"]) {
    it(`has a ${sub} submenu`, () => {
      seed({ selected: ["A", "B"] });
      openMenu("A");
      const menu = openSub(sub);
      expect(menu && menuEntries(menu).slice(0, 30)).toMatchSnapshot();
    });
  }
});

describe("an item's menu, wherever the item is", () => {
  // Each draws the whole panel up to three times.
  vi.setConfig({ testTimeout: 20000 });
  afterAll(() => vi.resetConfig());

  /** The menu as the list row offers it, the board card, and the search result. */
  async function menusOf(id: string) {
    seed();
    const row = menuEntries(openMenu(id));
    cleanup();
    seed({ view: "board" });
    fireEvent.contextMenu(document.querySelector(`[data-board-card-id="${id}"]`)!);
    const card = menuEntries(menus()[0]);
    cleanup();
    seed();
    await act(async () => {
      useAppStore.getState().setSearchQuery(`Item ${id}`);
    });
    await settle();
    const result = [...document.querySelectorAll("[role=option]")].find((o) => o.textContent?.includes(`Item ${id}`))!;
    fireEvent.contextMenu(result);
    const found = menuEntries(menus()[0]);
    return { row, card, found };
  }

  it("is the same on the board, but for going to the other view", async () => {
    // B: the board shows the items without children.
    const { row, card } = await menusOf("B");
    expect(card).toEqual(row.map((e) => (e === "menuitem: View in board" ? "menuitem: View in list" : e)));
  });

  it("is the same in the search results, but for what needs the list itself", async () => {
    const { row, found } = await menusOf("B");
    // Nowhere to view it in but the list it opens in; and an icon goes into a
    // name being typed, which a search result has none of.
    expect(found).toEqual(row.filter((e) => e !== "menuitem: View in board" && e !== "menuitem: Insert icon"));
  });

  it("opens the same dialogs from a board card", async () => {
    seed({ view: "board" });
    fireEvent.contextMenu(document.querySelector('[data-board-card-id="B"]')!);
    fireEvent.click(within(menus()[0]).getByText("Set deadline…"));
    await settle();
    expect(opened().dialogs).toEqual(["Deadline"]);
  });

  it("renames a search result by going to the item and opening its name there", async () => {
    seed();
    await act(async () => {
      useAppStore.getState().setSearchQuery("Item B");
    });
    await settle();
    const result = [...document.querySelectorAll("[role=option]")].find((o) => o.textContent?.includes("Item B"))!;
    fireEvent.contextMenu(result);
    fireEvent.click(within(menus()[0]).getByText("Rename"));
    // It waits for the menu to close, then for the item's row to be drawn in its list.
    for (let i = 0; i < 60 && opened().inline.length === 0; i++) await settle(50);
    expect(useAppStore.getState().selectedWorkItemIds).toEqual(["B"]);
    expect(opened().inline).toEqual(["textarea=Item B"]);
  });
});

describe("an edit started from an item's menu", () => {
  // The menu hands focus back to the row as it closes; an edit started from it
  // must keep it, or what is typed goes nowhere and Escape does not cancel.
  const cases: Array<[string, (el: Element | null) => boolean]> = [
    ["Rename", (el) => el?.tagName === "TEXTAREA" && (el as HTMLTextAreaElement).value === "Item B"],
    ["Edit story points", (el) => el?.tagName === "INPUT"],
    ["Add child item", (el) => el?.getAttribute("placeholder") === "Work item title…"],
  ];
  for (const [entry, isTheField] of cases) {
    it(`keeps the focus in its field: ${entry}`, async () => {
      seed();
      fireEvent.click(within(openMenu("B")).getByText(entry));
      await settle(50);
      expect(isTheField(document.activeElement), `focus is on ${document.activeElement?.tagName}`).toBe(true);
    });
  }

  it("keeps the focus in the board's points editor", async () => {
    seed({ view: "board" });
    fireEvent.contextMenu(document.querySelector('[data-board-card-id="B"]')!);
    fireEvent.click(within(menus()[0]).getByText("Edit story points"));
    await settle(50);
    expect(document.activeElement?.tagName).toBe("INPUT");
    // Drawn over the page, not inside the card's column.
    expect(document.activeElement?.closest("[data-board-card-id]")).toBeNull();
    expect(document.activeElement?.closest("[role=dialog]")).not.toBeNull();
  });
});

describe("what each menu entry opens", () => {
  const entries = [
    "Set deadline…", "Change deadline…", "Change created date…", "Change start and end dates…", "View in board",
    "View burnup…", "Rank to top", "Description…", "Rename", "Scramble name…", "Duplicate", "Edit story points",
    "Add child item", "Sort children A→Z", "Move…", "Reparent…", "Log time", "Transfer time entries",
    "Respawn settings", "Hyperlinks", "Savings & Income", "Delete",
  ];
  for (const entry of entries) {
    it(entry, async () => {
      seed({ selected: ["A"] });
      const menu = openMenu("A");
      const el = within(menu).queryAllByRole("menuitem").find((m) => (m.textContent ?? "").trim().startsWith(entry));
      if (!el) {
        expect("not offered").toMatchSnapshot();
        return;
      }
      fireEvent.click(el);
      await settle(entry === "Duplicate" ? AFTER_DUPLICATE_MS : 0);
      const s = useAppStore.getState();
      expect({
        ...opened(),
        selected: s.selectedWorkItemIds.map((id) => s.workItems[id]?.title ?? id),
        order: Object.values(s.workItems).filter((w) => !w.parentId).sort((a, b) => (a.ranks[LIST] ?? 0) - (b.ranks[LIST] ?? 0)).map((w) => w.title),
        count: Object.keys(s.workItems).length,
      }).toMatchSnapshot();
    });
  }
});

describe("what the row's own controls open", () => {
  const controls: Array<[string, () => HTMLElement | null]> = [
    ["the deadline", () => within(rowOf("A")).queryByRole("button", { name: /Deadline/ })],
    ["the created date", () => within(rowOf("A")).queryByRole("button", { name: /Created/ })],
    ["the start and end dates", () => within(rowOf("A")).queryByRole("button", { name: /^Started/ })],
    ["the points", () => rowOf("A").querySelector("[title^='Own:'],[title^='Story points (click']")],
    ["the hyperlinks badge", () => rowOf("A").querySelector("button.text-primary\\/70")],
    ["the add-child button", () => rowOf("A").querySelector("[title^='Add child item']")],
    ["the respawn button", () => rowOf("A").querySelector("[title='Respawn settings']")],
    ["the hyperlinks button", () => rowOf("A").querySelector("[title^='Manage hyperlinks']")],
    ["the log time button", () => rowOf("A").querySelector("[title='Log time']")],
    ["the delete button", () => rowOf("A").querySelector("[title^='Delete item']")],
    ["the attributes button", () => rowOf("A").querySelector("[aria-label^='Edit attributes']")],
  ];
  for (const [name, find] of controls) {
    it(name, async () => {
      seed({ selected: ["B"] });
      const el = find();
      if (!el) {
        expect("not drawn").toMatchSnapshot();
        return;
      }
      fireEvent.click(el);
      await settle();
      expect(opened()).toMatchSnapshot();
    });
  }

  it("a double click marks it done, and again not started", () => {
    seed();
    fireEvent.doubleClick(rowOf("B"));
    const once = useAppStore.getState().workItems.B.status;
    fireEvent.doubleClick(rowOf("B"));
    expect([once, useAppStore.getState().workItems.B.status]).toEqual(["done", "not_started"]);
  });

  it("a double click on a selection marks all of it", () => {
    seed({ selected: ["B", "D"] });
    fireEvent.doubleClick(rowOf("B"));
    const s = useAppStore.getState().workItems;
    expect([s.B.status, s.D.status, s.A.status]).toEqual(["done", "done", "not_started"]);
  });

  it("the chevron closes a branch, with Shift just the one level", () => {
    seed();
    const chevron = rowOf("A").querySelectorAll("button")[0];
    fireEvent.click(chevron);
    const closed = [...useAppStore.getState().expandedWorkItems];
    fireEvent.click(rowOf("A").querySelectorAll("button")[0], { shiftKey: true });
    expect({ closed, reopened: [...useAppStore.getState().expandedWorkItems] }).toMatchSnapshot();
  });

  it("a click selects, Ctrl adds, Shift extends", () => {
    seed();
    fireEvent.click(rowOf("B"));
    const one = [...useAppStore.getState().selectedWorkItemIds];
    fireEvent.click(rowOf("D"), { ctrlKey: true });
    const two = [...useAppStore.getState().selectedWorkItemIds];
    fireEvent.click(rowOf("A"), { shiftKey: true });
    expect({ one, two, range: [...useAppStore.getState().selectedWorkItemIds] }).toMatchSnapshot();
  });

  it("the status dot sets the status of the whole selection", () => {
    seed({ selected: ["B", "D"] });
    const dot = rowOf("B").querySelector("button.rounded-full") as HTMLElement;
    openDropdown(dot);
    const menu = menus()[0];
    const entries = menu ? menuEntries(menu) : null;
    const done = menu && within(menu).getAllByRole("menuitem").find((m) => m.textContent?.trim() === "Done");
    if (done) fireEvent.click(done);
    const s = useAppStore.getState().workItems;
    expect({ entries, statuses: [s.B.status, s.D.status, s.A.status] }).toMatchSnapshot();
  });

  it("the teams of an item are picked from its row", () => {
    seed({ selected: ["A"] });
    const trigger = rowOf("A").querySelector("span.cursor-pointer") as HTMLElement;
    openDropdown(trigger);
    const menu = menus()[0];
    expect(menu ? menuEntries(menu) : null).toMatchSnapshot();
  });
});

describe("what the shortcuts open from the selected row", () => {
  const events = [
    "shortcut:add-child-workitem",
    "shortcut:add-sibling-workitem",
    "shortcut:delete-selected",
    "shortcut:duplicate-selected",
    "shortcut:edit-hyperlinks",
    "shortcut:log-time",
    "shortcut:move-to-parent",
    "shortcut:move-to-backlog",
    "shortcut:open-team-assign",
  ];
  for (const name of events) {
    it(name, async () => {
      seed({ selected: ["B"] });
      await act(async () => {
        window.dispatchEvent(new CustomEvent(name));
      });
      await settle(name === "shortcut:duplicate-selected" ? AFTER_DUPLICATE_MS : 0);
      const s = useAppStore.getState();
      expect({ ...opened(), menus: menus().map(menuEntries), count: Object.keys(s.workItems).length }).toMatchSnapshot();
    });
  }

  for (const name of events) {
    it(`${name}, with several selected`, async () => {
      seed({ selected: ["D", "B"] });
      await act(async () => {
        window.dispatchEvent(new CustomEvent(name));
      });
      await settle(name === "shortcut:duplicate-selected" ? AFTER_DUPLICATE_MS : 0);
      const s = useAppStore.getState();
      expect({ ...opened(), menus: menus().map(menuEntries), count: Object.keys(s.workItems).length }).toMatchSnapshot();
    });
  }

  it("shortcut:edit-title opens the named row's name for editing", async () => {
    seed();
    await act(async () => {
      window.dispatchEvent(new CustomEvent("shortcut:edit-title", { detail: { workItemId: "D" } }));
    });
    expect(opened()).toMatchSnapshot();
  });
});
