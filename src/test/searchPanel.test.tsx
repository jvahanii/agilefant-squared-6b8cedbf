/**
 * The search box over the items: ranked results, the arrow keys and Enter,
 * the commands offered while one is typed, and fifty results at a time.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, within, act } from "@testing-library/react";
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

import { WorkItemTreePanel } from "@/components/WorkItemTreePanel";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import type { WorkItem } from "@/types/models";

const ORG = "org";
const TREE = "org::tree-1";
const LIST = "org::bl-1";

const item = (id: string, title: string, extra: Partial<WorkItem> = {}): WorkItem =>
  ({
    id,
    title,
    status: "not_started",
    parentId: null,
    childrenIds: [],
    backlogAssignments: { [TREE]: LIST },
    ranks: { [LIST]: 0 },
    boardRanks: {},
    organizationId: ORG,
    ...extra,
  }) as WorkItem;

function seed(items: WorkItem[]) {
  useOrgStore.setState({ activeOrgId: ORG });
  useAppStore.setState({
    organizationId: ORG,
    workItems: Object.fromEntries(items.map((i) => [i.id, i])),
    backlogs: { [LIST]: { id: LIST, name: "Inbox", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } as never },
    backlogTrees: { [TREE]: { id: TREE, name: "Work", rootBacklogIds: [LIST], rank: 0 } as never },
    selectedTreeId: TREE,
    selectedBacklogIds: [LIST],
    searchQuery: "",
    isLoading: false,
    loadingProgress: 100,
  } as never);
}

function renderPanel() {
  render(
    <TooltipProvider>
      <WorkItemTreePanel />
    </TooltipProvider>,
  );
  return screen.getByPlaceholderText(/Filter items/);
}

/** The titles of the results, in order. */
function resultTitles() {
  const list = screen.getByRole("listbox", { name: "Search results" });
  return within(list)
    .getAllByRole("option")
    .map((row) => row.querySelector(".text-sm")?.textContent?.replace("(list)", "").trim());
}

async function type(input: HTMLElement, text: string) {
  await act(async () => {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: text } });
  });
}

beforeEach(() => {
  useAppStore.getState().setSearchQuery("");
});

describe("the search box", () => {
  it("puts the best matches first and finds words in any order, without accents", async () => {
    seed([
      item("a", "A plan for the budget"),
      item("b", "Budget plan"),
      item("c", "Budget plan for next year"),
      item("d", "Uusi työpaikka"),
    ]);
    const input = renderPanel();
    await type(input, "plan budget");
    expect(resultTitles()).toEqual(["Budget plan", "Budget plan for next year", "A plan for the budget"]);
    await type(input, "tyopaikka");
    expect(resultTitles()).toEqual(["Uusi työpaikka"]);
  });

  it("says where an item matched when it was not its name", async () => {
    seed([item("a", "Weekly sync", { description: "Agree on the roadmap" })]);
    const input = renderPanel();
    await type(input, "roadmap");
    expect(screen.getByText("In description: Agree on the roadmap")).toBeInTheDocument();
  });

  it("goes through the results with the arrow keys and opens the chosen one with Enter", async () => {
    seed([item("a", "Report one"), item("b", "Report two")]);
    const input = renderPanel();
    await type(input, "report");
    expect(resultTitles()).toEqual(["Report one", "Report two"]);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const options = within(screen.getByRole("listbox", { name: "Search results" })).getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(useAppStore.getState().searchQuery).toBe("");
    expect(useAppStore.getState().selectedWorkItemIds).toEqual(["b"]);
  });

  it("offers the commands while one is typed, and Tab completes the first", async () => {
    seed([item("a", "Late", { deadline: "2000-01-01" })]);
    const input = renderPanel();
    await type(input, "/ov");
    const commands = screen.getByRole("listbox", { name: "Search commands" });
    expect(within(commands).getByText("/overdue")).toBeInTheDocument();
    await act(async () => {
      fireEvent.keyDown(input, { key: "Tab" });
    });
    expect(useAppStore.getState().searchQuery).toBe("/overdue");
    expect(resultTitles()).toEqual(["Late"]);
  });

  it("shows fifty results at a time", async () => {
    seed(Array.from({ length: 120 }, (_, i) => item(`i${i}`, `Task ${String(i).padStart(3, "0")}`)));
    const input = renderPanel();
    await type(input, "task");
    expect(resultTitles()).toHaveLength(50);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Show more \(70 left\)/ }));
    });
    expect(resultTitles()).toHaveLength(100);
  });

  it("shows a result's stars and deadline where the organization and its list use them", async () => {
    seed([
      item("a", "Apply to Acme", { rating: 4, deadline: "2000-01-01" }),
      item("b", "Apply to Beta"),
    ]);
    useAppStore.setState((s) => ({ backlogs: { ...s.backlogs, [LIST]: { ...s.backlogs[LIST], ratingsEnabled: true } } }) as never);
    useOrgSettingsStore.setState({ settings: { [ORG]: { ratingsEnabled: true, deadlinesEnabled: true } } } as never);
    const input = renderPanel();
    await type(input, "apply");
    const [acme, beta] = within(screen.getByRole("listbox", { name: "Search results" })).getAllByRole("option");
    expect(within(acme).getByRole("img", { name: "Rated 4 of 5" })).toBeInTheDocument();
    expect(within(acme).getByTitle("Deadline 2000-01-01 — passed")).toHaveClass("text-destructive");
    // Nothing to show is shown as nothing, not as empty stars.
    expect(within(beta).queryByRole("img", { name: /Rated/ })).toBeNull();
    expect(within(beta).queryByTitle(/Deadline/)).toBeNull();
    expect(resultTitles()).toEqual(["Apply to Acme", "Apply to Beta"]);
  });

  it("does not show stars or deadlines the organization has switched off", async () => {
    seed([item("a", "Apply to Acme", { rating: 4, deadline: "2000-01-01" })]);
    useAppStore.setState((s) => ({ backlogs: { ...s.backlogs, [LIST]: { ...s.backlogs[LIST], ratingsEnabled: true } } }) as never);
    useOrgSettingsStore.setState({ settings: { [ORG]: { ratingsEnabled: false, deadlinesEnabled: false } } } as never);
    const input = renderPanel();
    await type(input, "apply");
    const [acme] = within(screen.getByRole("listbox", { name: "Search results" })).getAllByRole("option");
    expect(within(acme).queryByRole("img", { name: /Rated/ })).toBeNull();
    expect(within(acme).queryByTitle(/Deadline/)).toBeNull();
  });

  it("says why nothing was found for a command", async () => {
    seed([item("a", "Fine")]);
    const input = renderPanel();
    await type(input, "/overdue");
    expect(screen.getByText("No items are overdue")).toBeInTheDocument();
  });
});
