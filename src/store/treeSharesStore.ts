import { create } from "zustand";

/**
 * Who each tree on screen is shared with, read once for every tree and for
 * every component that asks.
 *
 * The tree panel asked for all its trees, and the item panel asked again for
 * the selected one — whether to scramble its names — and each asked twice as
 * it settled: four requests at the start of every load, for one answer.
 */

export interface TreeShare {
  orgId: string;
  orgName: string;
}

interface TreeSharesState {
  /** What the answer is for: the organization and its trees. */
  key: string | null;
  byTree: Record<string, TreeShare[]>;
  /** The last read failed: callers treat every tree as shared, to be safe. */
  failed: boolean;
  /** Read for these trees unless that is already done or under way. */
  ensure: (orgId: string, treeIds: readonly string[]) => void;
  /** Read again: a share was added or removed. */
  refresh: () => void;
}

const keyOf = (orgId: string, treeIds: readonly string[]) => `${orgId}|${[...treeIds].sort().join(",")}`;

let inFlightKey: string | null = null;
let lastAsked: { orgId: string; treeIds: string[] } | null = null;

async function read(orgId: string, treeIds: readonly string[]): Promise<Record<string, TreeShare[]>> {
  // Imported when first asked, so a test's mock of the client is the one used.
  const { supabase } = await import("@/integrations/supabase/client");
  const result: Record<string, TreeShare[]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = await (supabase as any).rpc("get_trees_sharing_info", { _tree_ids: treeIds, _exclude_org_id: orgId });
  if (!all.error && Array.isArray(all.data)) {
    for (const row of all.data as Array<{ tree_id: string; org_id: string; org_name: string }>) {
      (result[row.tree_id] ??= []).push({ orgId: row.org_id, orgName: row.org_name });
    }
    return result;
  }
  // A database without get_trees_sharing_info: one a tree, as before.
  const results = await Promise.all(
    treeIds.map((treeId) =>
      supabase
        .rpc("get_tree_sharing_info", { _tree_id: treeId, _exclude_org_id: orgId })
        .then((res) => ({ treeId, data: res.data, error: res.error })),
    ),
  );
  for (const { treeId, data, error } of results) {
    if (error) throw error;
    if (!data || data.length === 0) continue;
    result[treeId] = (data as Array<{ org_id: string; org_name: string }>).map((row) => ({ orgId: row.org_id, orgName: row.org_name }));
  }
  return result;
}

export const useTreeSharesStore = create<TreeSharesState>((set, get) => ({
  key: null,
  byTree: {},
  failed: false,

  ensure: (orgId, treeIds) => {
    if (treeIds.length === 0) return;
    const key = keyOf(orgId, treeIds);
    lastAsked = { orgId, treeIds: [...treeIds] };
    if (get().key === key || inFlightKey === key) return;
    inFlightKey = key;
    read(orgId, treeIds)
      .then((byTree) => {
        if (inFlightKey !== key) return;
        set({ key, byTree, failed: false });
      })
      .catch((err) => {
        console.error("Could not read who the trees are shared with", err);
        if (inFlightKey !== key) return;
        set({ key, byTree: {}, failed: true });
      })
      .finally(() => {
        if (inFlightKey === key) inFlightKey = null;
      });
  },

  refresh: () => {
    set({ key: null });
    inFlightKey = null;
    if (lastAsked) get().ensure(lastAsked.orgId, lastAsked.treeIds);
  },
}));

/** Forget everything (between tests). */
export function forgetTreeShares(): void {
  inFlightKey = null;
  lastAsked = null;
  useTreeSharesStore.setState({ key: null, byTree: {}, failed: false });
}
