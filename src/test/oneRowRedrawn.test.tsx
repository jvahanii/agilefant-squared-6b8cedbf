/**
 * A change to one item draws that item's row again, and no other.
 *
 * Every visible row used to be drawn again after any change to any item: the
 * layout made its drag sensors anew each time it drew, which gave every row new
 * drag listeners; the panel handed every row a new select function and a new
 * map of running numbers; and each row added up its money over the whole map
 * of items. With forty rows in view that was most of what a rename cost.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.setConfig({ testTimeout: 20_000 });
import { render, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";

const drawn = vi.hoisted(() => [] as string[]);

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
      functions: { invoke: async () => ({ data: {}, error: null }) },
      auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    },
  };
});
vi.mock("@/store/supabaseSync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/supabaseSync")>()),
  upsertWorkItem: vi.fn(),
  upsertWorkItems: vi.fn(),
  upsertWorkItemBoardRankRowsDetailed: vi.fn(async () => ({ ok: true, missingWorkItemIds: [] })),
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
// Every row draws its menu each time it is drawn: which rows were drawn.
vi.mock("@/components/workItemRow/ItemMenu", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/workItemRow/ItemMenu")>();
  return {
    ...actual,
    ItemMenu: (props: Parameters<typeof actual.ItemMenu>[0]) => {
      drawn.push(props.item.id);
      return actual.ItemMenu(props);
    },
  };
});
vi.mock("@/components/BacklogTreePanel", () => ({ BacklogTreePanel: () => null }));
vi.mock("@/components/ActionPrompt", () => ({ ActionPrompt: () => null }));
vi.mock("@/components/JobSearchRunButton", () => ({ JobSearchRunButton: () => null }));
vi.mock("@/components/OrgSwitcher", () => ({ OrgSwitcher: () => null }));
vi.mock("@/components/RoleSimulator", () => ({ RoleSimulator: () => null }));
vi.mock("@/components/UserGuideDialog", () => ({ UserGuideDialog: () => null }));
Element.prototype.scrollIntoView ??= () => {};

import AppLayout from "@/components/AppLayout";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import type { WorkItem } from "@/types/models";

const ORG = "org-1";
const TREE = `${ORG}::bt-1`;
const LIST = `${ORG}::bl-1`;
const IDS = ["A", "B", "C", "D", "E"];

const item = (id: string, rank: number): WorkItem =>
  ({ id, title: `Item ${id}`, status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { [TREE]: LIST }, ranks: { [LIST]: rank }, organizationId: ORG }) as WorkItem;

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(async () => {
  useOrgStore.setState({
    activeOrgId: ORG,
    memberships: [{ organization_id: ORG, organization_name: "Acme", organization_slug: "acme", role: "owner" }],
  } as never);
  useOrgSettingsStore.setState({
    settings: {
      [ORG]: {
        timeLoggingEnabled: true, pointsEnabled: true, labelsEnabled: false, customStatusesEnabled: false,
        savingsIncomeEnabled: true, boardsEnabled: false, burnupsEnabled: false, persistNotificationsEnabled: false,
        publicLinksEnabled: false, ratingsEnabled: true, deadlinesEnabled: true, createdDatesEnabled: false,
        startEndDatesEnabled: false, scramblingEnabled: false,
      },
    },
  } as never);
  useAppStore.setState({
    organizationId: ORG,
    workItems: Object.fromEntries(IDS.map((id, i) => [id, item(id, i)])),
    backlogTrees: { [TREE]: { id: TREE, name: "Tree", rootBacklogIds: [LIST], rank: 0 } },
    backlogs: { [LIST]: { id: LIST, name: "List", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
    selectedTreeId: TREE,
    selectedBacklogIds: [LIST],
    selectedWorkItemIds: [],
    expandedWorkItems: new Set<string>(),
    expandedBacklogs: new Set<string>(),
    undoStack: [],
    redoStack: [],
  } as never);
  render(
    <MemoryRouter>
      <TooltipProvider>
        <AppLayout />
      </TooltipProvider>
    </MemoryRouter>,
  );
  await settle();
  await settle();
});

/** The rows drawn by what `change` does. */
async function rowsDrawnBy(change: () => void) {
  drawn.length = 0;
  await act(async () => change());
  await settle();
  return [...new Set(drawn)].sort();
}

describe("a change to one item", () => {
  it("is drawn by every row at first", () => {
    expect(new Set(drawn)).toEqual(new Set(IDS));
  });

  it("draws only its row again: a rename", async () => {
    expect(await rowsDrawnBy(() => useAppStore.getState().renameWorkItem("C", "Renamed"))).toEqual(["C"]);
  });

  it("draws only its row again: a status, points, a rating, a deadline", async () => {
    expect(await rowsDrawnBy(() => useAppStore.getState().setWorkItemStatus("B", "in_progress"))).toEqual(["B"]);
    expect(await rowsDrawnBy(() => useAppStore.getState().setWorkItemPoints("D", 5))).toEqual(["D"]);
    expect(await rowsDrawnBy(() => useAppStore.getState().setWorkItemRating("E", 4))).toEqual(["E"]);
    expect(await rowsDrawnBy(() => useAppStore.getState().setWorkItemDeadline("A", "2027-01-31"))).toEqual(["A"]);
  });

  it("arriving from elsewhere, draws only its row again", async () => {
    const c = useAppStore.getState().workItems.C;
    expect(
      await rowsDrawnBy(() =>
        useAppStore.getState().applyRealtimeWorkItem("UPDATE", {
          id: "C", title: "Renamed elsewhere", status: c.status, parent_id: null,
          backlog_assignments: c.backlogAssignments, organization_id: ORG, updated_at: new Date().toISOString(),
        }),
      ),
    ).toEqual(["C"]);
  });

  it("selecting a row draws only that row again", async () => {
    expect(await rowsDrawnBy(() => useAppStore.getState().selectWorkItem("B"))).toEqual(["B"]);
  });
});
