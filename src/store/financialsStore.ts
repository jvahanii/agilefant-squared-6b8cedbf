import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

export interface WorkItemFinancials {
  id: string;
  workItemId: string;
  organizationId: string;
  monthlySavings: number;
  monthlyIncome: number;
  currency: string;
  /** ISO timestamp – used as the starting month for cumulative-flow accrual. */
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
    patch: { monthlySavings: number; monthlyIncome: number; currency: string },
  ) => Promise<void>;
  remove: (workItemId: string) => Promise<void>;
  getFor: (workItemId: string) => WorkItemFinancials | undefined;
  applyRealtime: (event: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

function rowToEntry(row: Record<string, unknown>): WorkItemFinancials {
  return {
    id: row.id as string,
    workItemId: row.work_item_id as string,
    organizationId: row.organization_id as string,
    monthlySavings: Number(row.monthly_savings ?? 0),
    monthlyIncome: Number(row.monthly_income ?? 0),
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
    // Optimistic
    set((s) => ({
      byWorkItem: {
        ...s.byWorkItem,
        [workItemId]: {
          id: prev?.id ?? `optimistic-${workItemId}`,
          workItemId,
          organizationId,
          monthlySavings: patch.monthlySavings,
          monthlyIncome: patch.monthlyIncome,
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
          monthly_savings: patch.monthlySavings,
          monthly_income: patch.monthlyIncome,
          currency: patch.currency,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'work_item_id' },
      )
      .select('*')
      .single();
    if (error) {
      console.error('financialsStore.upsert failed', error);
      // Roll back
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
