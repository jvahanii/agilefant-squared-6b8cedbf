/**
 * A new account starts with one tree, two lists and no items, and the list
 * panel asks for a first item instead of "Select a list to view work items"
 * (2026-11-16: 15 of 34 new users never changed anything).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
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
import { firstList } from "@/components/listPanel/firstList";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { starterContent } from "@/store/starterContent";
import { scopeMockDataToOrganization } from "@/store/sync/writes";
import type { WorkItem } from "@/types/models";

const ORG = "org";
const starter = scopeMockDataToOrganization(ORG, structuredClone(starterContent));
const TREE = Object.keys(starter.backlogTrees)[0];
const [NOW, LATER] = starter.backlogTrees[TREE].rootBacklogIds;

function seed(state: Record<string, unknown> = {}) {
  useOrgStore.setState({ activeOrgId: ORG });
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
    <TooltipProvider>
      <WorkItemTreePanel />
    </TooltipProvider>,
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
