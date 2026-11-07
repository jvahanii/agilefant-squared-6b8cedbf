/**
 * Tab and Shift+Tab in a list, on the panel as drawn.
 *
 * Tab puts an item under its previous sibling, at the end of that sibling's
 * children — also when the sibling is open and its children are the rows just
 * above, which used to put the item under the last of them instead. Shift+Tab
 * on a run of items keeps their order.
 */
import { describe, it, expect, vi } from "vitest";
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

import { WorkItemTreePanel } from "@/components/WorkItemTreePanel";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { getEffectiveParentId, type WorkItem } from "@/types/models";

const ORG = "org";
const TREE = "org::tree-1";
const LIST = "org::bl-1";

const item = (id: string, rank: number, parentId: string | null = null): WorkItem =>
  ({
    id,
    title: id,
    status: "not_started",
    parentId,
    childrenIds: [],
    backlogAssignments: { [TREE]: LIST },
    ranks: { [LIST]: rank },
    boardRanks: {},
    organizationId: ORG,
  }) as WorkItem;

/**
 * A
 *   A1
 *   A2
 * B
 * C
 */
function seed(selected: string[], expanded = ["A"]) {
  const items = [item("A", 0), item("A1", 0, "A"), item("A2", 1, "A"), item("B", 1), item("C", 2)];
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  for (const i of items) if (i.parentId) byId[i.parentId].childrenIds.push(i.id);
  useOrgStore.setState({ activeOrgId: ORG });
  useAppStore.setState({
    organizationId: ORG,
    workItems: byId,
    backlogs: { [LIST]: { id: LIST, name: "List", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } as never },
    backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [LIST], rank: 0 } as never },
    selectedTreeId: TREE,
    selectedBacklogIds: [LIST],
    selectedWorkItemIds: selected,
    expandedWorkItems: new Set(expanded),
    searchQuery: "",
    isLoading: false,
    loadingProgress: 100,
  } as never);
  render(
    <TooltipProvider>
      <WorkItemTreePanel />
    </TooltipProvider>,
  );
}

async function press(shift = false) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: shift, bubbles: true }));
  });
}

const parentOf = (id: string) => getEffectiveParentId(useAppStore.getState().workItems[id], TREE);
/** The children of an item (or the top, for null) in rank order. */
const childrenOf = (parent: string | null) =>
  Object.values(useAppStore.getState().workItems)
    .filter((w) => getEffectiveParentId(w, TREE) === parent)
    .sort((a, b) => a.ranks[LIST] - b.ranks[LIST])
    .map((w) => w.id);

describe("Tab", () => {
  it("puts an item under its open previous sibling, after that sibling's children", async () => {
    seed(["B"]);
    await press();
    expect(parentOf("B")).toBe("A");
    expect(childrenOf("A")).toEqual(["A1", "A2", "B"]);
  });

  it("puts a run of items under the same sibling, in order", async () => {
    seed(["B", "C"]);
    await press();
    expect(childrenOf("A")).toEqual(["A1", "A2", "B", "C"]);
  });

  it("puts an item under a closed previous sibling the same way", async () => {
    seed(["B"], []);
    await press();
    expect(childrenOf("A")).toEqual(["A1", "A2", "B"]);
  });

  it("leaves a first child where it is", async () => {
    seed(["A1"]);
    await press();
    expect(parentOf("A1")).toBe("A");
    expect(childrenOf("A")).toEqual(["A1", "A2"]);
  });
});

describe("Shift+Tab", () => {
  it("keeps the order of a run of items it brings out", async () => {
    seed(["A1", "A2"]);
    await press(true);
    expect(childrenOf(null)).toEqual(["A", "A1", "A2", "B", "C"]);
  });

  it("leaves a selected child to move with its selected parent", async () => {
    seed(["A2", "A1"]);
    useAppStore.setState((s) => {
      const w = { ...s.workItems };
      w.A2 = { ...w.A2, parentId: "A1", childrenIds: [] };
      w.A1 = { ...w.A1, childrenIds: ["A2"] };
      w.A = { ...w.A, childrenIds: ["A1"] };
      return { workItems: w, expandedWorkItems: new Set(["A", "A1"]) } as never;
    });
    await press(true);
    expect(parentOf("A1")).toBeNull();
    expect(parentOf("A2")).toBe("A1");
  });
});
