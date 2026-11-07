/**
 * A work item's row in the list, pinned as it is: what it draws, what its
 * right-click menu offers, and what each entry, click and shortcut opens.
 *
 * Written before the row (WorkItemNodeContent) was taken apart into smaller
 * pieces, so that taking it apart changes nothing: the snapshots are of the
 * row as it was.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
function seed({ selected = [] as string[], expanded = ["A"], settings = ALL_ON as Record<string, boolean> } = {}) {
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
      [LIST]: { id: LIST, name: "List", parentId: null, childrenIds: [CHILD_LIST], treeId: TREE, rank: 0, ratingsEnabled: true, createdDatesEnabled: true, startEndDatesEnabled: true },
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
    searchQuery: "",
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
  useScrambledItemsStore.setState({ byItem: new Map() } as never);
});

/** Ids React makes up differ from run to run; the rest is the row as drawn. */
const normalize = (html: string) => html.replace(/:r[0-9a-z]+:/g, ":r:");

const rowOf = (id: string) => document.querySelector(`[data-work-item-id="${id}"]`) as HTMLElement;

/** Each row drawn, in order, as its whole wrapper (row and any inline input). */
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

function openSub(name: string) {
  const before = menus().length;
  fireEvent.click(screen.getByRole("menuitem", { name }));
  const after = menus();
  return after.length > before ? after[after.length - 1] : null;
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

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
      await settle();
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
    fireEvent.pointerDown(dot, { button: 0, ctrlKey: false });
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
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
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
      await settle();
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
      await settle();
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
