import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from './appStore';

export interface BacklogStatus {
  id: string;
  backlogId: string;
  key: string;
  label: string;
  color: string;
  rank: number;
}

/** Keys of the statuses that every backlog must always have and that cannot be edited or deleted. */
export const PINNED_STATUS_KEYS = ['not_started', 'done'] as const;
export type PinnedStatusKey = typeof PINNED_STATUS_KEYS[number];

export function isPinnedStatus(key: string): boolean {
  return (PINNED_STATUS_KEYS as readonly string[]).includes(key);
}

/** Hard-coded fallback shown while data is still loading and used when no
 *  ancestor backlog has a materialized status set. */
export const DEFAULT_STATUSES: Omit<BacklogStatus, 'id' | 'backlogId'>[] = [
  { key: 'not_started', label: 'Not Started', color: '#94a3b8', rank: 0 },
  { key: 'in_progress', label: 'In Progress', color: '#f97316', rank: 1 },
  { key: 'pending',     label: 'Pending',     color: '#93c5fd', rank: 2 },
  { key: 'blocked',     label: 'Blocked',     color: '#ef4444', rank: 3 },
  { key: 'done',        label: 'Done',        color: '#22c55e', rank: 4 },
];

/** Backward-compat alias — some legacy imports still reference this name. */
export const DEFAULT_TREE_STATUSES = DEFAULT_STATUSES;

interface BacklogStatusesState {
  /** backlogId -> ordered list (only materialized backlogs are present). */
  statusesByBacklog: Record<string, BacklogStatus[]>;
  loading: boolean;

  loadStatusesForOrgs: (orgIds: string[]) => Promise<void>;

  /** If backlog has no own rows, insert copies of the currently-effective set
   *  so future edits apply only to that backlog. Returns the new list. */
  materializeStatuses: (backlogId: string) => Promise<BacklogStatus[]>;

  createStatus: (backlogId: string, key: string, label: string, color: string) => Promise<void>;
  updateStatus: (backlogId: string, id: string, patch: Partial<Pick<BacklogStatus, 'label' | 'color'>>) => Promise<void>;
  deleteStatus: (backlogId: string, id: string) => Promise<void>;
  reorderStatuses: (backlogId: string, orderedIds: string[]) => Promise<void>;

