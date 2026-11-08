/**
 * Every drop AppLayout answers, pinned as it behaves: for each kind of thing
 * dragged and each place it lands, which store actions run and with what, what
 * the items, lists and trees look like afterwards, which toasts appear, whether
 * the cross-tree question or the re-rank question is asked, and how many undo
 * steps the drop makes.
 *
 * Recorded before the drop handler became one function per drop target, so the
 * split can be checked to do exactly the same. The drops go through the
 * onDragEnd that AppLayout hands to dnd-kit, so the test does not care where the
 * code behind it lives.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.setConfig({ testTimeout: 20_000 });
import { render as rtlRender, act, screen, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

const dnd = vi.hoisted(() => ({ onDragEnd: null as null | ((e: unknown) => void) }));
const toasts = vi.hoisted(() => [] as unknown[]);

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const real = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...real,
    DndContext: (props: Parameters<typeof real.DndContext>[0]) => {
      dnd.onDragEnd = props.onDragEnd as never;
      return <real.DndContext {...props} />;
    },
  };
});
vi.mock("@/hooks/use-toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-toast")>()),
  toast: (t: unknown) => {
    toasts.push(t);
    return { id: "t", dismiss: () => {}, update: () => {} };
  },
}));
vi.mock("@/components/BacklogTreePanel", () => ({ BacklogTreePanel: () => null }));
vi.mock("@/components/WorkItemTreePanel", () => ({ WorkItemTreePanel: () => null }));
vi.mock("@/components/ActionPrompt", () => ({
  ActionPrompt: ({
    title,
    options,
    onSelect,
    onCancel,
  }: {
    title: string;
    options: Array<{ label: string; description: string; value: string; isDefault?: boolean }>;
    onSelect: (v: string) => void;
    onCancel: () => void;
  }) => (
    <div data-testid="cross-tree-prompt">
      <p data-testid="prompt-title">{title}</p>
      {options.map((o) => (
        <button key={o.value} data-testid={`prompt-${o.value}`} data-description={o.description} data-default={String(!!o.isDefault)} onClick={() => onSelect(o.value)}>
          {o.label}
        </button>
      ))}
      <button data-testid="prompt-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));
vi.mock("@/components/DeleteGuardHost", () => ({ DeleteGuardHost: () => null }));
vi.mock("@/components/RerankGuardHost", () => ({ RerankGuardHost: () => null }));
vi.mock("@/components/JobSearchRunButton", () => ({ JobSearchRunButton: () => null }));
vi.mock("@/components/PersistDebugOverlay", () => ({ PersistDebugOverlay: () => null }));
vi.mock("@/components/OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("@/components/RoleSimulator", () => ({ RoleSimulator: () => null }));
vi.mock("@/components/UserGuideDialog", () => ({ UserGuideDialog: () => null }));
// Every save succeeds at once: a save left failing against the real client
// would show its "Failed to save" toast in whichever test happens to be running.
vi.mock("@/store/supabaseSync", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/store/supabaseSync")>();
  const saved = { ok: true, missingWorkItemIds: [] };
  return Object.fromEntries(
    Object.entries(real).map(([name, value]) => [
      name,
      typeof value === "function" && /^(upsert|delete|update|restore)/.test(name) ? vi.fn(async () => saved) : value,
    ]),
  );
});

import AppLayout from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useListSortStore } from "@/store/listSortStore";
import { useRerankGuardStore } from "@/store/rerankGuardStore";
import type { WorkItem, WorkItemStatus } from "@/types/models";

const render = (ui: ReactElement) =>
  rtlRender(
    <MemoryRouter>
      <TooltipProvider>{ui}</TooltipProvider>
    </MemoryRouter>,
  );

const ORG = "org-1";
const T1 = `${ORG}::bt-1`;
const T2 = `${ORG}::bt-2`;
const L1 = `${ORG}::bl-1`;
const L1A = `${ORG}::bl-1a`;
const L2 = `${ORG}::bl-2`;
const M1 = `${ORG}::bl-m1`;
const M2 = `${ORG}::bl-m2`;

const item = (id: string, over: Partial<WorkItem> = {}): WorkItem =>
  ({
    id,
    title: `Item ${id}`,
    status: "not_started" as WorkItemStatus,
    parentId: null,
    childrenIds: [],
    backlogAssignments: { [T1]: L1 },
    ranks: { [L1]: 0 },
    organizationId: ORG,
    ...over,
  }) as WorkItem;

/**
 * Tree One: list One (A with A1 under it, B, C, E), its sub-list One A (D), and
 * list Two. Tree Two: lists M1 (E, mirrored there) and M2.
 */
