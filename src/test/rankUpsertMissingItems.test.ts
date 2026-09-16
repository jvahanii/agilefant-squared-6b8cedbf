/**
 * "Failed to save ranking … violates foreign key constraint
 * work_item_backlog_ranks_work_item_id_fkey", again and again.
 *
 * A rank row naming a work item that no longer exists failed its whole write.
 * Failed writes stay queued and are re-sent on every load, so one row for a
 * deleted item kept failing every write after it, forever. These tests pin the
 * write's new behaviour: the database refusing for exactly that reason costs
 * only the rows for missing items, the rest are saved, and nobody is shown an
 * error for a rank that has nothing left to order.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const upsertCalls: Array<{ table: string; rows: Array<{ work_item_id: string }> }> = [];
let upsertResults: Array<{ error: unknown }> = [];
let existingIds = new Set<string>();

vi.mock("@/integrations/supabase/authClient", () => ({
  getSupabaseAccessToken: async () => null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      upsert: async (rows: Array<{ work_item_id: string }>) => {
        upsertCalls.push({ table, rows: [...rows] });
        return upsertResults.shift() ?? { error: null };
      },
      select: () => ({
        in: (_col: string, ids: string[]) => ({
          order: () => ({
            range: async () => ({
              data: ids.filter((id) => existingIds.has(id)).map((id) => ({ id })),
              error: null,
            }),
          }),
        }),
      }),
    }),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  },
}));

vi.mock("@/integrations/supabase/pagination", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paginateSelect: async (run: any) => run(0, 999),
}));

const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }));
vi.mock("@/lib/persistDebug", () => ({ notifyPersistDebug: vi.fn() }));

import {
  upsertWorkItemBacklogRankRowsDetailed,
  upsertWorkItemBoardRankRowsDetailed,
} from "@/store/supabaseSync";

const FK_ERROR = {
  code: "23503",
  message:
    'insert or update on table "work_item_backlog_ranks" violates foreign key constraint "work_item_backlog_ranks_work_item_id_fkey"',
};

const row = (workItemId: string, rank: number) => ({ workItemId, backlogId: "bl-1", rank, organizationId: "org-1" });

beforeEach(() => {
  upsertCalls.length = 0;
  upsertResults = [];
  existingIds = new Set();
  toast.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("rank writes naming a work item that no longer exists", () => {
  it("saves the other rows and reports the missing item, without an error", async () => {
    upsertResults = [{ error: FK_ERROR }, { error: null }];
    existingIds = new Set(["alive-1", "alive-2"]);

    const result = await upsertWorkItemBacklogRankRowsDetailed([row("alive-1", 0), row("deleted", 1), row("alive-2", 2)]);

    expect(result).toEqual({ ok: true, missingWorkItemIds: ["deleted"] });
    expect(upsertCalls).toHaveLength(2);
    expect(upsertCalls[1].rows.map((r) => r.work_item_id)).toEqual(["alive-1", "alive-2"]);
    expect(toast).not.toHaveBeenCalled();
  });

  it("writes nothing more when every item named is gone", async () => {
    upsertResults = [{ error: FK_ERROR }];

    const result = await upsertWorkItemBacklogRankRowsDetailed([row("gone-1", 0), row("gone-2", 1)]);

    expect(result.ok).toBe(true);
    expect(result.missingWorkItemIds.sort()).toEqual(["gone-1", "gone-2"]);
    expect(upsertCalls).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
  });

  it("does the same for board ranks, which reference work items the same way", async () => {
    upsertResults = [
      { error: { ...FK_ERROR, message: FK_ERROR.message.replace(/backlog_ranks/g, "board_ranks") } },
      { error: null },
    ];
    existingIds = new Set(["alive"]);

    const result = await upsertWorkItemBoardRankRowsDetailed([row("alive", 0), row("deleted", 1)]);

    expect(result).toEqual({ ok: true, missingWorkItemIds: ["deleted"] });
    expect(upsertCalls[1].table).toBe("work_item_board_ranks");
  });
});

describe("every other failure is still a failure", () => {
  it("reports and shows an error that is not about a missing item", async () => {
    upsertResults = [{ error: { code: "42501", message: "permission denied" } }];

    const result = await upsertWorkItemBacklogRankRowsDetailed([row("alive", 0)]);

    expect(result).toEqual({ ok: false, missingWorkItemIds: [] });
    expect(toast).toHaveBeenCalledTimes(1);
    expect(upsertCalls).toHaveLength(1);
  });

  it("does not treat another foreign key as a missing work item", async () => {
    upsertResults = [{ error: { code: "23503", message: 'violates foreign key constraint "some_other_fkey"' } }];

    const result = await upsertWorkItemBacklogRankRowsDetailed([row("alive", 0)]);

    expect(result.ok).toBe(false);
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("stays a failure when the rows that do exist still cannot be written", async () => {
    upsertResults = [{ error: FK_ERROR }, { error: { code: "08006", message: "connection failure" } }];
    existingIds = new Set(["alive"]);

    const result = await upsertWorkItemBacklogRankRowsDetailed([row("alive", 0), row("deleted", 1)]);

    expect(result).toEqual({ ok: false, missingWorkItemIds: ["deleted"] });
    expect(toast).toHaveBeenCalledTimes(1);
  });

  it("succeeds on the normal path without looking anything up", async () => {
    const result = await upsertWorkItemBacklogRankRowsDetailed([row("alive", 0)]);
    expect(result).toEqual({ ok: true, missingWorkItemIds: [] });
    expect(upsertCalls).toHaveLength(1);
  });
});
