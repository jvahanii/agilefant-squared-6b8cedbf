/**
 * With a list selected and no item, part of a list's name, typed, selects the
 * list — without setting off the shortcuts that share its letters.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/use-toast")>()),
  toast,
}));

import { useListNameKeys } from "@/hooks/useListNameKeys";
import { useRowNumberKeys } from "@/components/listPanel/useListKeys";
import { useAppStore } from "@/store/appStore";

const T1 = "org::t1";
const T2 = "org::t2";

const list = (id: string, name: string, treeId: string, parentId: string | null = null, childrenIds: string[] = []) => ({
  id,
  name,
  parentId,
  childrenIds,
  treeId,
  rank: 0,
  viewMode: "list",
});

function setup(selected = "inbox") {
  useAppStore.setState({
    organizationId: "org",
    workItems: {},
    backlogs: Object.fromEntries(
      [
        list("inbox", "Inbox", T1),
        list("ops", "Ops backlog", T1),
        list("roadmap", "Roadmap", T1, null, ["sprint1", "sprint12"]),
        list("sprint1", "Sprint 1", T1, "roadmap"),
        list("sprint12", "Sprint 12", T1, "roadmap"),
        list("misc", "Misprints", T2),
        list("ideas", ":lightbulb: Ideas", T2),
      ].map((l) => [l.id, l]),
    ),
    backlogTrees: {
      [T1]: { id: T1, name: "Work", rootBacklogIds: ["inbox", "ops", "roadmap"], rank: 0 },
      [T2]: { id: T2, name: "Other", rootBacklogIds: ["misc", "ideas"], rank: 1 },
    },
    selectedTreeId: T1,
    selectedBacklogIds: [selected],
    selectedWorkItemIds: [],
    expandedBacklogs: new Set<string>(),
  } as never);
  return renderHook(() => useListNameKeys());
}

function press(key: string, init: KeyboardEventInit = {}, target: HTMLElement = document.body) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(e));
  return e;
}
const type = (text: string) => {
  for (const ch of text) press(ch);
};
const selectedList = () => useAppStore.getState().selectedBacklogIds;

/** What reaches the global shortcuts. */
let passedOn: string[] = [];
const listen = (e: KeyboardEvent) => void passedOn.push(e.key);
let now = 0;

beforeEach(() => {
  now = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  toast.mockClear();
  passedOn = [];
  window.addEventListener("keydown", listen);
});

afterEach(() => {
  window.removeEventListener("keydown", listen);
  vi.restoreAllMocks();
});

describe("typing a list's name", () => {
  it("selects the list at each letter, and keeps the shortcuts out of it", () => {
    setup();
    type("ro");
    expect(selectedList()).toEqual(["roadmap"]);
    expect(passedOn).toEqual([]);
  });

  it("finds a part of the name, a word's start before the middle of one", () => {
    setup();
    type("print");
    expect(selectedList()).toEqual(["sprint1"]);
    now += 2000;
    type("backlog");
    expect(selectedList()).toEqual(["ops"]);
  });

  it("prefers a name that starts with it, wherever it is in the tree", () => {
    setup();
    type("mis");
    expect(selectedList()).toEqual(["misc"]);
    expect(useAppStore.getState().selectedTreeId).toBe(T2);
  });

  it("takes digits and spaces within a name, ahead of the row numbers", () => {
    setup();
    const select = vi.fn();
    renderHook(() => useRowNumberKeys(new Map([["R1", 1], ["R2", 2]]), "inbox", select));
    type("sprint 12");
    expect(selectedList()).toEqual(["sprint12"]);
    expect(select).not.toHaveBeenCalled();
  });

  it("opens the folded branch of the list it selects", () => {
    setup();
    type("sprint");
    expect(useAppStore.getState().expandedBacklogs.has("roadmap")).toBe(true);
  });

  it("matches the name as shown, not its icon codes", () => {
    setup();
    type("lightbulb");
    expect(selectedList()).not.toEqual(["ideas"]);
    expect(toast).toHaveBeenCalledWith({ title: 'No list matches "li"' });
    now += 2000;
    type("idea");
    expect(selectedList()).toEqual(["ideas"]);
  });

  it("starts a name with O or U too, which then move no list", () => {
    setup();
    type("op");
    expect(selectedList()).toEqual(["ops"]);
    now += 2000;
    type("u");
    expect(passedOn).toEqual([]);
    expect(useAppStore.getState().backlogTrees[T1].rootBacklogIds).toEqual(["inbox", "ops", "roadmap"]);
  });

  it("leaves Shift+L to the logged time, but takes capitals", () => {
    setup();
    press("L", { shiftKey: true });
    expect(passedOn).toEqual(["L"]);
    passedOn = [];
    press("Shift");
    press("R", { shiftKey: true });
    expect(selectedList()).toEqual(["roadmap"]);
    expect(passedOn).toEqual(["Shift"]);
  });

  it("keeps the selection when nothing matches, and says so once", () => {
    setup();
    type("roq");
    expect(selectedList()).toEqual(["roadmap"]);
    type("qq");
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith({ title: 'No list matches "roq"' });
  });

  it("corrects with Backspace, back to the list it started from, and deletes nothing", () => {
    setup("ops");
    type("sx");
    press("Backspace");
    expect(selectedList()).toEqual(["sprint1"]);
    press("Backspace");
    expect(selectedList()).toEqual(["ops"]);
    press("Backspace");
    expect(passedOn).toEqual([]);
  });

  it("leaves Backspace to delete once the name is done", () => {
    setup();
    type("ro");
    now += 2000;
    press("Backspace");
    expect(passedOn).toEqual(["Backspace"]);
  });

  it("starts a new name after a pause, another key or a click", () => {
    setup();
    type("sp");
    now += 2000;
    type("in");
    expect(selectedList()).toEqual(["inbox"]);
    press("ArrowDown");
    type("ro");
    expect(selectedList()).toEqual(["roadmap"]);
    act(() => void document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    type("in");
    expect(selectedList()).toEqual(["inbox"]);
  });

  it("does nothing with an item selected, whose letters are its shortcuts", () => {
    setup();
    act(() => void useAppStore.setState({ selectedWorkItemIds: ["W1"] }));
    type("ro");
    expect(selectedList()).toEqual(["inbox"]);
    expect(passedOn).toEqual(["r", "o"]);
  });

  it("does nothing with no list selected", () => {
    setup();
    act(() => void useAppStore.setState({ selectedBacklogIds: [] }));
    type("ro");
    expect(selectedList()).toEqual([]);
  });

  it("leaves letters typed into a field, a dialog, or with Ctrl, Alt or Cmd", () => {
    setup();
    const input = document.createElement("input");
    document.body.appendChild(input);
    expect(press("r", {}, input).defaultPrevented).toBe(false);
    input.remove();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    press("r");
    dialog.remove();
    for (const held of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      expect(press("r", held).defaultPrevented).toBe(false);
    }
    expect(selectedList()).toEqual(["inbox"]);
  });

  it("does not start a name with a digit, which is a row's number", () => {
    setup();
    expect(press("1").defaultPrevented).toBe(false);
    expect(passedOn).toEqual(["1"]);
  });
});
