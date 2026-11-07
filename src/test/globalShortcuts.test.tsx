/**
 * Every keyboard shortcut AppLayout answers, pinned as it behaves: what each
 * key does with an item selected, with only a list selected, with nothing,
 * while typing in a field and with a dialog open — which events it sends, and
 * what becomes of the selection, statuses, ranks, expanded rows and overlays.
 *
 * Recorded before the 537-line handler became a table of shortcuts
 * (lib/shortcuts.ts), so that the table can be checked to do exactly the same.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.setConfig({ testTimeout: 20_000 });
import { render as rtlRender, act, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

const render = (ui: ReactElement) =>
  rtlRender(
    <MemoryRouter>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>,
  );

vi.mock("@/components/BacklogTreePanel", () => ({ BacklogTreePanel: () => null }));
vi.mock("@/components/WorkItemTreePanel", () => ({ WorkItemTreePanel: () => null }));
vi.mock("@/components/ActionPrompt", () => ({ ActionPrompt: () => null }));
vi.mock("@/components/DeleteGuardHost", () => ({ DeleteGuardHost: () => null }));
vi.mock("@/components/RerankGuardHost", () => ({ RerankGuardHost: () => null }));
vi.mock("@/components/JobSearchRunButton", () => ({ JobSearchRunButton: () => null }));
vi.mock("@/components/PersistDebugOverlay", () => ({ PersistDebugOverlay: () => null }));
vi.mock("@/components/OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("@/components/RoleSimulator", () => ({ RoleSimulator: () => null }));
vi.mock("@/components/UserGuideDialog", () => ({ UserGuideDialog: () => null }));
vi.mock("@/components/TimesheetBrowserDialog", () => ({
  TimesheetBrowserDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="timesheet-open" /> : null),
}));
vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
  upsertBacklogs: vi.fn(),
  upsertBacklog: vi.fn(),
}));

import AppLayout from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { visibleWorkItemIdsRef, visibleBacklogIdsRef } from "@/store/navigationRefs";
import type { WorkItem } from "@/types/models";

const ORG = "org-1";
const TREE = `${ORG}::bt-1`;
const L1 = `${ORG}::bl-1`;
const L2 = `${ORG}::bl-2`;
const L1A = `${ORG}::bl-1a`;

const item = (id: string, rank: number, over: Partial<WorkItem> = {}): WorkItem =>
  ({ id, title: id, status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { [TREE]: L1 }, ranks: { [L1]: rank }, organizationId: ORG, ...over }) as WorkItem;

function settings(timeLogging: boolean) {
  useOrgSettingsStore.setState({
    settings: {
      [ORG]: {
        timeLoggingEnabled: timeLogging, pointsEnabled: false, labelsEnabled: false, customStatusesEnabled: false,
        savingsIncomeEnabled: false, boardsEnabled: false, burnupsEnabled: false, persistNotificationsEnabled: false,
        publicLinksEnabled: false, ratingsEnabled: false, deadlinesEnabled: false, createdDatesEnabled: false,
        startEndDatesEnabled: false, scramblingEnabled: false,
      },
    },
  } as never);
}

/** A list of A (with A1 under it), B, C; a second list L2 beside it, and L1A under L1. */
function seed(selectedItems: string[], selectedLists: string[] = [L1]) {
  const items = [item("A", 0, { childrenIds: ["A1"] }), item("A1", 0, { parentId: "A" }), item("B", 1), item("C", 2)];
  useAppStore.setState({
    organizationId: ORG,
    workItems: Object.fromEntries(items.map((i) => [i.id, i])),
    backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [L1, L2], rank: 0 } },
    backlogs: {
      [L1]: { id: L1, name: "One", parentId: null, childrenIds: [L1A], treeId: TREE, rank: 0 },
      [L1A]: { id: L1A, name: "One A", parentId: L1, childrenIds: [], treeId: TREE, rank: 0 },
      [L2]: { id: L2, name: "Two", parentId: null, childrenIds: [], treeId: TREE, rank: 1 },
    },
    selectedTreeId: TREE,
    selectedBacklogIds: selectedLists,
    selectedWorkItemIds: selectedItems,
    expandedWorkItems: new Set<string>(),
    expandedBacklogs: new Set<string>(),
    undoStack: [],
    redoStack: [],
  } as never);
  visibleWorkItemIdsRef.current = ["A", "A1", "B", "C"];
  visibleBacklogIdsRef.current = [L1, L1A, L2];
}

