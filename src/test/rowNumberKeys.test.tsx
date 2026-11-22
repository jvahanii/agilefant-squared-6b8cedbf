/**
 * A row's number, typed, selects it: the number the row shows, in the list
 * that shows numbers, and without setting off the shortcuts beside it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "range", "limit", "gte", "upsert", "insert", "update", "delete", "maybeSingle", "single"]) {
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

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-toast")>()),
  toast,
}));

import { WorkItemTreePanel } from "@/components/WorkItemTreePanel";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useSnoozeStore } from "@/store/snoozeStore";
import type { WorkItem } from "@/types/models";

const ORG = "org";
const TREE = "org::tree-1";
const LIST = "org::bl-1";
const OTHER = "org::bl-2";

const item = (id: string, rank: number, extra: Partial<WorkItem> = {}): WorkItem =>
  ({
    id,
    title: id,
    status: "not_started",
    parentId: null,
    childrenIds: [],
    backlogAssignments: { [TREE]: LIST },
    ranks: { [LIST]: rank },
    boardRanks: {},
    organizationId: ORG,
    ...extra,
  }) as WorkItem;

/** R1 … R25, top to bottom. */
const rows = () => Array.from({ length: 25 }, (_, i) => item(`R${i + 1}`, i));

function show(items: WorkItem[] = rows(), expanded: string[] = [], viewMode = "list") {
  const list = (id: string) => ({ id, name: id, parentId: null, childrenIds: [], treeId: TREE, rank: 0, viewMode });
  useOrgStore.setState({ activeOrgId: ORG });
  useAppStore.setState({
    organizationId: ORG,
    workItems: Object.fromEntries(items.map((i) => [i.id, i])),
    backlogs: { [LIST]: list(LIST), [OTHER]: list(OTHER) },
    backlogTrees: { [TREE]: { id: TREE, name: "Work", rootBacklogIds: [LIST, OTHER], rank: 0 } },
    selectedTreeId: TREE,
    selectedBacklogIds: [LIST],
    selectedWorkItemIds: [],
    expandedWorkItems: new Set(expanded),
    searchQuery: "",
    isLoading: false,
    loadingProgress: 100,
  } as never);
  return render(
    <TooltipProvider>
      <WorkItemTreePanel />
    </TooltipProvider>,
  );
}

function press(key: string, init: KeyboardEventInit = {}, target: HTMLElement = document.body) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(e));
  return e;
}
const type = (digits: string) => {
  for (const digit of digits) press(digit);
};
const selected = () => useAppStore.getState().selectedWorkItemIds;

/** What reaches the global shortcuts. */
let passedOn: string[] = [];
const listen = (e: KeyboardEvent) => void passedOn.push(e.key);
let now = 0;

beforeEach(() => {
  now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  useSnoozeStore.setState({ snoozes: {} } as never);
  useOrgSettingsStore.setState({ settings: { [ORG]: { boardsEnabled: true } } } as never);
  toast.mockClear();
  passedOn = [];
  window.addEventListener("keydown", listen);
});

afterEach(() => {
  window.removeEventListener("keydown", listen);
  vi.restoreAllMocks();
});

describe("typing a row's number", () => {
  it("selects the row at once, and follows further digits", () => {
    show();
    type("1");
    expect(selected()).toEqual(["R1"]);
    type("2");
    expect(selected()).toEqual(["R12"]);
  });

  it("takes 0 within a number, but not to start one", () => {
    show();
    expect(press("0").defaultPrevented).toBe(false);
    expect(selected()).toEqual([]);
    type("20");
    expect(selected()).toEqual(["R20"]);
  });

  it("replaces a selection of several", () => {
    show();
    act(() => void useAppStore.setState({ selectedWorkItemIds: ["R4", "R5"] }));
    type("7");
    expect(selected()).toEqual(["R7"]);
  });

  it("starts a new number after a pause", () => {
    show();
    type("1");
    now += 1600;
    type("2");
    expect(selected()).toEqual(["R2"]);
  });

  it("starts a new number after another key", () => {
    show();
    type("1");
    press("d");
    type("2");
    expect(selected()).toEqual(["R2"]);
  });

  it("starts a new number after a click", () => {
    show();
    type("1");
    act(() => void document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    type("2");
    expect(selected()).toEqual(["R2"]);
  });

  it("starts a new number in another list", () => {
    show([...rows(), item("X1", 0, { backlogAssignments: { [TREE]: OTHER }, ranks: { [OTHER]: 0 } })]);
    type("2");
    act(() => useAppStore.getState().selectBacklog(OTHER, TREE));
    type("1");
    expect(selected()).toEqual(["X1"]);
  });

  it("takes digits typed with Shift, and the numeric keypad's", () => {
    show();
    press("Shift");
    press("1", { shiftKey: true });
    press("Shift");
    press("4", { code: "Numpad4" });
    expect(selected()).toEqual(["R14"]);
  });

  it("counts a key held down as one digit", () => {
    show();
    type("2");
    press("2", { repeat: true });
    expect(selected()).toEqual(["R2"]);
  });

  it("selects nothing for a number no row has, and says so", () => {
    show();
    type("26");
    expect(selected()).toEqual([]);
    expect(toast).toHaveBeenCalledWith({ title: "No row 26" });
  });

  it("corrects the number with Backspace, which then deletes nothing", () => {
    show();
    type("26");
    press("Backspace");
    expect(selected()).toEqual(["R2"]);
    press("Backspace");
    expect(selected()).toEqual([]);
    press("Backspace");
    expect(passedOn).not.toContain("Backspace");
  });

  it("leaves Backspace to delete once the number is done", () => {
    show();
    type("3");
    now += 1600;
    press("Backspace");
    expect(passedOn).toContain("Backspace");
  });

  it("goes by the numbers shown: open branches count, snoozed items do not", () => {
    useSnoozeStore.setState({
      snoozes: { s: { workItemId: "A1", snoozedUntil: new Date(now + 86_400_000).toISOString() } },
    } as never);
    show(
      [item("A", 0, { childrenIds: ["A1", "A2"] }), item("A1", 0, { parentId: "A" }), item("A2", 1, { parentId: "A" }), item("B", 1)],
      ["A"],
    );
    type("2");
    expect(selected()).toEqual(["A2"]);
    now += 1600;
    type("3");
    expect(selected()).toEqual(["B"]);
  });

  it("leaves digits typed into a field, a select or editable text", () => {
    show();
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    for (const el of [document.createElement("input"), document.createElement("textarea"), document.createElement("select"), editable]) {
      document.body.appendChild(el);
      expect(press("3", {}, el).defaultPrevented, el.tagName).toBe(false);
      el.remove();
    }
    expect(selected()).toEqual([]);
  });

  it("leaves digits to an open dialog or menu", () => {
    show();
    for (const role of ["dialog", "alertdialog", "menu"]) {
      const overlay = document.createElement("div");
      overlay.setAttribute("role", role);
      document.body.appendChild(overlay);
      press("3");
      overlay.remove();
    }
    expect(selected()).toEqual([]);
  });

  it("leaves digits with Ctrl, Alt or Cmd to the browser", () => {
    show();
    for (const held of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(press("3", held).defaultPrevented).toBe(false);
    }
    expect(selected()).toEqual([]);
  });

  it("does nothing behind search results, which number their own rows", () => {
    show();
    act(() => useAppStore.getState().setSearchQuery("R2"));
    type("3");
    expect(selected()).toEqual([]);
  });

  it("does nothing on the board, which shows no numbers", () => {
    show(rows(), [], "board");
    type("3");
    expect(selected()).toEqual([]);
  });
});
