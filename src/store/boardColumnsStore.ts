import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { getTreeStatuses } from './treeStatusesStore';
import { useAppStore } from './appStore';

export interface BoardColumn {
  id: string;
  backlogId: string;
  statusKey: string;
  label: string;
  rank: number;
}

interface BoardColumnsState {
  /** backlogId -> ordered list */
  columnsByBacklog: Record<string, BoardColumn[]>;
  /** backlogIds we've already attempted to load/seed, so we don't re-run */
  loadedBacklogIds: Set<string>;

  loadForBacklog: (backlogId: string, treeId: string) => Promise<void>;
  createColumn: (backlogId: string, statusKey: string, label: string) => Promise<void>;
  renameColumn: (id: string, label: string) => Promise<void>;
  deleteColumn: (id: string) => Promise<void>;
  reorderColumns: (backlogId: string, orderedIds: string[]) => Promise<void>;

  applyRealtime: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

function rowToColumn(row: Record<string, unknown>): BoardColumn {
  return {
    id: row.id as string,
    backlogId: row.backlog_id as string,
    statusKey: row.status_key as string,
    label: row.label as string,
    rank: (row.rank as number) ?? 0,
  };
}

function sortByRank(list: BoardColumn[]): BoardColumn[] {
  return [...list].sort((a, b) => a.rank - b.rank || a.statusKey.localeCompare(b.statusKey));
}

/** LocalStorage keys used by the old per-backlog column order/label overrides. */
function legacyOrderKey(backlogId: string) {
  return `board-column-order:${backlogId}`;
}
function legacyLabelKey(backlogId: string) {
  return `board-column-labels:${backlogId}`;
}

export const useBoardColumnsStore = create<BoardColumnsState>((set, get) => ({
  columnsByBacklog: {},
  loadedBacklogIds: new Set<string>(),

  loadForBacklog: async (backlogId, treeId) => {
    if (get().loadedBacklogIds.has(backlogId)) return;
    // Mark early to avoid concurrent duplicate loads.
    set((state) => {
      const next = new Set(state.loadedBacklogIds);
      next.add(backlogId);
      return { loadedBacklogIds: next };
    });

    const { data, error } = await supabase
      .from('board_columns')
      .select('*')
      .eq('backlog_id', backlogId);

    if (error) {
      console.error('loadForBacklog failed', error);
      return;
    }

    const rows = (data ?? []) as unknown as Record<string, unknown>[];

    if (rows.length > 0) {
      const list = sortByRank(rows.map(rowToColumn));
      set((state) => ({
        columnsByBacklog: { ...state.columnsByBacklog, [backlogId]: list },
      }));
      return;
    }

    // Empty: seed from tree statuses, honoring legacy per-backlog state.
    const statuses = getTreeStatuses(treeId);
    if (statuses.length === 0) return;

    // Legacy hidden keys stored on the backlog row (still readable for one release).
    const backlog = useAppStore.getState().backlogs[backlogId];
    const hiddenKeys = new Set(backlog?.boardHiddenStatusKeys ?? []);

    // Legacy order + label overrides from localStorage.
    let legacyOrder: string[] = [];
    let legacyLabels: Record<string, string> = {};
    try {
      const raw = localStorage.getItem(legacyOrderKey(backlogId));
      if (raw) legacyOrder = JSON.parse(raw) as string[];
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(legacyLabelKey(backlogId));
      if (raw) legacyLabels = JSON.parse(raw) as Record<string, string>;
    } catch { /* ignore */ }

    const visible = statuses.filter((s) => !hiddenKeys.has(s.key));
    const keySet = new Set(visible.map((s) => s.key));
    const orderedKeys = [
      ...legacyOrder.filter((k) => keySet.has(k)),
      ...visible.filter((s) => !legacyOrder.includes(s.key)).map((s) => s.key),
    ];

    const byKey = new Map(visible.map((s) => [s.key, s]));
    const seeds = orderedKeys.map((key, idx) => {
      const s = byKey.get(key)!;
      return {
        backlog_id: backlogId,
        status_key: key,
        label: legacyLabels[key] || s.label,
        rank: idx,
      };
    });

    if (seeds.length === 0) return;

    const { data: inserted, error: insertErr } = await supabase
      .from('board_columns')
      .insert(seeds)
      .select();

    if (insertErr) {
      console.error('board_columns seed failed', insertErr);
      return;
    }

    const list = sortByRank(((inserted ?? []) as unknown as Record<string, unknown>[]).map(rowToColumn));
    set((state) => ({
      columnsByBacklog: { ...state.columnsByBacklog, [backlogId]: list },
    }));

    // Clear legacy localStorage entries now that we've migrated.
    try { localStorage.removeItem(legacyOrderKey(backlogId)); } catch { /* ignore */ }
    try { localStorage.removeItem(legacyLabelKey(backlogId)); } catch { /* ignore */ }
  },

  createColumn: async (backlogId, statusKey, label) => {
    const existing = get().columnsByBacklog[backlogId] ?? [];
    const nextRank = existing.length > 0 ? Math.max(...existing.map((c) => c.rank)) + 1 : 0;
    const { data, error } = await supabase
      .from('board_columns')
      .insert({ backlog_id: backlogId, status_key: statusKey, label, rank: nextRank })
      .select()
      .single();
    if (error) {
      console.error('createColumn failed', error);
      return;
    }
    const col = rowToColumn(data as unknown as Record<string, unknown>);
    set((state) => ({
      columnsByBacklog: {
        ...state.columnsByBacklog,
        [backlogId]: sortByRank([...(state.columnsByBacklog[backlogId] ?? []), col]),
      },
    }));
  },

  renameColumn: async (id, label) => {
    set((state) => {
      const next = { ...state.columnsByBacklog };
      for (const [bid, list] of Object.entries(next)) {
        const idx = list.findIndex((c) => c.id === id);
        if (idx !== -1) {
          next[bid] = [...list.slice(0, idx), { ...list[idx], label }, ...list.slice(idx + 1)];
          break;
        }
      }
      return { columnsByBacklog: next };
    });
    const { error } = await supabase.from('board_columns').update({ label }).eq('id', id);
    if (error) console.error('renameColumn failed', error);
  },

  deleteColumn: async (id) => {
    set((state) => {
      const next = { ...state.columnsByBacklog };
      for (const [bid, list] of Object.entries(next)) {
        if (list.some((c) => c.id === id)) {
          next[bid] = list.filter((c) => c.id !== id);
          break;
        }
      }
      return { columnsByBacklog: next };
    });
    const { error } = await supabase.from('board_columns').delete().eq('id', id);
    if (error) console.error('deleteColumn failed', error);
  },

  reorderColumns: async (backlogId, orderedIds) => {
    const list = get().columnsByBacklog[backlogId] ?? [];
    const byId = new Map(list.map((c) => [c.id, c]));
    const reordered = orderedIds
      .map((id, idx) => {
        const c = byId.get(id);
        return c ? { ...c, rank: idx } : null;
      })
      .filter((x): x is BoardColumn => !!x);

    set((state) => ({
      columnsByBacklog: { ...state.columnsByBacklog, [backlogId]: reordered },
    }));

    await Promise.all(
      reordered.map((c) =>
        supabase.from('board_columns').update({ rank: c.rank }).eq('id', c.id),
      ),
    );
  },

  applyRealtime: (event, row) => {
    if (event === 'DELETE') {
      const id = row.id as string;
      set((state) => {
        const next = { ...state.columnsByBacklog };
        for (const [bid, list] of Object.entries(next)) {
          if (list.some((c) => c.id === id)) {
            next[bid] = list.filter((c) => c.id !== id);
            break;
          }
        }
        return { columnsByBacklog: next };
      });
      return;
    }
    const col = rowToColumn(row);
    set((state) => {
      const list = state.columnsByBacklog[col.backlogId] ?? [];
      const idx = list.findIndex((c) => c.id === col.id);
      const nextList =
        idx === -1
          ? sortByRank([...list, col])
          : sortByRank([...list.slice(0, idx), col, ...list.slice(idx + 1)]);
      return { columnsByBacklog: { ...state.columnsByBacklog, [col.backlogId]: nextList } };
    });
  },
}));
