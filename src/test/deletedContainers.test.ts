import { describe, it, expect, vi, beforeEach } from "vitest";

const upserts: Array<{ table: string; ids: string[] }> = [];
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      upsert: async (rows: Array<{ id: string }>) => { upserts.push({ table, ids: rows.map((r) => r.id) }); return { error: null }; },
      delete: () => ({ in: async () => ({ error: null }) }),
    }),
  },
}));
vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/persistDebug", () => ({ notifyPersistDebug: vi.fn() }));

import { deleteBacklogs, upsertBacklogs } from "@/store/supabaseSync";
import { forgetDeletedContainers } from "@/store/deletedContainers";

const bl = (id: string) => ({ id, name: id, parentId: null, treeId: "o::bt", rank: 0, childrenIds: [] } as never);

beforeEach(() => { upserts.length = 0; localStorage.clear(); });

describe("a deleted list", () => {
  it("is not saved back by a later save that still carries it", async () => {
    await deleteBacklogs(["o::bl-gone"]);
    await upsertBacklogs([bl("o::bl-gone"), bl("o::bl-kept")], "o");
    expect(upserts.flatMap((u) => u.ids)).toEqual(["o::bl-kept"]);
  });

  it("can be saved again once undo restores it", async () => {
    await deleteBacklogs(["o::bl-undo"]);
    forgetDeletedContainers(["o::bl-undo"]);
    await upsertBacklogs([bl("o::bl-undo")], "o");
    expect(upserts.flatMap((u) => u.ids)).toEqual(["o::bl-undo"]);
  });
});
