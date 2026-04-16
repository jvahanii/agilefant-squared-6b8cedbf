import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

interface OrgSettings {
  timeLoggingEnabled: boolean;
  pointsEnabled: boolean;
}

interface OrgSettingsState {
  settings: Record<string, OrgSettings>; // keyed by orgId
  loading: boolean;

  loadSettings: (orgId: string) => Promise<void>;
  setTimeLoggingEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  setPointsEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  applyRealtimeSettings: (payload: { eventType: string; new: any; old: any }) => void;
}

const defaults: OrgSettings = { timeLoggingEnabled: false, pointsEnabled: false };

export const useOrgSettingsStore = create<OrgSettingsState>((set, get) => ({
  settings: {},
  loading: false,

  loadSettings: async (orgId: string) => {
    set({ loading: true });
    const { data } = await supabase
      .from('organization_settings')
      .select('organization_id, time_logging_enabled, points_enabled')
      .eq('organization_id', orgId)
      .maybeSingle();

    set((s) => ({
      loading: false,
      settings: {
        ...s.settings,
        [orgId]: data
          ? { timeLoggingEnabled: data.time_logging_enabled, pointsEnabled: data.points_enabled }
          : { ...defaults },
      },
    }));
  },

  setTimeLoggingEnabled: async (orgId, enabled) => {
    // Optimistic update
    set((s) => ({
      settings: {
        ...s.settings,
        [orgId]: { ...(s.settings[orgId] ?? defaults), timeLoggingEnabled: enabled },
      },
    }));

    await supabase
      .from('organization_settings')
      .upsert(
        { organization_id: orgId, time_logging_enabled: enabled, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id' },
      );
  },

  setPointsEnabled: async (orgId, enabled) => {
    set((s) => ({
      settings: {
        ...s.settings,
        [orgId]: { ...(s.settings[orgId] ?? defaults), pointsEnabled: enabled },
      },
    }));

    await supabase
      .from('organization_settings')
      .upsert(
        { organization_id: orgId, points_enabled: enabled, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id' },
      );
  },

  applyRealtimeSettings: (payload) => {
    const row = payload.new;
    if (!row?.organization_id) return;
    set((s) => ({
      settings: {
        ...s.settings,
        [row.organization_id]: {
          timeLoggingEnabled: row.time_logging_enabled,
          pointsEnabled: row.points_enabled,
        },
      },
    }));
  },
}));

// Convenience selectors
export function isTimeLoggingEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return useOrgSettingsStore.getState().settings[orgId]?.timeLoggingEnabled ?? false;
}

export function isPointsEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return useOrgSettingsStore.getState().settings[orgId]?.pointsEnabled ?? false;
}
