/**
 * Reads a load used to make twice, now made once and shared: who the trees
 * are shared with, whether the user is a superuser, and who our trees are
 * shared with (for the load and for live updates).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: string[] = [];
let failTrees = false;

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ["select", "eq", "in", "order", "single"]) b[m] = () => b;
    b.then = (ok: (v: unknown) => unknown) => {
      calls.push(table);
      const data = table === "profiles" ? { is_superuser: true } : [{ organization_id: "partner", tree_id: "org::t1" }];
      return Promise.resolve({ data, error: null }).then(ok);
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string) => {
        calls.push(name);
        if (name === "get_trees_sharing_info") {
          return Promise.resolve(
            failTrees
              ? { data: null, error: { message: "boom" } }
              : { data: [{ tree_id: "org::t1", org_id: "partner", org_name: "Partner" }], error: null },
          );
        }
        if (name === "my_superuser_status") {
          return Promise.resolve({ data: { is_superuser: true, needs_second_factor: false }, error: null });
        }
        // The old one-tree call, for the fallback.
        return Promise.resolve(failTrees ? { data: null, error: { message: "boom" } } : { data: [], error: null });
      },
    },
  };
});

import { useTreeSharesStore } from "@/store/treeSharesStore";
import { fetchIsSuperuser } from "@/lib/superuser";
import { forgetOutgoingShares, readOutgoingShares } from "@/store/supabaseSync";

beforeEach(() => {
  calls.length = 0;
  failTrees = false;
  forgetOutgoingShares();
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("who the trees are shared with", () => {
  it("is read once for everyone who asks about the same trees, whatever their order", async () => {
    const { ensure } = useTreeSharesStore.getState();
    ensure("org", ["org::t1", "org::t2"]);
    ensure("org", ["org::t2", "org::t1"]);
    await settle();
    await settle();
    ensure("org", ["org::t1", "org::t2"]);
    expect(calls.filter((c) => c.includes("sharing_info"))).toEqual(["get_trees_sharing_info"]);
    expect(useTreeSharesStore.getState().byTree["org::t1"]).toEqual([{ orgId: "partner", orgName: "Partner" }]);
  });

  it("is read again when a share changes", async () => {
    const { ensure, refresh } = useTreeSharesStore.getState();
    ensure("org", ["org::t1"]);
    await settle();
    await settle();
    refresh();
    await settle();
    expect(calls.filter((c) => c === "get_trees_sharing_info")).toHaveLength(2);
  });

  it("says it failed when it cannot be read, so the item panel treats trees as shared", async () => {
    failTrees = true;
    useTreeSharesStore.getState().ensure("org", ["org::t1"]);
    for (let i = 0; i < 5; i++) await settle();
    expect(useTreeSharesStore.getState().failed).toBe(true);
  });
});

describe("whether the user is a superuser", () => {
  it("is read once for everyone who asks", async () => {
    const [a, b] = await Promise.all([fetchIsSuperuser("u1"), fetchIsSuperuser("u1")]);
    expect(a.isSuperuser && b.isSuperuser).toBe(true);
    await fetchIsSuperuser("u1");
    expect(calls.filter((c) => c === "my_superuser_status")).toHaveLength(1);
  });
});

describe("who our trees are shared with", () => {
  it("is read once for the load and live updates asking a moment apart", async () => {
    await readOutgoingShares(["org::t2", "org::t1"]);
    await readOutgoingShares(["org::t1", "org::t2"]);
    expect(calls.filter((c) => c === "backlog_tree_shares")).toHaveLength(1);
  });

  it("is read again once a share has changed", async () => {
    await readOutgoingShares(["org::t1"]);
    forgetOutgoingShares();
    await readOutgoingShares(["org::t1"]);
    expect(calls.filter((c) => c === "backlog_tree_shares")).toHaveLength(2);
  });
});
