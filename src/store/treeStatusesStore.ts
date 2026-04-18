import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

export interface TreeStatus {
  id: string;
  treeId: string;
  key: string;
  label: string;
  color: string;
  rank: number;
}

/** Keys of the statuses that every tree must always have and that cannot be edited or deleted. */
export const PINNED_STATUS_KEYS = ['not_started', 'in_progress', 'done'] as const;
export type PinnedStatusKey = typeof PINNED_STATUS_KEYS[number];

/** Returns true if the given status key is a required, non-editable pinned status. */
export function isPinnedStatus(key: string): boolean {
  return (PINNED_STATUS_KEYS as readonly string[]).includes(key);
}

/** Hard-coded fallback used when a tree has no rows in `tree_statuses`
 *  (e.g. immediately after creation, before realtime delivers them). */
export const DEFAULT_TREE_STATUSES: Omit<TreeStatus, 'id' | 'treeId'>[] = [
  { key: 'not_started', label: 'Not Started', color: '#94a3b8', rank: 0 },
  { key: 'in_progress', label: 'In Progress', color: '#3b82f6', rank: 1 },
  { key: 'pending',     label: 'Pending',     color: '#f59e0b', rank: 2 },
  { key: 'blocked',     label: 'Blocked',     color: '#ef4444', rank: 3 },
  { key: 'done',        label: 'Done',        color: '#22c55e', rank: 4 },
];

/** The pinned statuses seeded into every new tree, in canonical order. */
const PINNED_STATUS_SEEDS: Omit<TreeStatus, 'id' | 'treeId'>[] = [
  { key: 'not_started', label: 'Not Started', color: '#94a3b8', rank: 0 },
  { key: 'in_progress', label: 'In Progress', color: '#3b82f6', rank: 1 },
  { key: 'done',        label: 'Done',        color: '#22c55e', rank: 999 },
];

interface TreeStatusesState {
  /** treeId -> ordered list */
  statusesByTree: Record<string, TreeStatus[]>;
  loading: boolean;

  loadStatusesForTrees: (treeIds: string[]) => Promise<void>;
  seedPinnedStatuses: (treeId: string) => Promise<void>;
  createStatus: (treeId: string, key: string, label: string, color: string) => Promise<void>;
  updateStatus: (id: string, patch: Partial<Pick<TreeStatus, 'label' | 'color' | 'key'>>) => Promise<void>;
  deleteStatus: (id: string) => Promise<void>;
  reorderStatuses: (treeId: string, orderedIds: string[]) => Promise<void>;

