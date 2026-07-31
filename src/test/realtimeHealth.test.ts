import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loadFromSupabase = vi.fn(async () => {});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { realtime: { isConnected: () => true, connect: () => {} } },
}));
vi.mock('@/store/appStore', () => ({
  useAppStore: { getState: () => ({ loadFromSupabase, backlogTrees: {} }) },
}));
vi.mock('@/store/orgStore', () => ({
  useOrgStore: { getState: () => ({ activeOrgId: 'org-1' }) },
}));
vi.mock('@/store/timeEntryStore', () => ({
  useTimeEntryStore: { getState: () => ({ loadTimeEntries: async () => {} }) },
}));
vi.mock('@/store/teamStore', () => ({
  useTeamStore: {
    getState: () => ({ loadTeams: async () => {}, loadWorkItemTeams: async () => {} }),
  },
}));
vi.mock('@/store/labelsStore', () => ({
  useLabelsStore: { getState: () => ({ loadLabels: async () => {} }) },
}));
vi.mock('@/store/backlogStatusesStore', () => ({
  useBacklogStatusesStore: { getState: () => ({ loadStatusesForOrgs: async () => {} }) },
}));
vi.mock('@/store/snoozeStore', () => ({
  useSnoozeStore: { getState: () => ({ loadSnoozes: async () => {} }) },
}));
vi.mock('@/store/orgSettingsStore', () => ({
  useOrgSettingsStore: { getState: () => ({ loadSettings: async () => {} }) },
  isTimeLoggingEnabled: () => false,
}));
vi.mock('@/store/financialsStore', () => ({
  useFinancialsStore: { getState: () => ({ load: async () => {} }) },
}));
vi.mock('@/store/targetsStore', () => ({
  useTargetsStore: { getState: () => ({ load: async () => {} }) },
}));

import {
  requestResync,
  markChannelStatus,
  __resetRealtimeHealth,
  isRealtimeHealthy,
} from '@/lib/realtimeHealth';

describe('realtimeHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    loadFromSupabase.mockClear();
    __resetRealtimeHealth();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces multiple resync requests into a single fetch', async () => {
    requestResync('a');
    requestResync('b');
    requestResync('c');

    expect(loadFromSupabase).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFromSupabase).toHaveBeenCalledTimes(1);
  });

  it('debounces a follow-up resync until the window elapses', async () => {
    requestResync('first');
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFromSupabase).toHaveBeenCalledTimes(1);

    requestResync('second');
    await vi.advanceTimersByTimeAsync(1000);
    expect(loadFromSupabase).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);
    expect(loadFromSupabase).toHaveBeenCalledTimes(2);
  });

  it('reports recovery only after an unhealthy transition', () => {
    expect(markChannelStatus('SUBSCRIBED')).toBe(false);
    expect(isRealtimeHealthy()).toBe(true);

    markChannelStatus('CHANNEL_ERROR');
    expect(isRealtimeHealthy()).toBe(false);

    expect(markChannelStatus('SUBSCRIBED')).toBe(true);
    expect(isRealtimeHealthy()).toBe(true);
  });
});
