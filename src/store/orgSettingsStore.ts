import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { useOrgStore } from '@/store/orgStore';

interface OrgSettings {
  timeLoggingEnabled: boolean;
  pointsEnabled: boolean;
  labelsEnabled: boolean;
  customStatusesEnabled: boolean;
  savingsIncomeEnabled: boolean;
  boardsEnabled: boolean;
  burnupsEnabled: boolean;
  persistNotificationsEnabled: boolean;
  /** Backlogs and trees may be shared by public link. Enforced in the database
   *  too: switching it off stops existing links serving, not only new ones. */
  publicLinksEnabled: boolean;
  /** Work items can be rated one to five stars, and backlogs sorted by it. */
  ratingsEnabled: boolean;
  /** Work items show a deadline, can be given one, and lists sort by it. */
  deadlinesEnabled: boolean;
}

interface OrgSettingsState {
  settings: Record<string, OrgSettings>; // keyed by orgId
  loading: boolean;

  loadSettings: (orgId: string) => Promise<void>;
  setTimeLoggingEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  setPointsEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  setLabelsEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  setCustomStatusesEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  setSavingsIncomeEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  setBoardsEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  setBurnupsEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  setPersistNotificationsEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  setPublicLinksEnabled: (orgId: string, enabled: boolean) => Promise<boolean>;
  setRatingsEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  setDeadlinesEnabled: (orgId: string, enabled: boolean) => Promise<void>;
  applyRealtimeSettings: (payload: { eventType: string; new: any; old: any }) => void;
}

const defaults: OrgSettings = {
  timeLoggingEnabled: false,
  pointsEnabled: false,
  labelsEnabled: false,
  customStatusesEnabled: false,
  savingsIncomeEnabled: false,
  boardsEnabled: false,
  burnupsEnabled: false,
  persistNotificationsEnabled: false,
  publicLinksEnabled: false,
  ratingsEnabled: false,
  deadlinesEnabled: false,
};