function seed(selectedItems: string[] = [], selectedLists: string[] = [L1]) {
  const items = [
    item("A", { childrenIds: ["A1"], ranks: { [L1]: 0 } }),
    item("A1", { parentId: "A", ranks: { [L1]: 0 } }),
    item("B", { ranks: { [L1]: 1 } }),
    item("C", { status: "in_progress", ranks: { [L1]: 2 } }),
    item("D", { backlogAssignments: { [T1]: L1A }, ranks: { [L1A]: 0 } }),
    item("E", { backlogAssignments: { [T1]: L1, [T2]: M1 }, ranks: { [L1]: 3, [M1]: 0 } }),
  ];
  useAppStore.setState({
    organizationId: ORG,
    workItems: Object.fromEntries(items.map((i) => [i.id, i])),
    backlogTrees: {
      [T1]: { id: T1, name: "Tree One", rootBacklogIds: [L1, L2], rank: 0 },
      [T2]: { id: T2, name: "Tree Two", rootBacklogIds: [M1, M2], rank: 1 },
    },
    backlogs: {
      [L1]: { id: L1, name: "One", parentId: null, childrenIds: [L1A], treeId: T1, rank: 0 },
      [L1A]: { id: L1A, name: "One A", parentId: L1, childrenIds: [], treeId: T1, rank: 0 },
      [L2]: { id: L2, name: "Two", parentId: null, childrenIds: [], treeId: T1, rank: 1 },
      [M1]: { id: M1, name: "M one", parentId: null, childrenIds: [], treeId: T2, rank: 0 },
      [M2]: { id: M2, name: "M two", parentId: null, childrenIds: [], treeId: T2, rank: 1 },
    },
    selectedTreeId: T1,
    selectedBacklogIds: selectedLists,
    selectedWorkItemIds: selectedItems,
    expandedWorkItems: new Set<string>(),
    expandedBacklogs: new Set<string>(),
    undoStack: [],
    redoStack: [],
  } as never);
}

/** The store actions a drop can reach; each is wrapped to note its call and then run. */
const WATCHED = [
  "runBulk",
  "setWorkItemStatus",
  "moveWorkItemsToBacklog",
  "moveWorkItemToBacklog",
  "removeWorkItemFromTree",
  "reparentWorkItem",
  "reorderWorkItemAmongSiblings",
  "reorderWorkItemInBoard",
  "moveBacklog",
  "reorderBacklogAmongSiblings",
  "reorderBacklogTree",
] as const;
let calls: Array<[string, ...unknown[]]> = [];

/** The store's own actions, kept before any test wraps them. */
const ORIGINAL = Object.fromEntries(
  WATCHED.map((name) => [name, (useAppStore.getState() as unknown as Record<string, (...a: unknown[]) => unknown>)[name]]),
);

function watchStore() {
  const wrapped: Record<string, unknown> = {};
  for (const name of WATCHED) {
    const real = ORIGINAL[name];
    wrapped[name] = (...args: unknown[]) => {
      calls.push([name, ...args.filter((a) => typeof a !== "function")]);
      return real(...args);
    };
  }
  useAppStore.setState(wrapped as never);
}

