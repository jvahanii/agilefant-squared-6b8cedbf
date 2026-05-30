import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

/** YYYY-MM key, UTC. */
export type MonthKey = string;
export type MonthlyMap = Record<MonthKey, number>;

export interface WorkItemFinancials {
  id: string;
  workItemId: string;
  organizationId: string;
  /** Plan: YYYY-MM -> savings amount for that month. */
  savingsByMonth: MonthlyMap;
  /** Plan: YYYY-MM -> income amount for that month. */
  incomeByMonth: MonthlyMap;
  /** Actual: YYYY-MM -> realized savings amount for past months. */
  actualSavingsByMonth: MonthlyMap;
  /** Actual: YYYY-MM -> realized income amount for past months. */
  actualIncomeByMonth: MonthlyMap;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

interface FinancialsState {
  /** workItemId -> entry */
  byWorkItem: Record<string, WorkItemFinancials>;
  loading: boolean;

  load: (orgIds: string[]) => Promise<void>;
  upsert: (
    workItemId: string,
    organizationId: string,
    patch: {
      savingsByMonth: MonthlyMap;
      incomeByMonth: MonthlyMap;
      actualSavingsByMonth: MonthlyMap;
      actualIncomeByMonth: MonthlyMap;
      currency: string;
    },
  ) => Promise<void>;
  remove: (workItemId: string) => Promise<void>;
  getFor: (workItemId: string) => WorkItemFinancials | undefined;
  applyRealtime: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

function sanitizeMap(raw: unknown): MonthlyMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: MonthlyMap = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(k)) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

function rowToEntry(row: Record<string, unknown>): WorkItemFinancials {
  return {
    id: row.id as string,
    workItemId: row.work_item_id as string,
    organizationId: row.organization_id as string,
    savingsByMonth: sanitizeMap(row.savings_by_month),
    incomeByMonth: sanitizeMap(row.income_by_month),
    actualSavingsByMonth: sanitizeMap(row.actual_savings_by_month),
    actualIncomeByMonth: sanitizeMap(row.actual_income_by_month),
    currency: (row.currency as string) ?? 'EUR',
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

export const useFinancialsStore = create<FinancialsState>((set, get) => ({
  byWorkItem: {},
  loading: false,

  load: async (orgIds) => {
    if (orgIds.length === 0) return;
    set({ loading: true });
    const { data, error } = await supabase
      .from('work_item_financials' as any)
      .select('*')
      .in('organization_id', orgIds);
    if (error) {
      console.error('financialsStore.load failed', error);
      set({ loading: false });
      return;
    }
    const byWorkItem: Record<string, WorkItemFinancials> = {};
    for (const row of ((data ?? []) as unknown as Record<string, unknown>[])) {
      const e = rowToEntry(row);
      byWorkItem[e.workItemId] = e;
    }
    set({ byWorkItem, loading: false });
  },

  upsert: async (workItemId, organizationId, patch) => {
    const prev = get().byWorkItem[workItemId];
    const savingsByMonth = sanitizeMap(patch.savingsByMonth);
    const incomeByMonth = sanitizeMap(patch.incomeByMonth);
    const actualSavingsByMonth = sanitizeMap(patch.actualSavingsByMonth);
    const actualIncomeByMonth = sanitizeMap(patch.actualIncomeByMonth);
    set((s) => ({
      byWorkItem: {
        ...s.byWorkItem,
        [workItemId]: {
          id: prev?.id ?? `optimistic-${workItemId}`,
          workItemId,
          organizationId,
          savingsByMonth,
          incomeByMonth,
          actualSavingsByMonth,
          actualIncomeByMonth,
          currency: patch.currency,
          createdAt: prev?.createdAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
    }));

    const { data, error } = await supabase
      .from('work_item_financials' as any)
      .upsert(
        {
          work_item_id: workItemId,
          organization_id: organizationId,
          savings_by_month: savingsByMonth,
          income_by_month: incomeByMonth,
          actual_savings_by_month: actualSavingsByMonth,
          actual_income_by_month: actualIncomeByMonth,
          currency: patch.currency,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'work_item_id' },
      )
      .select('*')
      .single();
    if (error) {
      console.error('financialsStore.upsert failed', error);
      set((s) => {
        const next = { ...s.byWorkItem };
        if (prev) next[workItemId] = prev;
        else delete next[workItemId];
        return { byWorkItem: next };
      });
      return;
    }
    if (data) {
      const e = rowToEntry((data as unknown) as Record<string, unknown>);
      set((s) => ({ byWorkItem: { ...s.byWorkItem, [workItemId]: e } }));
    }
  },

  remove: async (workItemId) => {
    const prev = get().byWorkItem[workItemId];
    if (!prev) return;
    set((s) => {
      const next = { ...s.byWorkItem };
      delete next[workItemId];
      return { byWorkItem: next };
    });
    const { error } = await supabase
      .from('work_item_financials' as any)
      .delete()
      .eq('work_item_id', workItemId);
    if (error) {
      console.error('financialsStore.remove failed', error);
      set((s) => ({ byWorkItem: { ...s.byWorkItem, [workItemId]: prev } }));
    }
  },

  getFor: (workItemId) => get().byWorkItem[workItemId],

  applyRealtime: (event, row) => {
    if (event === 'DELETE') {
      const workItemId = row.work_item_id as string;
      set((s) => {
        if (!s.byWorkItem[workItemId]) return s;
        const next = { ...s.byWorkItem };
        delete next[workItemId];
        return { byWorkItem: next };
      });
      return;
    }
    const e = rowToEntry(row);
    set((s) => ({ byWorkItem: { ...s.byWorkItem, [e.workItemId]: e } }));
  },
}));

/** Sum of all monthly amounts in a map. */
export function sumMap(m: MonthlyMap | undefined): number {
  if (!m) return 0;
  let total = 0;
  for (const v of Object.values(m)) total += v;
  return total;
}

/** Format a currency total in a compact form. */
export function formatCurrencyCompact(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) return `${currency} ${(amount / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${currency} ${(amount / 1_000).toFixed(1)}k`;
  return `${currency} ${amount.toFixed(0)}`;
}
