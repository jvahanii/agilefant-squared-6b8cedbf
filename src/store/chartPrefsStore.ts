import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

export type ChartScopeKind = 'tree' | 'backlog' | 'work_item';
export type ChartMetric = 'count' | 'points';

interface State {
  /** key = `${kind}:${id}` */
  prefs: Record<string, ChartMetric>;
  loaded: boolean;
  loadPrefs: (userId: string) => Promise<void>;
  getMetric: (kind: ChartScopeKind, id: string) => ChartMetric | undefined;
  setMetric: (
    userId: string,
    orgId: string,
    kind: ChartScopeKind,
    id: string,
    metric: ChartMetric,
  ) => Promise<void>;
}

const k = (kind: ChartScopeKind, id: string) => `${kind}:${id}`;

export const useChartPrefsStore = create<State>((set, get) => ({
  prefs: {},
  loaded: false,

  loadPrefs: async (userId: string) => {
    const { data } = await (supabase as any)
      .from('work_item_chart_prefs')
      .select('scope_kind, scope_id, metric')
      .eq('user_id', userId);
    const prefs: Record<string, ChartMetric> = {};
    for (const row of (data as { scope_kind: ChartScopeKind; scope_id: string; metric: ChartMetric }[] | null) ?? []) {
      prefs[k(row.scope_kind, row.scope_id)] = row.metric;
    }
    set({ prefs, loaded: true });
  },

  getMetric: (kind, id) => get().prefs[k(kind, id)],

  setMetric: async (userId, orgId, kind, id, metric) => {
    set((s) => ({ prefs: { ...s.prefs, [k(kind, id)]: metric } }));
    await (supabase as any)
      .from('work_item_chart_prefs')
      .upsert(
        {
          user_id: userId,
          organization_id: orgId,
          scope_kind: kind,
          scope_id: id,
          metric,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,scope_kind,scope_id' },
      );
  },
}));
