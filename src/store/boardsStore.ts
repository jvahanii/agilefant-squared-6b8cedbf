import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import type { WorkItemStatus } from '@/types/models';

export type BoardScope = 'tree' | 'custom';

export interface BoardColumnRule {
  // Match any work item whose status is in this set.
  statuses?: WorkItemStatus[];
  // Match items that have any of these label IDs assigned (future).
  labelIds?: string[];
  // Match items assigned to any of these teams (future).
  teamIds?: string[];
}

export interface BoardColumn {
  id: string;
  boardId: string;
  organizationId: string;
  name: string;
  color: string;
  rank: number;
  rule: BoardColumnRule;
  isUnmatched: boolean;
}

export interface BoardFilter {
  // For 'custom' scope: restrict to these tree IDs (empty = all accessible).
  treeIds?: string[];
  // For 'custom' scope: restrict to these statuses.
  statuses?: WorkItemStatus[];
  // For 'custom' scope: free-text title contains.
  text?: string;
}

export interface Board {
  id: string;
  organizationId: string;
  name: string;
  scope: BoardScope;
  treeId: string | null;
  filter: BoardFilter;
  rank: number;
  createdAt: string;
  updatedAt: string;
}

export interface BoardCardRank {
  id: string;
  boardId: string;
  columnId: string;
  workItemId: string;
  organizationId: string;
  rank: number;
}

interface BoardsState {
  boards: Record<string, Board>;
  columns: Record<string, BoardColumn>; // keyed by column id
  cardRanks: Record<string, BoardCardRank>; // keyed by id
  loaded: boolean;
  loading: boolean;

  load: (orgIds: string[]) => Promise<void>;

  createBoard: (input: {
    organizationId: string;
    name: string;
    scope: BoardScope;
    treeId?: string | null;
    filter?: BoardFilter;
  }) => Promise<Board | null>;
  updateBoard: (id: string, patch: Partial<Pick<Board, 'name' | 'filter' | 'treeId' | 'scope'>>) => Promise<void>;
  deleteBoard: (id: string) => Promise<void>;

  createColumn: (input: {
    boardId: string;
    organizationId: string;
    name: string;
    color?: string;
    rule?: BoardColumnRule;
    isUnmatched?: boolean;
  }) => Promise<BoardColumn | null>;
  updateColumn: (id: string, patch: Partial<Pick<BoardColumn, 'name' | 'color' | 'rule' | 'isUnmatched' | 'rank'>>) => Promise<void>;
  deleteColumn: (id: string) => Promise<void>;
  reorderColumns: (boardId: string, orderedIds: string[]) => Promise<void>;

  setCardRank: (input: {
    boardId: string;
    columnId: string;
    workItemId: string;
    organizationId: string;
    rank: number;
  }) => Promise<void>;
  removeCardRanksForBoardColumn: (boardId: string, columnId: string, workItemId: string) => Promise<void>;

  applyRealtimeBoard: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: any) => void;
  applyRealtimeColumn: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: any) => void;
  applyRealtimeCardRank: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: any) => void;
}

