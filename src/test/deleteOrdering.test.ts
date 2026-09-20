/**
 * Deletes and restores at the sync layer.
 *
 * 2026-09-16, "Basware HR AI & Technology Lead": its status was changed three
 * times at 10:32:07–09 while ~100 other status saves were still draining through
 * the serial work item queue, then it was deleted at 10:32:20. The delete RPC
 * did not wait in that queue, so it ran first, and at 10:33:34 the queued saves
 * reached the database and inserted the item again — without its hyperlink,
 * which the delete had cascaded away.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorkItem } from "@/types/models";

const log: string[] = [];
let releaseUpsert: (() => void) | null = null;
let holdNextUpsert = false;
let rpcResults: Record<string, { data: unknown; error: unknown }> = {};
const upserts: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];

vi.mock("@/integrations/supabase/authClient", () => ({ getSupabaseAccessToken: async () => null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      upsert: (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        const list = Array.isArray(rows) ? rows : [rows];
        const done = () => {
          upserts.push({ table, rows: list });
          log.push(`upsert ${table} ${list.map((r) => r.id ?? r.work_item_id).join(",")}`);
          return { error: null };
        };
        if (table === "work_items" && holdNextUpsert) {
          holdNextUpsert = false;
          return new Promise((resolve) => { releaseUpsert = () => resolve(done()); });
        }
        return Promise.resolve(done());
      },
      delete: () => ({ in: async () => { log.push(`direct delete ${table}`); return { error: null }; } }),
    }),
    rpc: async (name: string, args: { _ids: string[] }) => {
      log.push(`rpc ${name} ${args._ids.join(",")}`);
      return rpcResults[name] ?? { data: null, error: null };
    },
  },
}));

vi.mock("@/integrations/supabase/pagination", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paginateSelect: async (run: any) => run(0, 999),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/persistDebug", () => ({ notifyPersistDebug: vi.fn() }));

import { deleteWorkItems, restoreWorkItems, upsertWorkItems } from "@/store/supabaseSync";
import { isRecentlyDeletedWorkItem } from "@/store/deletedWorkItems";

const ORG = "org-1";
const item = (id: string, title = id): WorkItem => ({
  id, title, status: "in_progress", parentId: null, childrenIds: [], organizationId: ORG,
  backlogAssignments: { [`${ORG}::bt`]: `${ORG}::bl` }, ranks: { [`${ORG}::bl`]: 3 }, boardRanks: { [`${ORG}::bl`]: 1.5 },
});

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

beforeEach(() => {
  log.length = 0;
  upserts.length = 0;
  releaseUpsert = null;
  holdNextUpsert = false;
  rpcResults = {};
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("a delete behind queued saves", () => {
  it("waits for the saves already queued, so none of them lands after it", async () => {
    holdNextUpsert = true;
    const save = upsertWorkItems([item(`${ORG}::wi-slow`)], ORG);
    const del = deleteWorkItems([`${ORG}::wi-basware`]);
    await settle();
    expect(log.some((l) => l.startsWith("rpc bulk_delete_work_items"))).toBe(false);

    releaseUpsert!();
    await Promise.all([save, del]);

    const rpcAt = log.findIndex((l) => l.startsWith("rpc bulk_delete_work_items"));
    const upsertAt = log.findIndex((l) => l.startsWith("upsert work_items"));
    expect(upsertAt).toBeGreaterThanOrEqual(0);
    expect(rpcAt).toBeGreaterThan(upsertAt);
  });

  it("drops a save of that item still waiting behind it", async () => {
    holdNextUpsert = true;
    const blocker = upsertWorkItems([item(`${ORG}::wi-other`)], ORG);
    const staleSave = upsertWorkItems([item(`${ORG}::wi-basware`), item(`${ORG}::wi-kept`)], ORG);
    const del = deleteWorkItems([`${ORG}::wi-basware`]);
    expect(isRecentlyDeletedWorkItem(`${ORG}::wi-basware`)).toBe(true);

    await settle();
    releaseUpsert!();
    await Promise.all([blocker, staleSave, del]);

    const written = upserts.filter((u) => u.table === "work_items").flatMap((u) => u.rows.map((r) => r.id));
    expect(written).toEqual([`${ORG}::wi-other`, `${ORG}::wi-kept`]);
  });
});

describe("restoreWorkItems", () => {
  it("lets the database restore what it kept, and writes nothing else", async () => {
    const id = `${ORG}::wi-restore`;
    await deleteWorkItems([id]);
    rpcResults.restore_deleted_work_items = { data: [id], error: null };

    const ok = await restoreWorkItems([item(id)], ORG, {});

    expect(ok).toBe(true);
    expect(isRecentlyDeletedWorkItem(id)).toBe(false);
    expect(log.at(-1)).toBe(`rpc restore_deleted_work_items ${id}`);
    expect(upserts).toHaveLength(0);
  });

  it("writes what the page holds for any item the database did not restore", async () => {
    const restored = `${ORG}::wi-archived`;
    const fallback = `${ORG}::wi-not-archived`;
    rpcResults.restore_deleted_work_items = { data: [restored], error: null };
    const link = { id: "link-1", workItemId: fallback, url: "https://example.com/job", altText: "Job", rank: 0 };

    const ok = await restoreWorkItems([item(restored), item(fallback)], ORG, { [fallback]: [link], [restored]: [] });

    expect(ok).toBe(true);
    const byTable = (table: string) => upserts.filter((u) => u.table === table).flatMap((u) => u.rows);
    expect(byTable("work_items").map((r) => r.id)).toEqual([fallback]);
    expect(byTable("work_item_backlog_ranks")).toEqual([expect.objectContaining({ work_item_id: fallback, rank: 3 })]);
    expect(byTable("work_item_board_ranks")).toEqual([expect.objectContaining({ work_item_id: fallback, rank: 1.5 })]);
    expect(byTable("work_item_hyperlinks")).toEqual([
      expect.objectContaining({ id: "link-1", work_item_id: fallback, url: "https://example.com/job", organization_id: ORG }),
    ]);
  });

  it("writes everything from the page when the restore function is not deployed", async () => {
    const id = `${ORG}::wi-no-rpc`;
    rpcResults.restore_deleted_work_items = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };

    const ok = await restoreWorkItems([item(id)], ORG, {});

    expect(ok).toBe(true);
    expect(upserts.filter((u) => u.table === "work_items").flatMap((u) => u.rows.map((r) => r.id))).toEqual([id]);
  });
});