  applyRealtimeStatus: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

function rowToStatus(row: Record<string, unknown>): TreeStatus {
  return {
    id: row.id as string,
    treeId: row.tree_id as string,
    key: row.key as string,
    label: row.label as string,
    color: row.color as string,
    rank: (row.rank as number) ?? 0,
  };
}

function sortByRank(list: TreeStatus[]): TreeStatus[] {
  return [...list].sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
}

export const useTreeStatusesStore = create<TreeStatusesState>((set, get) => ({
  statusesByTree: {},
  loading: false,

  loadStatusesForTrees: async (treeIds) => {
    if (treeIds.length === 0) return;
    set({ loading: true });
    const { data, error } = await supabase
      .from('tree_statuses' as any)
      .select('*')
      .in('tree_id', treeIds);

    if (error) {
      console.error('loadStatusesForTrees failed', error);
      set({ loading: false });
      return;
    }

    const grouped: Record<string, TreeStatus[]> = {};
    for (const tid of treeIds) grouped[tid] = [];
    for (const row of ((data as unknown) ?? []) as Record<string, unknown>[]) {
      const s = rowToStatus(row);
      (grouped[s.treeId] ??= []).push(s);
    }
    for (const tid of Object.keys(grouped)) grouped[tid] = sortByRank(grouped[tid]);

    set((state) => ({
      loading: false,
      statusesByTree: { ...state.statusesByTree, ...grouped },
    }));

    // Ensure every tree has the required pinned statuses.
    for (const tid of treeIds) {
      await get().seedPinnedStatuses(tid);
    }
  },

  seedPinnedStatuses: async (treeId) => {
    const existing = get().statusesByTree[treeId] ?? [];
    const existingKeys = new Set(existing.map((s) => s.key));
    const missing = PINNED_STATUS_SEEDS.filter((s) => !existingKeys.has(s.key));
    if (missing.length === 0) return;

    // Compute a rank offset so new pinned statuses don't collide with existing ones.
    const maxExistingRank = existing.length > 0 ? Math.max(...existing.map((s) => s.rank)) : -1;

    await Promise.all(
      missing.map(async (seed) => {
        // Use canonical rank but offset to stay above existing if needed.
        const rank = seed.key === 'done'
          ? Math.max(seed.rank, maxExistingRank + 1)
          : seed.rank;
        const { data, error } = await supabase
          .from('tree_statuses' as any)
          .insert({ tree_id: treeId, key: seed.key, label: seed.label, color: seed.color, rank })
          .select()
          .single();
        if (error) {
          console.error('seedPinnedStatuses failed for', seed.key, error);
          return;
        }
        const s = rowToStatus(data as unknown as Record<string, unknown>);
        set((state) => ({
          statusesByTree: {
            ...state.statusesByTree,
            [treeId]: sortByRank([...(state.statusesByTree[treeId] ?? []), s]),
          },
        }));
      }),
    );
  },

  createStatus: async (treeId, key, label, color) => {
    const existing = get().statusesByTree[treeId] ?? [];
    const nextRank = existing.length > 0 ? Math.max(...existing.map((s) => s.rank)) + 1 : 0;
    const { data, error } = await supabase
      .from('tree_statuses' as any)
      .insert({ tree_id: treeId, key, label, color, rank: nextRank })
      .select()
      .single();
    if (error) {
      console.error('createStatus failed', error);
      return;
    }
    const s = rowToStatus(data as unknown as Record<string, unknown>);
    set((state) => ({
      statusesByTree: {
        ...state.statusesByTree,
        [treeId]: sortByRank([...(state.statusesByTree[treeId] ?? []), s]),
      },
    }));
  },

  updateStatus: async (id, patch) => {
    // Guard: pinned statuses cannot be edited.
    const allLists = Object.values(get().statusesByTree);
    for (const list of allLists) {
      const status = list.find((s) => s.id === id);
      if (status && isPinnedStatus(status.key)) return;
    }

    // Optimistic
    set((state) => {
      const next = { ...state.statusesByTree };
      for (const [tid, list] of Object.entries(next)) {
        const idx = list.findIndex((s) => s.id === id);
        if (idx !== -1) {
          const updated = { ...list[idx], ...patch };
          next[tid] = sortByRank([...list.slice(0, idx), updated, ...list.slice(idx + 1)]);
          break;
        }
      }
      return { statusesByTree: next };
    });
    const dbPatch: Record<string, unknown> = {};
    if (patch.label !== undefined) dbPatch.label = patch.label;
    if (patch.color !== undefined) dbPatch.color = patch.color;
    if (patch.key !== undefined) dbPatch.key = patch.key;
    const { error } = await supabase.from('tree_statuses' as any).update(dbPatch).eq('id', id);
    if (error) console.error('updateStatus failed', error);
  },

  deleteStatus: async (id) => {
    // Guard: pinned statuses cannot be deleted.
    const allLists = Object.values(get().statusesByTree);
    for (const list of allLists) {
      const status = list.find((s) => s.id === id);
      if (status && isPinnedStatus(status.key)) return;
    }

    set((state) => {
      const next = { ...state.statusesByTree };
      for (const [tid, list] of Object.entries(next)) {
        if (list.some((s) => s.id === id)) {
          next[tid] = list.filter((s) => s.id !== id);
          break;
        }
      }
      return { statusesByTree: next };
    });
    const { error } = await supabase.from('tree_statuses' as any).delete().eq('id', id);
    if (error) console.error('deleteStatus failed', error);
  },

  reorderStatuses: async (treeId, orderedIds) => {
    const list = get().statusesByTree[treeId] ?? [];
    const byId = new Map(list.map((s) => [s.id, s]));
    const reordered = orderedIds
      .map((id, idx) => {
        const s = byId.get(id);
        return s ? { ...s, rank: idx } : null;
      })
      .filter((x): x is TreeStatus => !!x);

    set((state) => ({
      statusesByTree: { ...state.statusesByTree, [treeId]: reordered },
    }));

    // Persist new ranks
    await Promise.all(
      reordered.map((s) =>
        supabase.from('tree_statuses' as any).update({ rank: s.rank }).eq('id', s.id),
      ),
    );
  },

  applyRealtimeStatus: (event, row) => {
    if (event === 'DELETE') {
      const id = row.id as string;
      set((state) => {
        const next = { ...state.statusesByTree };
        for (const [tid, list] of Object.entries(next)) {
          if (list.some((s) => s.id === id)) {
            next[tid] = list.filter((s) => s.id !== id);
            break;
          }
        }
        return { statusesByTree: next };
      });
      return;
    }
    const s = rowToStatus(row);
    set((state) => {
      const list = state.statusesByTree[s.treeId] ?? [];
      const idx = list.findIndex((x) => x.id === s.id);
      const nextList =
        idx === -1
          ? sortByRank([...list, s])
          : sortByRank([...list.slice(0, idx), s, ...list.slice(idx + 1)]);
      return { statusesByTree: { ...state.statusesByTree, [s.treeId]: nextList } };
    });
  },
}));

/** Returns the status definitions for a tree, falling back to defaults
 *  if the tree has no rows yet (e.g. before initial load completes). */
export function getTreeStatuses(treeId: string | null | undefined): Array<{
  key: string;
  label: string;
  color: string;
}> {
  if (!treeId) return DEFAULT_TREE_STATUSES;
  const list = useTreeStatusesStore.getState().statusesByTree[treeId];
  if (!list || list.length === 0) return DEFAULT_TREE_STATUSES;
  return list;
}
