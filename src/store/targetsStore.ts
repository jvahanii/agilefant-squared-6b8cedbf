import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { paginateSelect } from '@/integrations/supabase/pagination';

export type TargetMetric = 'savings' | 'income' | 'both';

export interface FinancialTarget {
  id: string;
  treeId: string;
  organizationId: string;
  year: number;
  metric: TargetMetric;
  amount: number;
  currency: string;
}

function keyOf(treeId: string, year: number, metric: TargetMetric): string {
  return `${treeId}::${year}::${metric}`;
}

interface TargetsState {
  byKey: Record<string, FinancialTarget>;
  load: (orgIds: string[]) => Promise<void>;
  upsert: (
    treeId: string,
    organizationId: string,
    year: number,
    metric: TargetMetric,
    amount: number,
    currency: string,
  ) => Promise<void>;
  remove: (treeId: string, year: number, metric: TargetMetric) => Promise<void>;
  getFor: (treeId: string, year: number, metric: TargetMetric) => FinancialTarget | undefined;
  applyRealtime: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

function rowToTarget(row: Record<string, unknown>): FinancialTarget {
  return {
    id: row.id as string,
    treeId: row.tree_id as string,
    organizationId: row.organization_id as string,
    year: Number(row.year),
    metric: ((row.metric as string) === 'income' ? 'income' : 'savings') as TargetMetric,
    amount: Number(row.amount) || 0,
    currency: (row.currency as string) ?? 'EUR',
  };
}

export const useTargetsStore = create<TargetsState>((set, get) => ({
  byKey: {},

  load: async (orgIds) => {
    if (orgIds.length === 0) return;
    const { data, error } = await paginateSelect<Record<string, unknown>>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('tree_financial_targets' as any).select('*') as any)
        .in('organization_id', orgIds)
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (error) {
      console.error('targetsStore.load failed', error);
      return;
    }
    const byKey: Record<string, FinancialTarget> = {};
    for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
      const t = rowToTarget(row);
      byKey[keyOf(t.treeId, t.year, t.metric)] = t;
    }
    set({ byKey });
  },

  upsert: async (treeId, organizationId, year, metric, amount, currency) => {
    const k = keyOf(treeId, year, metric);
    const prev = get().byKey[k];
    set((s) => ({
      byKey: {
        ...s.byKey,
        [k]: {
          id: prev?.id ?? `optimistic-${k}`,
          treeId,
          organizationId,
          year,
          metric,
          amount,
          currency,
        },
      },
    }));
    const { data, error } = await supabase
      .from('tree_financial_targets' as any)
      .upsert(
        {
          tree_id: treeId,
          organization_id: organizationId,
          year,
          metric,
          amount,
          currency,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'tree_id,year,metric' },
      )
      .select('*')
      .single();
    if (error) {
      console.error('targetsStore.upsert failed', error);
      set((s) => {
        const next = { ...s.byKey };
        if (prev) next[k] = prev;
        else delete next[k];
        return { byKey: next };
      });
      return;
    }
    if (data) {
      const t = rowToTarget(data as unknown as Record<string, unknown>);
      set((s) => ({ byKey: { ...s.byKey, [keyOf(t.treeId, t.year, t.metric)]: t } }));
    }
  },

  remove: async (treeId, year, metric) => {
    const k = keyOf(treeId, year, metric);
    const prev = get().byKey[k];
    if (!prev) return;
    set((s) => {
      const next = { ...s.byKey };
      delete next[k];
      return { byKey: next };
    });
    const { error } = await supabase
      .from('tree_financial_targets' as any)
      .delete()
      .eq('tree_id', treeId)
      .eq('year', year)
      .eq('metric', metric);
    if (error) {
      console.error('targetsStore.remove failed', error);
      set((s) => ({ byKey: { ...s.byKey, [k]: prev } }));
    }
  },

  getFor: (treeId, year, metric) => get().byKey[keyOf(treeId, year, metric)],

  applyRealtime: (event, row) => {
    if (event === 'DELETE') {
      const t = rowToTarget(row);
      const k = keyOf(t.treeId, t.year, t.metric);
      set((s) => {
        if (!s.byKey[k]) return s;
        const next = { ...s.byKey };
        delete next[k];
        return { byKey: next };
      });
      return;
    }
    const t = rowToTarget(row);
    set((s) => ({ byKey: { ...s.byKey, [keyOf(t.treeId, t.year, t.metric)]: t } }));
  },
}));