function settings() {
  useOrgSettingsStore.setState({
    settings: {
      [ORG]: {
        timeLoggingEnabled: false, pointsEnabled: false, labelsEnabled: false, customStatusesEnabled: false,
        savingsIncomeEnabled: false, boardsEnabled: true, burnupsEnabled: false, persistNotificationsEnabled: false,
        publicLinksEnabled: false, ratingsEnabled: false, deadlinesEnabled: false, createdDatesEnabled: false,
        startEndDatesEnabled: false, scramblingEnabled: false,
      },
    },
  } as never);
}

beforeEach(() => {
  useOrgStore.setState({
    activeOrgId: ORG,
    memberships: [{ organization_id: ORG, organization_name: "Acme", organization_slug: "acme", role: "owner" }],
  } as never);
  settings();
  for (const l of [L1, L1A, L2, M1, M2]) useListSortStore.getState().setMode(l, "rank");
  useRerankGuardStore.setState({ pending: null });
  toasts.length = 0;
  calls = [];
  dnd.onDragEnd = null;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Data = Record<string, unknown>;
const workitem = (workItemId: string, selectedIds?: string[], treeId = T1): Data => ({
  type: "workitem",
  workItemId,
  treeId,
  ...(selectedIds ? { selectedIds } : {}),
});

/** What the app looks like now. */
function snapshot() {
  const s = useAppStore.getState();
  const prompt = screen.queryByTestId("cross-tree-prompt");
  const pending = useRerankGuardStore.getState().pending;
  return {
    calls: [...calls],
    toasts: [...toasts],
    crossTreePrompt: prompt
      ? {
          title: screen.getByTestId("prompt-title").textContent,
          options: [...prompt.querySelectorAll("button[data-description]")].map((b) => ({
            label: b.textContent,
            description: b.getAttribute("data-description"),
            isDefault: b.getAttribute("data-default") === "true",
          })),
        }
      : null,
    rerankQuestion: pending ? { treeId: pending.treeId, backlogId: pending.backlogId, backlogIds: pending.backlogIds } : null,
    undoSteps: s.undoStack.length,
    items: Object.fromEntries(
      Object.values(s.workItems)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((w) => [
          w.id,
          {
            status: w.status,
            parentId: w.parentId,
            childrenIds: w.childrenIds,
            backlogAssignments: w.backlogAssignments,
            ranks: w.ranks,
            ...(w.parentIds && Object.keys(w.parentIds).length ? { parentIds: w.parentIds } : {}),
          },
        ]),
    ),
    lists: Object.fromEntries(
      Object.values(s.backlogs)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((b) => [b.id, { parentId: b.parentId, childrenIds: b.childrenIds, treeId: b.treeId, rank: b.rank }]),
    ),
    trees: Object.fromEntries(
      Object.values(s.backlogTrees)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((t) => [t.id, { rootBacklogIds: t.rootBacklogIds, rank: t.rank }]),
    ),
  };
}

type Case = {
  name: string;
  active: Data;
  over: Data | null;
  selectedItems?: string[];
  selectedLists?: string[];
  before?: () => void;
  /** After the drop: a button to press in the cross-tree question, or answering the re-rank question. */
  then?: "move" | "add" | "cancel" | "confirm-rerank" | "cancel-rerank";
};

const workitemReorder = (over: Data): Data => ({ type: "workitem-reorder", treeId: T1, backlogIds: [L1, L1A], ...over });

const CASES: Case[] = [
  // Nothing to drop onto, or nothing this handler answers.
  { name: "no drop target", active: workitem("B", ["B"]), over: null },
  { name: "an item onto a tree slot does nothing", active: workitem("B", ["B"]), over: { type: "tree-reorder", index: 0 } },
  { name: "a list onto an item does nothing", active: { type: "backlog-node", backlogId: L2, treeId: T1 }, over: { type: "workitem-parent", workItemId: "B", treeId: T1, backlogId: L1 } },
  { name: "a drop with no drag data does nothing", active: {}, over: { type: "backlog", backlogId: L2, treeId: T1 } },

  // Board columns.
  { name: "board column: one card to done", active: workitem("B", ["B"]), over: { type: "board-column", statusKey: "done", treeId: T1, backlogIds: [L1, L1A] } },
  { name: "board column: two cards, one already in that status", active: workitem("B", ["B", "C"]), over: { type: "board-column", statusKey: "in_progress", treeId: T1, backlogIds: [L1, L1A] } },
  { name: "board column: no lists given, status only", active: workitem("B", ["B"]), over: { type: "board-column", statusKey: "blocked", treeId: T1 } },
  { name: "board column: an id no longer there is skipped", active: workitem("B", ["gone", "B"]), over: { type: "board-column", statusKey: "done", treeId: T1, backlogIds: [L1] } },
  { name: "board column: without selectedIds, the dragged item", active: workitem("C"), over: { type: "board-column", statusKey: "pending", treeId: T1, backlogIds: [L1, L1A] } },

  // Onto a list.
  { name: "list, same tree: one item", active: workitem("B", ["B"]), over: { type: "backlog", backlogId: L2, treeId: T1 } },
  { name: "list, same tree: two items into a sub-list", active: workitem("B", ["B", "C"]), over: { type: "backlog", backlogId: L1A, treeId: T1 } },
  { name: "list, same tree: an item with a child", active: workitem("A", ["A"]), over: { type: "backlog", backlogId: L2, treeId: T1 } },
  { name: "list, other tree: asks", active: workitem("B", ["B"]), over: { type: "backlog", backlogId: M2, treeId: T2 } },
  { name: "list, other tree: asks, answered Move", active: workitem("B", ["B"]), over: { type: "backlog", backlogId: M2, treeId: T2 }, then: "move" },
  { name: "list, other tree: asks, answered Mirror", active: workitem("B", ["B"]), over: { type: "backlog", backlogId: M2, treeId: T2 }, then: "add" },
  { name: "list, other tree: asks, cancelled", active: workitem("B", ["B"]), over: { type: "backlog", backlogId: M2, treeId: T2 }, then: "cancel" },
  { name: "list, other tree: an item with a child counts both", active: workitem("A", ["A", "C"]), over: { type: "backlog", backlogId: M1, treeId: T2 }, then: "move" },
  { name: "list, other tree: already there leaves this tree, no question", active: workitem("E", ["E"]), over: { type: "backlog", backlogId: M2, treeId: T2 } },
  { name: "list, other tree: one already there, one asked about", active: workitem("E", ["E", "B"]), over: { type: "backlog", backlogId: M1, treeId: T2 }, then: "add" },

  // Onto an item: becomes its child.
  { name: "onto an item: one", active: workitem("B", ["B"]), over: { type: "workitem-parent", workItemId: "C", treeId: T1, backlogId: L1 } },
  { name: "onto an item: two", active: workitem("B", ["B", "D"]), over: { type: "workitem-parent", workItemId: "C", treeId: T1, backlogId: L1 } },
  { name: "onto an item: the target itself is left out", active: workitem("B", ["B", "C"]), over: { type: "workitem-parent", workItemId: "C", treeId: T1, backlogId: L1 } },
  { name: "onto itself: nothing, no toast", active: workitem("C", ["C"]), over: { type: "workitem-parent", workItemId: "C", treeId: T1, backlogId: L1 } },
  { name: "onto an item in a sub-list", active: workitem("B", ["B"]), over: { type: "workitem-parent", workItemId: "D", treeId: T1, backlogId: L1A } },

  // Onto the root zone.
  { name: "to the root: one", active: workitem("A1", ["A1"]), over: { type: "workitem-root", treeId: T1, backlogId: L1 } },
  { name: "to the root: two", active: workitem("A1", ["A1", "B"]), over: { type: "workitem-root", treeId: T1, backlogId: L1 } },

  // Board reorder slots.
  { name: "board slot: to the top of a column", active: workitem("C", ["C"]), over: { type: "workitem-board-reorder", index: 0, treeId: T1, backlogIds: [L1, L1A], parentId: null, statusKey: "not_started" } },
  { name: "board slot: second in a column", active: workitem("A", ["A"]), over: { type: "workitem-board-reorder", index: 1, treeId: T1, backlogIds: [L1, L1A], parentId: null, statusKey: "not_started" } },
  { name: "board slot: the first of two selected", active: workitem("B", ["E", "B"]), over: { type: "workitem-board-reorder", index: 0, treeId: T1, backlogIds: [L1, L1A], parentId: null, statusKey: "in_progress" } },
  { name: "board slot: an empty selection does nothing", active: workitem("B", []), over: { type: "workitem-board-reorder", index: 0, treeId: T1, backlogIds: [L1], parentId: null, statusKey: "done" } },

  // List reorder slots.
  { name: "list slot with a status: the board's way", active: workitem("C", ["C"]), over: workitemReorder({ index: 0, parentId: null, statusKey: "not_started" }) },
  { name: "list slot: to the top", active: workitem("C", ["C"]), over: workitemReorder({ index: 0, parentId: null }) },
  { name: "list slot: to the bottom", active: workitem("A", ["A"]), over: workitemReorder({ index: 99, parentId: null }) },
  { name: "list slot: two to the top", active: workitem("C", ["C", "E"]), over: workitemReorder({ index: 0, parentId: null }) },
  { name: "list slot: under another item", active: workitem("B", ["B"]), over: workitemReorder({ index: 0, parentId: "A" }) },
  { name: "list slot: two under another item", active: workitem("B", ["B", "C"]), over: workitemReorder({ index: 1, parentId: "A" }) },
  { name: "list slot: a child to the top level", active: workitem("A1", ["A1"]), over: workitemReorder({ index: 1, parentId: null }) },
  { name: "list slot: two children to the top level", active: workitem("A1", ["A1", "D"]), over: workitemReorder({ index: 0, parentId: null, backlogId: L1 }) },
  { name: "list slot: among the children, no move", active: workitem("A1", ["A1"]), over: workitemReorder({ index: 0, parentId: "A" }) },
  { name: "list slot in a sub-list's rows: moves the item there", active: workitem("B", ["B"]), over: workitemReorder({ index: 0, parentId: null, backlogId: L1A }) },
  { name: "list slot in its own list's rows: no list move", active: workitem("C", ["C"]), over: workitemReorder({ index: 0, parentId: null, backlogId: L1 }) },
  { name: "list slot under an item of a sub-list", active: workitem("B", ["B"]), over: workitemReorder({ index: 0, parentId: "D", backlogId: L1A }) },
  { name: "list slot: an id no longer there is skipped", active: workitem("C", ["gone", "C"]), over: workitemReorder({ index: 0, parentId: null }) },
  {
    name: "list slot, sorted by name: asks first",
    active: workitem("C", ["C"]),
    over: workitemReorder({ index: 0, parentId: null }),
    before: () => useListSortStore.getState().setMode(L1, "name-asc"),
  },
  {
    name: "list slot, sorted by name: asks, answered yes",
    active: workitem("C", ["C"]),
    over: workitemReorder({ index: 0, parentId: null }),
    before: () => useListSortStore.getState().setMode(L1, "name-desc"),
    then: "confirm-rerank",
  },
  {
    name: "list slot, sorted by name: asks, cancelled",
    active: workitem("C", ["C"]),
    over: workitemReorder({ index: 0, parentId: null }),
    before: () => useListSortStore.getState().setMode(L1, "name-desc"),
    then: "cancel-rerank",
  },
  {
    name: "list slot, sorted by name: among children, no question",
    active: workitem("B", ["B"]),
    over: workitemReorder({ index: 0, parentId: "A" }),
    before: () => useListSortStore.getState().setMode(L1, "name-desc"),
  },
  {
    name: "list slot, sorted, the sub-list in view decides",
    active: workitem("D", ["D"]),
    over: { type: "workitem-reorder", treeId: T1, backlogIds: [L1A], index: 0, parentId: null },
    selectedLists: [L1A],
    before: () => useListSortStore.getState().setMode(L1, "name-desc"),
  },

  // Lists in the tree panel.
  { name: "list onto a list slot: to the top", active: { type: "backlog-node", backlogId: L2, treeId: T1 }, over: { type: "backlog-reorder", index: 0, parentId: null, treeId: T1 } },
  { name: "list onto a list slot: under another list", active: { type: "backlog-node", backlogId: L2, treeId: T1 }, over: { type: "backlog-reorder", index: 0, parentId: L1, treeId: T1 } },
  { name: "list onto a list slot: out to the top level", active: { type: "backlog-node", backlogId: L1A, treeId: T1 }, over: { type: "backlog-reorder", index: 2, parentId: null, treeId: T1 } },
  { name: "list onto a list slot: the selection goes together", active: { type: "backlog-node", backlogId: L2, treeId: T1 }, over: { type: "backlog-reorder", index: 0, parentId: null, treeId: T1 }, selectedLists: [L1A, L2] },
  { name: "list onto a list slot: in the other tree", active: { type: "backlog-node", backlogId: L2, treeId: T1 }, over: { type: "backlog-reorder", index: 1, parentId: null, treeId: T2 } },
  { name: "list onto a list", active: { type: "backlog-node", backlogId: L2, treeId: T1 }, over: { type: "backlog", backlogId: L1, treeId: T1 } },
  { name: "list onto a list: the selection goes together", active: { type: "backlog-node", backlogId: L2, treeId: T1 }, over: { type: "backlog", backlogId: M1, treeId: T2 }, selectedLists: [L2, L1A] },
  { name: "list onto itself", active: { type: "backlog-node", backlogId: L2, treeId: T1 }, over: { type: "backlog", backlogId: L2, treeId: T1 } },

  // Trees.
  { name: "tree onto a tree slot: to the top", active: { type: "tree-node", treeId: T2 }, over: { type: "tree-reorder", index: 0 } },
  { name: "tree onto a tree slot: to the bottom", active: { type: "tree-node", treeId: T1 }, over: { type: "tree-reorder", index: 2 } },
  { name: "tree onto a list does nothing", active: { type: "tree-node", treeId: T2 }, over: { type: "backlog", backlogId: L1, treeId: T1 } },
];

describe("dropping on AppLayout", () => {
  it.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    // A drag start selects what is dragged (AppLayout's handleDragStart), so
    // by the drop the selection is the dragged items unless a case says otherwise.
    const dragged = c.active.type === "workitem" ? ((c.active.selectedIds as string[]) ?? [c.active.workItemId as string]) : [];
    seed(c.selectedItems ?? dragged.filter((id) => id !== "gone"), c.selectedLists ?? [L1]);
    c.before?.();
    watchStore();
    render(<AppLayout />);
    expect(dnd.onDragEnd).toBeTypeOf("function");
    await act(async () => {
      dnd.onDragEnd!({
        active: { id: "dragged", data: { current: c.active } },
        over: c.over ? { id: "target", data: { current: c.over } } : null,
        collisions: null,
        delta: { x: 0, y: 0 },
        activatorEvent: null,
      });
      await new Promise((r) => setTimeout(r, 0));
    });
    const afterDrop = snapshot();
    if (!c.then) {
      expect(afterDrop).toMatchSnapshot();
      return;
    }
    calls = [];
    toasts.length = 0;
    await act(async () => {
      if (c.then === "confirm-rerank") useRerankGuardStore.getState().confirm();
      else if (c.then === "cancel-rerank") useRerankGuardStore.getState().cancel();
      else fireEvent.click(screen.getByTestId(`prompt-${c.then}`));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect({ afterDrop, afterAnswer: snapshot() }).toMatchSnapshot();
  });
});
