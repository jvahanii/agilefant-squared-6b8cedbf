/**
 * A load's small reads in one request (loadExtras.ts): each store takes its
 * part once, and reads for itself whenever the part is not to be trusted.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpcCalls: string[] = [];
const tableReads: string[] = [];
let rpcAnswer: () => { data: unknown; error: unknown } = () => ({ data: null, error: null });

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ["select", "eq", "in", "order", "range", "limit", "maybeSingle"]) b[m] = () => b;
    b.then = (ok: (v: unknown) => unknown) => {
      tableReads.push(table);
      return Promise.resolve({ data: [{ id: "own", organization_id: "org", name: "Read itself", color: "#000" }], error: null }).then(ok);
    };
    return b;
  };
  return {
    supabase: {
      from: (table: string) => builder(table),
      rpc: (name: string) => {
        rpcCalls.push(name);
        return Promise.resolve(rpcAnswer());
      },
    },
  };
});

vi.mock("@/integrations/supabase/pagination", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  paginateSelect: async (run: any) => run(0, 999),
}));

import { prefetchLoadExtras, takeLoadExtra } from "@/store/loadExtras";
import { useLabelsStore } from "@/store/labelsStore";

const extras = (over: Record<string, unknown> = {}) => ({
  data: {
    orgIds: ["org"],
    labels: [{ id: "l1", organization_id: "org", name: "Urgent", color: "#f00" }],
    labelAssignments: [],
    publishedLinks: [],
    itemScrambles: [],
    listScrambles: [],
    jiraLinks: [],
    jiraConnections: [],
    teams: [],
    teamMembers: [],
    teamAssignments: [],
    settings: null,
    statuses: [],
    snoozes: [],
    targets: [],
    financials: [],
    ...over,
  },
  error: null,
});

beforeEach(() => {
  rpcCalls.length = 0;
  tableReads.length = 0;
  rpcAnswer = () => extras();
});

describe("the load's combined read", () => {
  it("is asked for once however many times it is prefetched", async () => {
    await Promise.all([prefetchLoadExtras("org"), prefetchLoadExtras("org")]);
    expect(rpcCalls).toEqual(["get_load_extras"]);
  });

  it("gives each part once: a later read is the store's own", async () => {
    await prefetchLoadExtras("org");
    expect(await takeLoadExtra("labels", { orgIds: ["org"] })).toHaveLength(1);
    expect(await takeLoadExtra("labels", { orgIds: ["org"] })).toBeNull();
  });

  it("gives nothing for another organization, or other partner organizations", async () => {
    await prefetchLoadExtras("org");
    expect(await takeLoadExtra("settings", { orgId: "other" })).toBeNull();
    expect(await takeLoadExtra("labels", { orgIds: ["org", "partner"] })).toBeNull();
  });

  it("gives nothing when it failed", async () => {
    rpcAnswer = () => ({ data: null, error: { message: "timeout" } });
    await prefetchLoadExtras("org");
    expect(await takeLoadExtra("labels")).toBeNull();
  });

  it("gives nothing when none was asked for", async () => {
    expect(await takeLoadExtra("labels")).toBeNull();
  });
});

describe("a store", () => {
  it("takes its part instead of reading its tables", async () => {
    prefetchLoadExtras("org");
    await useLabelsStore.getState().loadLabels(["org"]);
    expect(Object.values(useLabelsStore.getState().labels).map((l) => l.name)).toEqual(["Urgent"]);
    expect(tableReads).toEqual([]);
  });

  it("reads its tables when the part is not to be had", async () => {
    rpcAnswer = () => ({ data: null, error: { message: "function does not exist" } });
    prefetchLoadExtras("org");
    await useLabelsStore.getState().loadLabels(["org"]);
    expect(tableReads.sort()).toEqual(["label_assignments", "labels"]);
    expect(Object.values(useLabelsStore.getState().labels).map((l) => l.name)).toEqual(["Read itself"]);
  });
});