function mapBoard(row: any): Board {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    scope: row.scope,
    treeId: row.tree_id ?? null,
    filter: row.filter_json ?? {},
    rank: row.rank ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
function mapColumn(row: any): BoardColumn {
  return {
    id: row.id,
    boardId: row.board_id,
    organizationId: row.organization_id,
    name: row.name,
    color: row.color ?? '#94a3b8',
    rank: row.rank ?? 0,
    rule: row.rule_json ?? {},
    isUnmatched: !!row.is_unmatched,
  };
}
function mapRank(row: any): BoardCardRank {
  return {
    id: row.id,
    boardId: row.board_id,
    columnId: row.column_id,
    workItemId: row.work_item_id,
    organizationId: row.organization_id,
    rank: row.rank ?? 0,
  };
}

export const useBoardsStore = create<BoardsState>((set, get) => ({
  boards: {},
  columns: {},
  cardRanks: {},
  loaded: false,
  loading: false,

  load: async (orgIds) => {
    if (orgIds.length === 0) {
      set({ boards: {}, columns: {}, cardRanks: {}, loaded: true });
      return;
    }
    set({ loading: true });
    const [{ data: bRows }, { data: cRows }, { data: rRows }] = await Promise.all([
      supabase.from('boards').select('*').in('organization_id', orgIds),
      supabase.from('board_columns').select('*').in('organization_id', orgIds),
      supabase.from('board_card_ranks').select('*').in('organization_id', orgIds),
    ]);
    const boards: Record<string, Board> = {};
    (bRows ?? []).forEach((r) => { boards[r.id] = mapBoard(r); });
    const columns: Record<string, BoardColumn> = {};
    (cRows ?? []).forEach((r) => { columns[r.id] = mapColumn(r); });
    const cardRanks: Record<string, BoardCardRank> = {};
    (rRows ?? []).forEach((r) => { cardRanks[r.id] = mapRank(r); });
    set({ boards, columns, cardRanks, loaded: true, loading: false });
  },

  createBoard: async (input) => {
    const nextRank = Math.max(0, ...Object.values(get().boards).filter(b => b.organizationId === input.organizationId).map(b => b.rank)) + 1;
    const { data, error } = await supabase
      .from('boards')
      .insert({
        organization_id: input.organizationId,
        name: input.name,
        scope: input.scope,
        tree_id: input.treeId ?? null,
        filter_json: (input.filter ?? {}) as any,
        rank: nextRank,
      } as any)
      .select('*')
      .single();

    if (error || !data) return null;
    const board = mapBoard(data);
    set((s) => ({ boards: { ...s.boards, [board.id]: board } }));
    return board;
  },

  updateBoard: async (id, patch) => {
    const existing = get().boards[id];
    if (!existing) return;
    const next: Board = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.filter !== undefined ? { filter: patch.filter } : {}),
      ...(patch.treeId !== undefined ? { treeId: patch.treeId } : {}),
      ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
    };
    set((s) => ({ boards: { ...s.boards, [id]: next } }));
    await supabase.from('boards').update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.filter !== undefined ? { filter_json: patch.filter as any } : {}),
      ...(patch.treeId !== undefined ? { tree_id: patch.treeId } : {}),
      ...(patch.scope !== undefined ? { scope: patch.scope } : {}),
      updated_at: new Date().toISOString(),
    } as any).eq('id', id);

  },

  deleteBoard: async (id) => {
    set((s) => {
      const boards = { ...s.boards }; delete boards[id];
      const columns: Record<string, BoardColumn> = {};
      Object.values(s.columns).forEach((c) => { if (c.boardId !== id) columns[c.id] = c; });
      const cardRanks: Record<string, BoardCardRank> = {};
      Object.values(s.cardRanks).forEach((c) => { if (c.boardId !== id) cardRanks[c.id] = c; });
      return { boards, columns, cardRanks };
    });
    await supabase.from('boards').delete().eq('id', id);
  },

  createColumn: async (input) => {
    const cols = Object.values(get().columns).filter((c) => c.boardId === input.boardId);
    const nextRank = (cols.reduce((m, c) => Math.max(m, c.rank), -1)) + 1;
    const { data, error } = await supabase
      .from('board_columns')
      .insert({
        board_id: input.boardId,
        organization_id: input.organizationId,
        name: input.name,
        color: input.color ?? '#94a3b8',
        rule_json: (input.rule ?? {}) as any,
        rank: nextRank,
        is_unmatched: !!input.isUnmatched,
      } as any)
      .select('*')
      .single();

    if (error || !data) return null;
    const col = mapColumn(data);
    set((s) => ({ columns: { ...s.columns, [col.id]: col } }));
    return col;
  },

  updateColumn: async (id, patch) => {
    const existing = get().columns[id];
    if (!existing) return;
    const next: BoardColumn = { ...existing, ...patch };
    set((s) => ({ columns: { ...s.columns, [id]: next } }));
    await supabase.from('board_columns').update({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.rule !== undefined ? { rule_json: patch.rule as any } : {}),
      ...(patch.isUnmatched !== undefined ? { is_unmatched: patch.isUnmatched } : {}),
      ...(patch.rank !== undefined ? { rank: patch.rank } : {}),
      updated_at: new Date().toISOString(),
    } as any).eq('id', id);

  },

  deleteColumn: async (id) => {
    set((s) => {
      const columns = { ...s.columns }; delete columns[id];
      const cardRanks: Record<string, BoardCardRank> = {};
      Object.values(s.cardRanks).forEach((c) => { if (c.columnId !== id) cardRanks[c.id] = c; });
      return { columns, cardRanks };
    });
    await supabase.from('board_columns').delete().eq('id', id);
  },

  reorderColumns: async (boardId, orderedIds) => {
    const updates: { id: string; rank: number }[] = orderedIds.map((id, idx) => ({ id, rank: idx }));
    set((s) => {
      const columns = { ...s.columns };
      updates.forEach(({ id, rank }) => {
        if (columns[id]) columns[id] = { ...columns[id], rank };
      });
      return { columns };
    });
    await Promise.all(
      updates.map((u) =>
        supabase.from('board_columns').update({ rank: u.rank, updated_at: new Date().toISOString() }).eq('id', u.id),
      ),
    );
  },

  setCardRank: async (input) => {
    // Upsert via unique (board_id,column_id,work_item_id).
    const { data, error } = await supabase
      .from('board_card_ranks')
      .upsert(
        {
          board_id: input.boardId,
          column_id: input.columnId,
          work_item_id: input.workItemId,
          organization_id: input.organizationId,
          rank: input.rank,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'board_id,column_id,work_item_id' },
      )
      .select('*')
      .single();
    if (error || !data) return;
    const r = mapRank(data);
    set((s) => ({ cardRanks: { ...s.cardRanks, [r.id]: r } }));
  },

  removeCardRanksForBoardColumn: async (boardId, columnId, workItemId) => {
    const toRemove = Object.values(get().cardRanks).filter(
      (r) => r.boardId === boardId && r.columnId === columnId && r.workItemId === workItemId,
    );
    set((s) => {
      const next = { ...s.cardRanks };
      toRemove.forEach((r) => delete next[r.id]);
      return { cardRanks: next };
    });
    await supabase
      .from('board_card_ranks')
      .delete()
      .eq('board_id', boardId)
      .eq('column_id', columnId)
      .eq('work_item_id', workItemId);
  },

  applyRealtimeBoard: (event, row) => {
    set((s) => {
      const boards = { ...s.boards };
      if (event === 'DELETE') {
        delete boards[row.id];
      } else {
        boards[row.id] = mapBoard(row);
      }
      return { boards };
    });
  },
  applyRealtimeColumn: (event, row) => {
    set((s) => {
      const columns = { ...s.columns };
      if (event === 'DELETE') {
        delete columns[row.id];
      } else {
        columns[row.id] = mapColumn(row);
      }
      return { columns };
    });
  },
  applyRealtimeCardRank: (event, row) => {
    set((s) => {
      const cardRanks = { ...s.cardRanks };
      if (event === 'DELETE') {
        delete cardRanks[row.id];
      } else {
        cardRanks[row.id] = mapRank(row);
      }
      return { cardRanks };
    });
  },
}));

/** Return the first column that matches the given item, or the unmatched column, or null. */
export function classifyItemIntoColumn(
  itemStatus: WorkItemStatus,
  columns: BoardColumn[],
): BoardColumn | null {
  const ordered = [...columns].sort((a, b) => a.rank - b.rank);
  for (const c of ordered) {
    if (c.isUnmatched) continue;
    const statuses = c.rule.statuses ?? [];
    if (statuses.length === 0) continue;
    if (statuses.includes(itemStatus)) return c;
  }
  return ordered.find((c) => c.isUnmatched) ?? null;
}
