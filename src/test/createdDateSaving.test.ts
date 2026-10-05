/**
 * How a created date is saved — or, more to the point, not saved.
 *
 * The app names created_on only where an item has one, and never as null. A row
 * that leaves it out keeps what the database holds on an update and takes the
 * column's default on an insert. Sending null instead would let a tab still
 * holding items from before the column existed wipe the dates the database had
 * filled in. And because one request fills a column some rows omit with NULL
 * for those rows, dated and undated rows must travel separately.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const upserts: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];

vi.mock("@/integrations/supabase/authClient", () => ({
  getSupabaseAccessToken: async () => null,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      upsert: async (rows: Record<string, unknown> | Array<Record<string, unknown>>) => {
        upserts.push({ table, rows: Array.isArray(rows) ? [...rows] : [rows] });
        return { error: null };
      },
      delete: () => ({ eq: () => ({ in: async () => ({ error: null }), eq: async () => ({ error: null }) }) }),
    }),
    rpc: async () => ({ data: null, error: null }),
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
  },
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/persistDebug", () => ({ notifyPersistDebug: vi.fn() }));

import { upsertWorkItem, upsertWorkItems } from "@/store/supabaseSync";
import type { WorkItem } from "@/types/models";

const ORG = "11111111-1111-4111-8111-111111111111";
const item = (n: number, createdOn?: string): WorkItem => ({
  id: `${ORG}::wi-${n}`,
  title: `Item ${n}`,
  status: "not_started",
  parentId: null,
  childrenIds: [],
  backlogAssignments: {},
  ranks: {},
  organizationId: ORG,
  ...(createdOn ? { createdOn } : {}),
});

const itemUpserts = () => upserts.filter((u) => u.table === "work_items");

beforeEach(() => {
  upserts.length = 0;
});

describe("saving one item", () => {
  it("names the created date it has", async () => {
    await upsertWorkItem(item(1, "2026-09-30"), ORG);
    expect(itemUpserts()[0].rows[0]).toMatchObject({ created_on: "2026-09-30" });
  });

  it("leaves the column out altogether when it has none", async () => {
    await upsertWorkItem(item(2), ORG);
    expect("created_on" in itemUpserts()[0].rows[0]).toBe(false);
  });
});

describe("saving several items", () => {
  it("sends dated and undated rows in separate requests", async () => {
    await upsertWorkItems([item(1, "2026-09-30"), item(2), item(3, "2026-10-01"), item(4)], ORG);
    const requests = itemUpserts();
    expect(requests).toHaveLength(2);
    const [dated, undated] = requests;
    expect(dated.rows.map((r) => r.created_on)).toEqual(["2026-09-30", "2026-10-01"]);
    expect(undated.rows).toHaveLength(2);
    expect(undated.rows.every((r) => !("created_on" in r))).toBe(true);
  });

  it("sends one request when every row is the same kind", async () => {
    await upsertWorkItems([item(1, "2026-09-30"), item(2, "2026-10-01")], ORG);
    expect(itemUpserts()).toHaveLength(1);
    upserts.length = 0;
    await upsertWorkItems([item(3), item(4)], ORG);
    expect(itemUpserts()).toHaveLength(1);
  });
});
