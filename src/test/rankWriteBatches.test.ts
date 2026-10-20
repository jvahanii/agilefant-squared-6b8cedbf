/**
 * "Failed to save ranking — canceling statement due to statement timeout",
 * after importing jobs (2026-10-20).
 *
 * The import puts the new jobs at the top of "Open jobs" and saves the list's
 * order: a rank for every one of its 1,060 items, in one statement. That write
 * usually takes a fraction of a second; with the database busy straight after
 * an import it ran past the eight seconds a request is allowed. Pinned here:
 * rank writes go in batches, a batch stopped for taking too long is sent once
 * more, and re-ordering a list writes only the ranks that changed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertCalls: Array<{ table: string; rows: Array<{ work_item_id: string; rank: number }> }> = [];
let upsertResults: Array<{ error: unknown }> = [];

vi.mock("@/integrations/supabase/authClient", () => ({ getSupabaseAccessToken: async () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      upsert: async (rows: Array<{ work_item_id: string; rank: number }>) => {
        upsertCalls.push({ table, rows: [...rows] });
        return upsertResults.shift() ?? { error: null };
      },
    }),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  },
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }));
vi.mock("@/lib/persistDebug", () => ({ notifyPersistDebug: vi.fn() }));

import {
  RANK_WRITE_CHUNK,
  upsertWorkItemBacklogRankRowsDetailed,
  upsertWorkItemBoardRankRowsDetailed,
} from "@/store/supabaseSync";
import { useAppStore } from "@/store/appStore";
import type { WorkItem } from "@/types/models";

const TIMEOUT = { code: "57014", message: "canceling statement due to statement timeout" };
const id = (n: number) => `org-1::wi-${String(n).padStart(4, "0")}`;
const rows = (count: number) =>
  Array.from({ length: count }, (_, n) => ({ workItemId: id(n), backlogId: "bl-open", rank: n, organizationId: "org-1" }));

beforeEach(() => {
  upsertCalls.length = 0;
  upsertResults = [];
  toast.mockReset();
});

describe("writing a long list's ranks", () => {
  it("goes in batches, so no one statement carries the whole list", async () => {
    const result = await upsertWorkItemBacklogRankRowsDetailed(rows(1060));
    expect(result.ok).toBe(true);
    expect(upsertCalls.map((c) => c.rows.length)).toEqual([200, 200, 200, 200, 200, 60]);
    expect(Math.max(...upsertCalls.map((c) => c.rows.length))).toBeLessThanOrEqual(RANK_WRITE_CHUNK);
    // Every row once, in one order across the batches — the order that keeps
    // two writes from waiting on each other's rows.
    const written = upsertCalls.flatMap((c) => c.rows.map((r) => r.work_item_id));
    expect(written).toEqual([...written].sort());
    expect(new Set(written).size).toBe(1060);
    expect(toast).not.toHaveBeenCalled();
  });

  it("sends a batch once more when a busy database stopped it for taking too long", async () => {
    upsertResults = [{ error: TIMEOUT }];
    const result = await upsertWorkItemBacklogRankRowsDetailed(rows(250));
    expect(result.ok).toBe(true);
    expect(upsertCalls.map((c) => c.rows.length)).toEqual([200, 200, 50]);
    expect(upsertCalls[0].rows).toEqual(upsertCalls[1].rows);
    expect(toast).not.toHaveBeenCalled();
  });

  it("says so, once, when the same batch times out again — and writes no further batches", async () => {
    upsertResults = [{ error: TIMEOUT }, { error: TIMEOUT }];
    const result = await upsertWorkItemBacklogRankRowsDetailed(rows(450));
    expect(result.ok).toBe(false);
    expect(upsertCalls).toHaveLength(2);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Failed to save ranking", description: TIMEOUT.message }),
    );
  });

  it("does the same for the board's ranks", async () => {
    await upsertWorkItemBoardRankRowsDetailed(rows(401));
    expect(upsertCalls.map((c) => [c.table, c.rows.length])).toEqual([
      ["work_item_board_ranks", 200],
      ["work_item_board_ranks", 200],
      ["work_item_board_ranks", 1],
    ]);
  });
});

describe("saving a list's order", () => {
  const item = (n: number): WorkItem =>
    ({
      id: id(n),
      title: `Job ${n}`,
      parentId: null,
      childrenIds: [],
      backlogAssignments: { "tree-1": "bl-open" },
      ranks: { "bl-open": n },
      boardRanks: { "bl-open": n },
      status: "todo",
      organizationId: "org-1",
    }) as unknown as WorkItem;

  it("writes only the ranks that changed", async () => {
    const items = Object.fromEntries(Array.from({ length: 50 }, (_, n) => [id(n), item(n)]));
    useAppStore.setState({ organizationId: "org-1", workItems: items, undoStack: [], redoStack: [] } as never);
    // Two neighbours swap places; the other 48 stay where they were.
    const order = Array.from({ length: 50 }, (_, n) => id(n));
    [order[10], order[11]] = [order[11], order[10]];

    useAppStore.getState().applySiblingOrder(null, "tree-1", ["bl-open"], order, "swap two");
    await vi.waitFor(() => expect(upsertCalls.some((c) => c.table === "work_item_backlog_ranks")).toBe(true));

    const listWrite = upsertCalls.find((c) => c.table === "work_item_backlog_ranks")!;
    expect(listWrite.rows.map((r) => [r.work_item_id, r.rank])).toEqual([
      [id(10), 11],
      [id(11), 10],
    ]);
    expect(useAppStore.getState().workItems[id(11)].ranks["bl-open"]).toBe(10);
  });
});
