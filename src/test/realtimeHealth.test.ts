import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loadFromSupabase = vi.fn(async () => {});
const loadLabels = vi.fn(async () => {});
let loadInFlight = false;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { realtime: { isConnected: () => true, connect: () => {} } },
}));
vi.mock('@/store/appStore', () => ({
  useAppStore: { getState: () => ({ loadFromSupabase, backlogTrees: {} }) },
  isAppDataLoadInFlight: () => loadInFlight,
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
  useLabelsStore: { getState: () => ({ loadLabels }) },
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
  subscribeRetryDelayMs,
  requestResync,
  markChannelStatus,
  markChannelIntentionalClose,
  __resetRealtimeHealth,
  isRealtimeHealthy,
  RESYNC_MIN_INTERVAL_MS,
} from '@/lib/realtimeHealth';

describe('realtimeHealth', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    loadFromSupabase.mockClear();
    loadLabels.mockClear();
    loadInFlight = false;
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

  it('rate-limits a follow-up resync to the minimum interval', async () => {
    requestResync('first');
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFromSupabase).toHaveBeenCalledTimes(1);

    requestResync('second');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(loadFromSupabase).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(RESYNC_MIN_INTERVAL_MS);
    expect(loadFromSupabase).toHaveBeenCalledTimes(2);
  });

  it('skips the satellite stores unless a full resync is requested', async () => {
    requestResync('light');
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFromSupabase).toHaveBeenCalledTimes(1);
    expect(loadLabels).not.toHaveBeenCalled();

    __resetRealtimeHealth();
    requestResync('heavy', { full: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(loadLabels).toHaveBeenCalledTimes(1);
  });

  it('skips a resync while a full app data load is already in flight', async () => {
    loadInFlight = true;
    requestResync('during-load');
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFromSupabase).not.toHaveBeenCalled();
  });

  it('reports recovery per channel, not globally', () => {
    // Both channels join for the first time — no recovery.
    expect(markChannelStatus('chan-a', 'SUBSCRIBED')).toBe(false);
    expect(markChannelStatus('chan-b', 'SUBSCRIBED')).toBe(false);
    expect(isRealtimeHealthy()).toBe(true);

    markChannelStatus('chan-a', 'CHANNEL_ERROR');
    expect(isRealtimeHealthy()).toBe(false);

    // Channel B was never unhealthy, so its resubscribe is not a recovery.
    expect(markChannelStatus('chan-b', 'SUBSCRIBED')).toBe(false);
    // Channel A did drop, so it is.
    expect(markChannelStatus('chan-a', 'SUBSCRIBED')).toBe(true);
    expect(isRealtimeHealthy()).toBe(true);
  });

  it('does not treat an intentional teardown as an outage', () => {
    markChannelStatus('chan-c', 'SUBSCRIBED');
    markChannelIntentionalClose('chan-c');
    markChannelStatus('chan-c', 'CLOSED');
    expect(isRealtimeHealthy()).toBe(true);
    expect(markChannelStatus('chan-c', 'SUBSCRIBED')).toBe(false);
  });

  it('does not treat a first-join failure as an outage', () => {
    markChannelStatus('chan-d', 'CHANNEL_ERROR');
    expect(isRealtimeHealthy()).toBe(true);
    expect(markChannelStatus('chan-d', 'SUBSCRIBED')).toBe(false);
  });
});

describe('subscribeRetryDelayMs', () => {
  // No jitter, so the shape of the curve is visible.
  const steady = () => 0.5;

  it('doubles per attempt from one second', () => {
    expect(subscribeRetryDelayMs(0, steady)).toBe(1_000);
    expect(subscribeRetryDelayMs(1, steady)).toBe(2_000);
    expect(subscribeRetryDelayMs(2, steady)).toBe(4_000);
    expect(subscribeRetryDelayMs(5, steady)).toBe(32_000);
  });

  it('stops at five minutes, however many attempts have failed', () => {
    // The old ceiling was 30s: every channel of every tab hitting a database
    // too busy to answer, twice a minute, keeping it down.
    expect(subscribeRetryDelayMs(20, steady)).toBe(300_000);
    expect(subscribeRetryDelayMs(1000, steady)).toBe(300_000);
  });

  it('spreads retries with a quarter of jitter either way', () => {
    expect(subscribeRetryDelayMs(3, () => 0)).toBe(6_000);
    expect(subscribeRetryDelayMs(3, () => 1)).toBe(10_000);
    // Whatever the random value, the delay stays inside that band.
    for (const r of [0, 0.13, 0.5, 0.87, 0.999]) {
      const delay = subscribeRetryDelayMs(4, () => r);
      expect(delay).toBeGreaterThanOrEqual(12_000);
      expect(delay).toBeLessThanOrEqual(20_000);
    }
  });

  it('treats a negative attempt as the first one', () => {
    expect(subscribeRetryDelayMs(-5, steady)).toBe(1_000);
  });
});