  applyRealtimeStatus: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

function rowToStatus(row: Record<string, unknown>): BacklogStatus {
  return {
    id: row.id as string,
    backlogId: row.backlog_id as string,
    key: row.key as string,
    label: row.label as string,
    color: row.color as string,
    rank: (row.rank as number) ?? 0,
  };
}

function sortByRank(list: BacklogStatus[]): BacklogStatus[] {
  return [...list].sort((a, b) => a.rank - b.rank || a.key.localeCompare(b.key));
}

/** Walks up the backlog parent chain to find the nearest ancestor (including self)
 *  that has materialized status rows. Falls back to DEFAULT_STATUSES. */
export function getEffectiveStatuses(backlogId: string | null | undefined): BacklogStatus[] {
  if (!backlogId) return DEFAULT_STATUSES as unknown as BacklogStatus[];
  const state = useBacklogStatusesStore.getState();
  const backlogs = useAppStore.getState().backlogs;

  let currentId: string | null | undefined = backlogId;
  const guard = new Set<string>();
  while (currentId && !guard.has(currentId)) {
    guard.add(currentId);
    const list = state.statusesByBacklog[currentId];
    if (list && list.length > 0) return list;
    const bl = backlogs[currentId];
    currentId = bl?.parentId ?? null;
  }
  return DEFAULT_STATUSES.map((s, i) => ({
    id: `default-${s.key}`,
    backlogId: backlogId,
    ...s,
    rank: s.rank ?? i,
  }));
}

/** Convenience for legacy callers that only know the tree id — returns the
 *  effective statuses of the first root backlog of the tree. */
export function getEffectiveStatusesForTree(treeId: string | null | undefined): BacklogStatus[] {
  if (!treeId) return DEFAULT_STATUSES as unknown as BacklogStatus[];
  const tree = useAppStore.getState().backlogTrees[treeId];
  const rootId = tree?.rootBacklogIds?.[0];
  return getEffectiveStatuses(rootId ?? null);
}

/** Returns true if `backlogId` has its own materialized status rows. */
export function hasOwnStatuses(backlogId: string): boolean {
  const list = useBacklogStatusesStore.getState().statusesByBacklog[backlogId];
  return !!list && list.length > 0;
}

/** Returns the nearest ancestor backlog id that has own statuses (may be self),
 *  or null when nobody in the chain does. */
export function findInheritedFromBacklogId(backlogId: string): string | null {
  const state = useBacklogStatusesStore.getState();
  const backlogs = useAppStore.getState().backlogs;
  let currentId: string | null | undefined = backlogId;
  const guard = new Set<string>();
  while (currentId && !guard.has(currentId)) {
    guard.add(currentId);
    const list = state.statusesByBacklog[currentId];
    if (list && list.length > 0) return currentId;
    const bl = backlogs[currentId];
    currentId = bl?.parentId ?? null;
  }
  return null;
}

export const useBacklogStatusesStore = create<BacklogStatusesState>((set, get) => ({
  statusesByBacklog: {},
  loading: false,

  loadStatusesForOrgs: async (orgIds) => {
    if (orgIds.length === 0) return;
    set({ loading: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('backlog_statuses')
      .select('*, backlogs!inner(organization_id)')
      .in('backlogs.organization_id', orgIds);
    if (error) {
      console.error('loadStatusesForOrgs failed', error);
      set({ loading: false });
      return;
    }
    const grouped: Record<string, BacklogStatus[]> = {};
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const s = rowToStatus(row);
      (grouped[s.backlogId] ??= []).push(s);
    }
    for (const bid of Object.keys(grouped)) grouped[bid] = sortByRank(grouped[bid]);
    set((state) => ({
      loading: false,
      statusesByBacklog: { ...state.statusesByBacklog, ...grouped },
    }));
  },

  materializeStatuses: async (backlogId) => {
    const existing = get().statusesByBacklog[backlogId];
    if (existing && existing.length > 0) return existing;
    const effective = getEffectiveStatuses(backlogId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('backlog_statuses')
      .insert(
        effective.map((s) => ({
          backlog_id: backlogId,
          key: s.key,
          label: s.label,
          color: s.color,
          rank: s.rank,
        })),
      )
      .select();
    if (error) {
      console.error('materializeStatuses failed', error);
      return effective;
    }
    const list = sortByRank((data as Record<string, unknown>[]).map(rowToStatus));
    set((state) => ({
      statusesByBacklog: { ...state.statusesByBacklog, [backlogId]: list },
    }));
    return list;
  },

  createStatus: async (backlogId, key, label, color) => {
    // Ensure this backlog has its own set before adding.
    await get().materializeStatuses(backlogId);
    const existing = get().statusesByBacklog[backlogId] ?? [];
    const nextRank = existing.length > 0 ? Math.max(...existing.map((s) => s.rank)) + 1 : 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any)
      .from('backlog_statuses')
      .insert({ backlog_id: backlogId, key, label, color, rank: nextRank })
      .select()
      .single();
    if (error) {
      console.error('createStatus failed', error);
      return;
    }
    const s = rowToStatus(data as Record<string, unknown>);
    set((state) => ({
      statusesByBacklog: {
        ...state.statusesByBacklog,
        [backlogId]: sortByRank([...(state.statusesByBacklog[backlogId] ?? []), s]),
      },
    }));
  },

  updateStatus: async (backlogId, id, patch) => {
    // Materialize first so edits stay local to this backlog.
    await get().materializeStatuses(backlogId);
    // If the id looks like a default placeholder, resolve to real id in this backlog by key.
    const list = get().statusesByBacklog[backlogId] ?? [];
    const status = list.find((s) => s.id === id);
    if (!status) return;
    if (isPinnedStatus(status.key)) return;

    set((state) => {
      const cur = state.statusesByBacklog[backlogId] ?? [];
      const idx = cur.findIndex((s) => s.id === id);
      if (idx === -1) return state;
      const updated = { ...cur[idx], ...patch };
      return {
        statusesByBacklog: {
          ...state.statusesByBacklog,
          [backlogId]: sortByRank([...cur.slice(0, idx), updated, ...cur.slice(idx + 1)]),
        },
      };
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('backlog_statuses')
      .update(patch)
      .eq('id', id);
    if (error) console.error('updateStatus failed', error);
  },

  deleteStatus: async (backlogId, id) => {
    await get().materializeStatuses(backlogId);
    const list = get().statusesByBacklog[backlogId] ?? [];
    const status = list.find((s) => s.id === id);
    if (!status) return;
    if (isPinnedStatus(status.key)) return;

    // Remap any work items in this backlog subtree that use this status → not_started.
    try {
      const appState = useAppStore.getState();
      const backlogIdSet = new Set<string>();
      const walk = (bid: string) => {
        backlogIdSet.add(bid);
        const bl = appState.backlogs[bid];
        bl?.childrenIds?.forEach(walk);
      };
      walk(backlogId);
      for (const wi of Object.values(appState.workItems)) {
        if (wi.status !== status.key) continue;
        const assignedBl = Object.values(wi.backlogAssignments).find((b) => backlogIdSet.has(b));
        if (assignedBl) {
          appState.setWorkItemStatus(wi.id, 'not_started');
        }
      }
    } catch (err) {
      console.error('remap-on-delete-status failed', err);
    }

    set((state) => ({
      statusesByBacklog: {
        ...state.statusesByBacklog,
        [backlogId]: (state.statusesByBacklog[backlogId] ?? []).filter((s) => s.id !== id),
      },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('backlog_statuses').delete().eq('id', id);
    if (error) console.error('deleteStatus failed', error);
  },

  reorderStatuses: async (backlogId, orderedIds) => {
    await get().materializeStatuses(backlogId);
    const list = get().statusesByBacklog[backlogId] ?? [];
    const byId = new Map(list.map((s) => [s.id, s]));
    const reordered = orderedIds
      .map((id, idx) => {
        const s = byId.get(id);
        return s ? { ...s, rank: idx } : null;
      })
      .filter((x): x is BacklogStatus => !!x);
    set((state) => ({
      statusesByBacklog: { ...state.statusesByBacklog, [backlogId]: reordered },
    }));
    await Promise.all(
      reordered.map((s) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any).from('backlog_statuses').update({ rank: s.rank }).eq('id', s.id),
      ),
    );
  },

  applyRealtimeStatus: (event, row) => {
    if (event === 'DELETE') {
      const id = row.id as string;
      set((state) => {
        const next = { ...state.statusesByBacklog };
        for (const [bid, list] of Object.entries(next)) {
          if (list.some((s) => s.id === id)) {
            next[bid] = list.filter((s) => s.id !== id);
            break;
          }
        }
        return { statusesByBacklog: next };
      });
      return;
    }
    const s = rowToStatus(row);
    set((state) => {
      const list = state.statusesByBacklog[s.backlogId] ?? [];
      const idx = list.findIndex((x) => x.id === s.id);
      const nextList =
        idx === -1
          ? sortByRank([...list, s])
          : sortByRank([...list.slice(0, idx), s, ...list.slice(idx + 1)]);
      return { statusesByBacklog: { ...state.statusesByBacklog, [s.backlogId]: nextList } };
    });
  },
}));