let events: Array<{ type: string; detail: unknown }> = [];
const realDispatch = window.dispatchEvent.bind(window);

beforeEach(() => {
  useOrgStore.setState({
    activeOrgId: ORG,
    memberships: [{ organization_id: ORG, organization_name: "Acme", organization_slug: "acme", role: "owner" }],
  } as never);
  settings(false);
  events = [];
  vi.spyOn(window, "dispatchEvent").mockImplementation((ev: Event) => {
    if (ev.type.startsWith("shortcut:")) events.push({ type: ev.type, detail: (ev as CustomEvent).detail ?? null });
    return realDispatch(ev);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

type Press = { key: string; shift?: boolean; ctrl?: boolean; alt?: boolean; target?: "body" | "input" | "dialog" };

/** Press a key the way a person would, and say what came of it. */
async function press({ key, shift = false, ctrl = false, alt = false, target = "body" }: Press) {
  let on: HTMLElement = document.body;
  let dialog: HTMLElement | null = null;
  if (target === "input") {
    on = document.createElement("input");
    document.body.appendChild(on);
    on.focus();
  } else if (target === "dialog") {
    dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
  }
  const ev = new KeyboardEvent("keydown", { key, shiftKey: shift, ctrlKey: ctrl, altKey: alt, bubbles: true, cancelable: true });
  await act(async () => {
    on.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 0));
  });
  if (target === "input") on.remove();
  dialog?.remove();
  const s = useAppStore.getState();
  return {
    prevented: ev.defaultPrevented,
    events: [...events],
    selectedItems: s.selectedWorkItemIds,
    selectedLists: s.selectedBacklogIds,
    statuses: Object.fromEntries(Object.values(s.workItems).map((w) => [w.id, w.status]).sort()),
    order: Object.values(s.workItems)
      .filter((w) => !w.parentId)
      .sort((a, b) => (a.ranks[L1] ?? 0) - (b.ranks[L1] ?? 0))
      .map((w) => w.id),
    listOrder: s.backlogTrees[TREE]?.rootBacklogIds ?? [],
    expandedItems: [...s.expandedWorkItems].sort(),
    expandedLists: [...s.expandedBacklogs].sort(),
    shortcutsOverlay: !!screen.queryByRole("heading", { name: "Keyboard Shortcuts" }),
    timesheet: !!screen.queryByTestId("timesheet-open"),
  };
}

const CASES: Array<[string, string[], string[] | undefined, Press]> = [
  // name, selected items, selected lists, key
  ["undo after nothing", ["B"], undefined, { key: "z", ctrl: true }],
  ["undo while typing", ["B"], undefined, { key: "z", ctrl: true, target: "input" }],
  ["redo with Ctrl+Y", ["B"], undefined, { key: "y", ctrl: true }],
  ["redo with Ctrl+Shift+Z", ["B"], undefined, { key: "z", ctrl: true, shift: true }],
  ["select all", ["B"], undefined, { key: "a", ctrl: true }],
  ["select all in a dialog", ["B"], undefined, { key: "a", ctrl: true, target: "dialog" }],
  ["Ctrl+A while typing selects the text, not the items", ["B"], undefined, { key: "a", ctrl: true, target: "input" }],
  ["hyperlinks with Ctrl+K", ["B"], undefined, { key: "k", ctrl: true }],
  ["Ctrl+K with nothing selected", [], undefined, { key: "k", ctrl: true }],
  ["duplicate", ["B"], undefined, { key: "d", ctrl: true }],
  ["Ctrl+Alt+D does not duplicate", ["B"], undefined, { key: "d", ctrl: true, alt: true }],
  ["D while typing", ["B"], undefined, { key: "d", target: "input" }],
  ["D in a dialog", ["B"], undefined, { key: "d", target: "dialog" }],
  ["rename with F2", ["B", "C"], undefined, { key: "F2" }],
  ["rename with Alt+Enter", ["B"], undefined, { key: "Enter", alt: true }],
  ["Ctrl+T does nothing", ["C"], undefined, { key: "t", ctrl: true }],
  ["to the top", ["C"], undefined, { key: "t" }],
  ["to the bottom", ["A"], undefined, { key: "B", shift: true }],
  ["blocked", ["B"], undefined, { key: "b" }],
  ["not started", ["B"], undefined, { key: "n" }],
  ["done", ["B", "C"], undefined, { key: "d" }],
  ["done with Shift", ["B"], undefined, { key: "D", shift: true }],
  ["in progress", ["B"], undefined, { key: "i" }],
  ["pending", ["B"], undefined, { key: "p" }],
  ["status with nothing selected", [], undefined, { key: "d" }],
  ["item down", ["A"], undefined, { key: "o" }],
  ["item up", ["C"], undefined, { key: "u" }],
  ["list down", [], [L1], { key: "o" }],
  ["list up", [], [L2], { key: "u" }],
  ["assign teams", ["B"], undefined, { key: "a" }],
  ["hyperlinks with H", ["B"], undefined, { key: "h" }],
  ["log time, logging off", ["B"], undefined, { key: "l" }],
  ["move to list", ["B"], undefined, { key: "m" }],
  ["reparent", ["B"], undefined, { key: "r" }],
  ["new sibling item", ["B"], undefined, { key: "Enter" }],
  ["new item in a list", [], [L1], { key: "Enter" }],
  ["new child item", ["B"], undefined, { key: "Enter", shift: true }],
  ["new child list", [], [L1], { key: "Enter", shift: true }],
  ["delete going down", ["B"], undefined, { key: "Delete" }],
  ["delete going up", ["B"], undefined, { key: "Backspace" }],
  ["delete a list", [], [L2], { key: "Delete" }],
  ["help overlay", ["B"], undefined, { key: "?", shift: true }],
  ["escape", ["B", "C"], undefined, { key: "Escape" }],
  ["expand an item", ["A"], undefined, { key: "ArrowRight" }],
  ["expand a list", [], [L1], { key: "ArrowRight" }],
  ["collapse an item", ["A"], undefined, { key: "ArrowLeft" }],
  ["next item", ["A"], undefined, { key: "ArrowDown" }],
  ["previous item", ["C"], undefined, { key: "ArrowUp" }],
  ["extend the selection down", ["A1"], undefined, { key: "ArrowDown", shift: true }],
  ["extend the selection up", ["B"], undefined, { key: "ArrowUp", shift: true }],
  ["next list", [], [L1], { key: "ArrowDown" }],
  ["previous list", [], [L2], { key: "ArrowUp" }],
  ["an unbound key", ["B"], undefined, { key: "q" }],
];

describe("global shortcuts, key by key", () => {
  for (const [name, items, lists, key] of CASES) {
    it(name, async () => {
      seed(items, lists);
      render(<AppLayout />);
      // A status change first, so undo and redo have something to work on.
      if (name.startsWith("undo") || name.startsWith("redo")) {
        await press({ key: "d" });
        if (name.startsWith("redo")) await press({ key: "z", ctrl: true });
        events = [];
      }
      expect(await press(key)).toMatchSnapshot();
    });
  }

  it("Shift+L opens the logged-time report and L logs time, where the organization logs time", async () => {
    settings(true);
    seed(["B"]);
    render(<AppLayout />);
    expect(await press({ key: "L", shift: true })).toMatchSnapshot();
    expect(await press({ key: "l" })).toMatchSnapshot();
  });

  it("? twice closes the overlay again", async () => {
    seed(["B"]);
    render(<AppLayout />);
    await press({ key: "?", shift: true });
    expect((await press({ key: "?", shift: true })).shortcutsOverlay).toBe(false);
  });
});