export const useOrgSettingsStore = create<OrgSettingsState>((set, get) => ({
  settings: {},
  loading: false,

  loadSettings: async (orgId: string) => {
    set({ loading: true });
    const { data } = await supabase
      .from('organization_settings')
      .select('organization_id, time_logging_enabled, points_enabled, labels_enabled, custom_statuses_enabled, savings_income_enabled, boards_enabled, burnups_enabled, persist_notifications_enabled, public_links_enabled, ratings_enabled, deadlines_enabled')
      .eq('organization_id', orgId)
      .maybeSingle();

    set((s) => ({
      loading: false,
      settings: {
        ...s.settings,
        [orgId]: data
          ? {
              timeLoggingEnabled: data.time_logging_enabled,
              pointsEnabled: data.points_enabled,
              labelsEnabled: (data as { labels_enabled?: boolean }).labels_enabled ?? false,
              customStatusesEnabled:
                (data as { custom_statuses_enabled?: boolean }).custom_statuses_enabled ?? false,
              savingsIncomeEnabled:
                (data as { savings_income_enabled?: boolean }).savings_income_enabled ?? false,
              boardsEnabled:
                (data as { boards_enabled?: boolean }).boards_enabled ?? false,
              burnupsEnabled:
                (data as { burnups_enabled?: boolean }).burnups_enabled ?? false,
              persistNotificationsEnabled:
                (data as { persist_notifications_enabled?: boolean }).persist_notifications_enabled ?? false,
              publicLinksEnabled:
                (data as { public_links_enabled?: boolean }).public_links_enabled ?? false,
              ratingsEnabled: (data as { ratings_enabled?: boolean }).ratings_enabled ?? false,
              deadlinesEnabled: (data as { deadlines_enabled?: boolean }).deadlines_enabled ?? false,
            }
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

  setRatingsEnabled: async (orgId, enabled) => {
    set((s) => ({
      settings: {
        ...s.settings,
        [orgId]: { ...(s.settings[orgId] ?? defaults), ratingsEnabled: enabled },
      },
    }));

    await supabase
      .from("organization_settings")
      .upsert(
        { organization_id: orgId, ratings_enabled: enabled, updated_at: new Date().toISOString() },
        { onConflict: "organization_id" },
      );
  },

  setDeadlinesEnabled: async (orgId, enabled) => {
    set((s) => ({
      settings: {
        ...s.settings,
        [orgId]: { ...(s.settings[orgId] ?? defaults), deadlinesEnabled: enabled },
      },
    }));

    await supabase
      .from("organization_settings")
      .upsert(
        { organization_id: orgId, deadlines_enabled: enabled, updated_at: new Date().toISOString() },
        { onConflict: "organization_id" },
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

  setLabelsEnabled: async (orgId, enabled) => {
    set((s) => ({
      settings: {
        ...s.settings,
        [orgId]: { ...(s.settings[orgId] ?? defaults), labelsEnabled: enabled },
      },
    }));

    await supabase
      .from('organization_settings')
      .upsert(
        { organization_id: orgId, labels_enabled: enabled, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id' },
      );
  },

  setCustomStatusesEnabled: async (orgId, enabled) => {
    set((s) => ({
      settings: {
        ...s.settings,
        [orgId]: { ...(s.settings[orgId] ?? defaults), customStatusesEnabled: enabled },
      },
    }));

    await supabase
      .from('organization_settings')
      .upsert(
        { organization_id: orgId, custom_statuses_enabled: enabled, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id' },
      );
  },

  setSavingsIncomeEnabled: async (orgId, enabled) => {
    set((s) => ({
      settings: {
        ...s.settings,
        [orgId]: { ...(s.settings[orgId] ?? defaults), savingsIncomeEnabled: enabled },
      },
    }));

    await supabase
      .from('organization_settings')
      .upsert(
        { organization_id: orgId, savings_income_enabled: enabled, updated_at: new Date().toISOString() } as any,
        { onConflict: 'organization_id' },
      );
  },

  setBoardsEnabled: async (orgId, enabled) => {
    set((s) => ({
      settings: {
        ...s.settings,
        [orgId]: { ...(s.settings[orgId] ?? defaults), boardsEnabled: enabled },
      },
    }));

    await supabase
      .from('organization_settings')
      .upsert(
        { organization_id: orgId, boards_enabled: enabled, updated_at: new Date().toISOString() } as any,
        { onConflict: 'organization_id' },
      );
  },

  setBurnupsEnabled: async (orgId, enabled) => {
    set((s) => ({
      settings: {
        ...s.settings,
        [orgId]: { ...(s.settings[orgId] ?? defaults), burnupsEnabled: enabled },
      },
    }));

    await supabase
      .from('organization_settings')
      .upsert(
        { organization_id: orgId, burnups_enabled: enabled, updated_at: new Date().toISOString() } as any,
        { onConflict: 'organization_id' },
      );
  },

  setPersistNotificationsEnabled: async (orgId, enabled) => {
    set((s) => ({
      settings: {
        ...s.settings,
        [orgId]: { ...(s.settings[orgId] ?? defaults), persistNotificationsEnabled: enabled },
      },
    }));

    await supabase
      .from('organization_settings')
      .upsert(
        { organization_id: orgId, persist_notifications_enabled: enabled, updated_at: new Date().toISOString() } as any,
        { onConflict: 'organization_id' },
      );
  },

  setPublicLinksEnabled: async (orgId, enabled) => {
    const previous = get().settings[orgId]?.publicLinksEnabled ?? false;
    set((s) => ({
      settings: {
        ...s.settings,
        [orgId]: { ...(s.settings[orgId] ?? defaults), publicLinksEnabled: enabled },
      },
    }));

    const { error } = await supabase
      .from('organization_settings')
      .upsert(
        { organization_id: orgId, public_links_enabled: enabled, updated_at: new Date().toISOString() },
        { onConflict: 'organization_id' },
      );
    // Unlike the other switches, a failed write here is put back rather than
    // left showing. This one decides whether backlogs are public, and a switch
    // reading "off" while links still serve is the worst way for it to be wrong.
    if (error) {
      set((s) => ({
        settings: {
          ...s.settings,
          [orgId]: { ...(s.settings[orgId] ?? defaults), publicLinksEnabled: previous },
        },
      }));
      return false;
    }
    return true;
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
          labelsEnabled: row.labels_enabled ?? false,
          customStatusesEnabled: row.custom_statuses_enabled ?? false,
          savingsIncomeEnabled: row.savings_income_enabled ?? false,
          boardsEnabled: row.boards_enabled ?? false,
          burnupsEnabled: row.burnups_enabled ?? false,
          persistNotificationsEnabled: row.persist_notifications_enabled ?? false,
          publicLinksEnabled: row.public_links_enabled ?? false,
          ratingsEnabled: row.ratings_enabled ?? false,
          deadlinesEnabled: row.deadlines_enabled ?? false,
        },
      },
    }));
  },
}));

export function isBurnupsEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return useOrgSettingsStore.getState().settings[orgId]?.burnupsEnabled ?? false;
}

// Convenience selectors
export function isTimeLoggingEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return useOrgSettingsStore.getState().settings[orgId]?.timeLoggingEnabled ?? false;
}

export function isPointsEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return useOrgSettingsStore.getState().settings[orgId]?.pointsEnabled ?? false;
}

export function isLabelsEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return useOrgSettingsStore.getState().settings[orgId]?.labelsEnabled ?? false;
}

export function isCustomStatusesEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return useOrgSettingsStore.getState().settings[orgId]?.customStatusesEnabled ?? false;
}

export function isSavingsIncomeEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return useOrgSettingsStore.getState().settings[orgId]?.savingsIncomeEnabled ?? false;
}

export function isBoardsEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return useOrgSettingsStore.getState().settings[orgId]?.boardsEnabled ?? false;
}

export function isPersistNotificationsEnabled(orgId: string | null): boolean {
  if (!orgId) return false;
  return useOrgSettingsStore.getState().settings[orgId]?.persistNotificationsEnabled ?? false;
}

/**
 * Whether the active organization shares by public link.
 *
 * The active one, because RLS lets a user read only their own organization's
 * settings: a tree shared in from a partner has an owner whose choice the app
 * cannot see. The database checks the tree's real owner on every request, so
 * that gap costs at worst a refused publish, never a page that should be private.
 */
export function usePublicLinksEnabled(): boolean {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  return useOrgSettingsStore((s) => (activeOrgId ? s.settings[activeOrgId]?.publicLinksEnabled ?? false : false));
}
