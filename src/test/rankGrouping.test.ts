/**
 * Ranks are now fetched pre-grouped, with backlog ids interned into a
 * dictionary, because reading the rank tables row by row was ~1.7 MB of mostly
 * repeated identifiers on every cold start. The decode has to reconstruct
 * exactly what the row reads produced — rank handling is subtle here and a
 * silent mismatch would reorder people's backlogs rather than fail loudly.
 *
 * So the load runs twice over the same underlying data, once through the RPC
 * and once through the fallback row reads, and the two results are compared.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Result = { data: unknown; error: unknown };

const tableResults = new Map<string, () => Promise<Result>>();
let rpcHandler: (name: string, args: unknown) => Promise<Result>;
const rpcCalls: Array<{ name: string; args: unknown }> = [];

function builderFor(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  const chain = () => builder;
  for (const m of ["select", "eq", "in", "order", "range", "limit", "delete", "gte"]) builder[m] = chain;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  builder.then = (onFulfilled: any, onRejected: any) => {
    const produce = tableResults.get(table) ?? (async () => ({ data: [], error: null }));
    return produce().then(onFulfilled, onRejected);
  };
  return builder;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => builderFor(table),
    rpc: (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return rpcHandler(name, args);
    },
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  },
}));

vi.mock("@/integrations/supabase/pagination", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paginateSelect: async (run: any) => run(0, 999),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/persistDebug", () => ({ notifyPersistDebug: vi.fn() }));

import { loadFromSupabase } from "@/store/supabaseSync";

const ORG = "11111111-1111-1111-1111-111111111111";
const TREE = "tree-1";
const BL_A = `${ORG}::backlog-a`;
const BL_B = `${ORG}::backlog-b`;
const WI_1 = `${ORG}::item-1`;
const WI_2 = `${ORG}::item-2`;

// One item ranked in two backlogs, another in a single backlog — enough to
// catch an off-by-one in the dictionary lookup or a swapped map.
const BACKLOG_ROWS = [
  { work_item_id: WI_1, backlog_id: BL_A, rank: 3 },
  { work_item_id: WI_1, backlog_id: BL_B, rank: 7 },
  { work_item_id: WI_2, backlog_id: BL_A, rank: 1 },
];
const BOARD_ROWS = [
  { work_item_id: WI_1, backlog_id: BL_A, rank: 2.5 },
  { work_item_id: WI_2, backlog_id: BL_B, rank: 9 },
];

// backlogIds is sorted, matching the SQL's ORDER BY backlog_id.
const INTERNED = {
  backlogIds: [BL_A, BL_B],
  backlog: {
    [WI_1]: { "0": 3, "1": 7 },
    [WI_2]: { "0": 1 },
  },
  board: {
    [WI_1]: { "0": 2.5 },
    [WI_2]: { "1": 9 },
  },
};

function workItemRow(id: string) {
  return {
    id,
    title: `Item ${id}`,
    description: null,
    points: null,
    status: "not_started",
    parent_id: null,
    parent_id_overrides: null,
    backlog_assignments: { [TREE]: BL_A },
    rank: 0,
    organization_id: ORG,
    respawn_enabled: false,
    respawn_interval_days: null,
    respawn_hour: null,
    respawn_minute: null,
    respawn_last_triggered_at: null,
  };
}

beforeEach(() => {
  tableResults.clear();
  rpcCalls.length = 0;
  tableResults.set("backlog_trees", async () => ({
    data: [{ id: TREE, name: "Tree", rank: 0, points_enabled: null, organization_id: ORG }],
    error: null,
  }));
  tableResults.set("backlogs", async () => ({
    data: [
      { id: BL_A, name: "A", parent_id: null, tree_id: TREE, rank: 0 },
      { id: BL_B, name: "B", parent_id: null, tree_id: TREE, rank: 1 },
    ],
    error: null,
  }));
  tableResults.set("work_items", async () => ({
    data: [workItemRow(WI_1), workItemRow(WI_2)],
    error: null,
  }));
  tableResults.set("work_item_backlog_ranks", async () => ({ data: BACKLOG_ROWS, error: null }));
  tableResults.set("work_item_board_ranks", async () => ({ data: BOARD_ROWS, error: null }));
  rpcHandler = async () => ({ data: INTERNED, error: null });
});

describe("grouped rank fetch", () => {
  it("decodes interned backlog ids back onto the right work items", async () => {
    const result = await loadFromSupabase(ORG);

    expect(result.workItems[WI_1].ranks).toEqual({ [BL_A]: 3, [BL_B]: 7 });
    expect(result.workItems[WI_2].ranks).toEqual({ [BL_A]: 1 });
    expect(result.workItems[WI_1].boardRanks).toEqual({ [BL_A]: 2.5 });
    expect(result.workItems[WI_2].boardRanks).toEqual({ [BL_B]: 9 });
  });

  it("asks the RPC for the ranks rather than reading the tables", async () => {
    await loadFromSupabase(ORG);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].name).toBe("get_work_item_ranks");
    expect(rpcCalls[0].args).toEqual({ _org_ids: [ORG] });
  });

  it("produces exactly the same ranks as the row reads when the RPC is unavailable", async () => {
    const viaRpc = await loadFromSupabase(ORG);

    // Same data, but the RPC is missing — e.g. the migration has not reached
    // this environment yet — so the load falls back to reading the tables.
    rpcHandler = async () => ({ data: null, error: { message: "function does not exist" } });
    const viaRows = await loadFromSupabase(ORG);

    for (const id of [WI_1, WI_2]) {
      expect(viaRows.workItems[id].ranks).toEqual(viaRpc.workItems[id].ranks);
      expect(viaRows.workItems[id].boardRanks).toEqual(viaRpc.workItems[id].boardRanks);
    }
  });

  it("ignores rank entries whose dictionary index is missing", async () => {
    // A malformed payload must not invent a backlog id such as "undefined".
    rpcHandler = async () => ({
      data: { backlogIds: [BL_A], backlog: { [WI_1]: { "0": 3, "9": 5 } }, board: {} },
      error: null,
    });
    const result = await loadFromSupabase(ORG);
    expect(result.workItems[WI_1].ranks).toEqual({ [BL_A]: 3 });
  });
});
