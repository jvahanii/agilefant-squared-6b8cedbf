/**
 * Renaming an item from the timeline, and which rows Tab goes by there.
 *
 * Double-clicking a name on the timeline edits it in place, as in the list.
 * Pinned here: that the new name is saved on Enter and on leaving the field,
 * that Escape and an empty name change nothing, that a scrambled name is left
 * alone and says why — and that reparenting with Tab is judged against the
 * rows the timeline shows, not the list's.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }));

import { TimelineView } from "@/components/TimelineView";
import { rowsForReparenting } from "@/lib/workItemRows";
import { useAppStore } from "@/store/appStore";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import type { WorkItem } from "@/types/models";

const ORG = "test-org";
const TREE = `${ORG}::bt-1`;
const BL = `${ORG}::bl-1`;
const item = (id: string, title: string, over: Partial<WorkItem> = {}): WorkItem => ({
  id,
  title,
  status: "not_started",
  parentId: null,
  childrenIds: [],
  backlogAssignments: { [TREE]: BL },
  ranks: { [BL]: 0 },
  startedOn: "2026-10-01",
  endedOn: "2026-10-05",
  ...over,
});

const show = (isScrambled = false) =>
  render(<TimelineView treeId={TREE} rootIds={["a", "b"]} backlogIds={new Set([BL])} isScrambled={isScrambled} />);
const nameCell = (id: string) => document.querySelector(`[data-timeline-row="${id}"] > div`) as HTMLElement;
const title = (id: string) => useAppStore.getState().workItems[id].title;
const field = () => screen.queryByRole("textbox") as HTMLInputElement | null;

beforeEach(() => {
  toast.mockReset();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 9, 12));
  useScrambledItemsStore.setState({ byItem: new Map() });
  useAppStore.setState({
    organizationId: ORG,
    backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [BL], rank: 0 } },
    backlogs: { [BL]: { id: BL, name: "Work", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
    workItems: { a: item("a", "Write the offer"), b: item("b", "Call the client") },
    selectedWorkItemIds: [],
    undoStack: [],
    redoStack: [],
  });
  return () => vi.useRealTimers();
});

describe("renaming on the timeline", () => {
  it("opens the name for editing on a double-click, with the name in it", () => {
    show();
    expect(field()).toBeNull();
    fireEvent.doubleClick(nameCell("a"));
    expect(field()).toHaveValue("Write the offer");
    expect(field()).toHaveFocus();
  });

  it("saves the new name on Enter", () => {
    show();
    fireEvent.doubleClick(nameCell("a"));
    fireEvent.change(field()!, { target: { value: "  Send the offer " } });
    fireEvent.keyDown(field()!, { key: "Enter" });
    expect(title("a")).toBe("Send the offer");
    expect(field()).toBeNull();
    expect(screen.getByText("Send the offer")).toBeInTheDocument();
  });

  it("saves it on leaving the field", () => {
    show();
    fireEvent.doubleClick(nameCell("b"));
    fireEvent.change(field()!, { target: { value: "Email the client" } });
    fireEvent.blur(field()!);
    expect(title("b")).toBe("Email the client");
  });

  it("changes nothing on Escape, or for a name left empty", () => {
    show();
    fireEvent.doubleClick(nameCell("a"));
    fireEvent.change(field()!, { target: { value: "Something else" } });
    fireEvent.keyDown(field()!, { key: "Escape" });
    expect(title("a")).toBe("Write the offer");
    expect(field()).toBeNull();

    fireEvent.doubleClick(nameCell("a"));
    fireEvent.change(field()!, { target: { value: "   " } });
    fireEvent.keyDown(field()!, { key: "Enter" });
    expect(title("a")).toBe("Write the offer");
  });

  it("keeps its dates and its bar", () => {
    show();
    fireEvent.doubleClick(nameCell("a"));
    fireEvent.change(field()!, { target: { value: "Send the offer" } });
    fireEvent.keyDown(field()!, { key: "Enter" });
    expect(useAppStore.getState().workItems.a).toMatchObject({ startedOn: "2026-10-01", endedOn: "2026-10-05" });
    expect(document.querySelector('[data-timeline-row="a"] [data-bar-kind]')).not.toBeNull();
  });

  it("does not take typing in the field for anything else", () => {
    show();
    fireEvent.doubleClick(nameCell("a"));
    // A click to place the cursor is not a click on the row.
    fireEvent.click(field()!);
    expect(useAppStore.getState().selectedWorkItemIds).toEqual([]);
    // Nor does a key typed there reach the page's shortcuts.
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    fireEvent.keyDown(field()!, { key: "Tab" });
    window.removeEventListener("keydown", onWindow);
    expect(onWindow).not.toHaveBeenCalled();
  });

  it("leaves a scrambled name alone, and says why", () => {
    useScrambledItemsStore.setState({ byItem: new Map([["a", "someone-else"]]) });
    show();
    fireEvent.doubleClick(nameCell("a"));
    expect(field()).toBeNull();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "This name is scrambled" }));
  });

  it("offers nothing to edit while names are shown scrambled", () => {
    show(true);
    fireEvent.doubleClick(nameCell("a"));
    expect(field()).toBeNull();
  });
});

describe("the rows Tab goes by", () => {
  const list = ["parent", "next"]; // "child" is folded away in the list
  const timeline = ["parent", "child", "next"]; // and open on the timeline

  it("are the timeline's while it is shown, so a row only it shows can be moved", () => {
    expect(rowsForReparenting(true, list, timeline)).toBe(timeline);
    expect(rowsForReparenting(true, list, timeline)).toContain("child");
  });

  it("are the list's otherwise", () => {
    expect(rowsForReparenting(false, list, timeline)).toBe(list);
  });
});
