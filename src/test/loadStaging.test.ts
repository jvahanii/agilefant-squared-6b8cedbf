/**
 * loadFromSupabase must hand the caller its trees + backlogs before it awaits
 * the work-item and rank payloads, which are an order of magnitude larger.
 * If that ordering regresses the app goes back to showing a skeleton until the
 * entire dataset has landed, which is the slow mobile cold start this staging
 * exists to avoid. The work-item read here is held open deliberately: the
 * structure callback still has to fire while it is outstanding.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Result = { data: unknown[] | null; error: unknown };

const tableResults = new Map<string, () => Promise<Result>>();

function builderFor(table: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {};
  const chain = () => builder;
  for (const method of ["select", "eq", "in", "order", "range", "limit", "delete", "gte"]) {
    builder[method] = chain;
  }
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

const ORG = "org-1";
const TREE = "tree-1";
const BACKLOG = "backlog-1";

async function waitFor(predicate: () => boolean, label: string) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

beforeEach(() => {
  tableResults.clear();
  tableResults.set("backlog_trees", async () => ({
    data: [{ id: TREE, name: "Tree", rank: 0, points_enabled: null, organization_id: ORG }],
    error: null,
  }));
  tableResults.set("backlogs", async () => ({
    data: [{ id: BACKLOG, name: "Backlog", parent_id: null, tree_id: TREE, rank: 0 }],
    error: null,
  }));
});

describe("loadFromSupabase staging", () => {
  it("reports the structure while the work-item read is still outstanding", async () => {
    let releaseWorkItems!: () => void;
    const workItemsGate = new Promise<void>((resolve) => { releaseWorkItems = resolve; });
    let workItemsResolved = false;
    tableResults.set("work_items", async () => {
      await workItemsGate;
      workItemsResolved = true;
      return { data: [], error: null };
    });

    const onStructureReady = vi.fn();
    const loadPromise = loadFromSupabase(ORG, onStructureReady);

    await waitFor(() => onStructureReady.mock.calls.length > 0, "structure callback");

    // The decisive assertion: structure arrived while work items are pending.
    expect(workItemsResolved).toBe(false);
    const structure = onStructureReady.mock.calls[0][0];
    expect(Object.keys(structure.backlogTrees)).toEqual([TREE]);
    expect(Object.keys(structure.backlogs)).toEqual([BACKLOG]);
    expect(structure.backlogTrees[TREE].rootBacklogIds).toEqual([BACKLOG]);

    releaseWorkItems();
    await loadPromise;
    expect(workItemsResolved).toBe(true);
  });

  it("still resolves fully when no structure callback is supplied", async () => {
    tableResults.set("work_items", async () => ({ data: [], error: null }));

    const result = await loadFromSupabase(ORG);
    expect(Object.keys(result.backlogTrees)).toEqual([TREE]);
    expect(Object.keys(result.backlogs)).toEqual([BACKLOG]);
    expect(result.workItems).toEqual({});
  });
});
