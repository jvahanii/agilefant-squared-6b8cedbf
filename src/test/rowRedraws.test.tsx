/**
 * Selecting a row draws again only the rows whose selection changed — not
 * every row in the list, as it did while the list handed its rows a new
 * shared-data object each time it drew.
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";

vi.mock("@/integrations/supabase/client", () => {
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "is", "order", "range", "limit", "gte", "upsert", "insert", "update", "delete", "maybeSingle", "single"]) {
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

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count, getItemKey = (i) => i }: { count: number; getItemKey?: (i: number) => string | number }) => ({
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: getItemKey(index), start: index * 32, size: 32 })),
    getTotalSize: () => count * 32,
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));
Element.prototype.scrollIntoView ??= () => {};

// Count each row's drawing by the part after its name, which every row draws.
const drawn = new Map<string, number>();
vi.mock("@/components/workItemRow/RowBadges", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/workItemRow/RowBadges")>();
  return {
    ...actual,
    RowBadges: (props: Parameters<typeof actual.RowBadges>[0]) => {
      drawn.set(props.item.id, (drawn.get(props.item.id) ?? 0) + 1);
      return actual.RowBadges(props);
    },
  };
});

import { WorkItemTreePanel } from "@/components/WorkItemTreePanel";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import type { WorkItem } from "@/types/models";

const ORG = "org";
const TREE = "org::tree-1";
const LIST = "org::bl-1";
const IDS = ["A", "B", "C", "D", "E", "F"];

describe("selecting a row", () => {
  it("draws again only the rows it selects and unselects", async () => {
    useOrgStore.setState({ activeOrgId: ORG });
    useAppStore.setState({
      organizationId: ORG,
      workItems: Object.fromEntries(
        IDS.map((id, rank) => [
          id,
          { id, title: id, status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { [TREE]: LIST }, ranks: { [LIST]: rank }, boardRanks: {}, organizationId: ORG } as WorkItem,
        ]),
      ),
      backlogs: { [LIST]: { id: LIST, name: "List", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } as never },
      backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [LIST], rank: 0 } as never },
      selectedTreeId: TREE,
      selectedBacklogIds: [LIST],
      selectedWorkItemIds: ["A"],
      expandedWorkItems: new Set(),
      searchQuery: "",
      isLoading: false,
      loadingProgress: 100,
    } as never);
    render(
      <TooltipProvider>
        <WorkItemTreePanel />
      </TooltipProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    drawn.clear();
    fireEvent.click(document.querySelector('[data-work-item-id="C"]')!);
    expect(useAppStore.getState().selectedWorkItemIds).toEqual(["C"]);
    expect([...drawn.keys()].sort()).toEqual(["A", "C"]);
  });
});
