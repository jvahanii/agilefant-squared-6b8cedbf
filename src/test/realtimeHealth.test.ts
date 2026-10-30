import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const loadFromSupabase = vi.fn(async () => {});
const loadLabels = vi.fn(async () => {});
let loadInFlight = false;

/** Whether the realtime socket reports itself open, and reopen attempts. */
let socketConnected = true;
const connectSocket = vi.fn();
const disconnectSocket = vi.fn(async () => 'ok');
const removeChannel = vi.fn(async (_channel: unknown) => 'ok');
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    realtime: { isConnected: () => socketConnected, connect: () => connectSocket(), disconnect: () => disconnectSocket() },
    removeChannel: (channel: unknown) => removeChannel(channel),
  },
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
  noteVisibilityChange,
  subscribeWithHealth,
  SUBSCRIBE_RETRY_MAX_MS,
  RESYNC_MIN_INTERVAL_MS,
  HIDDEN_RESYNC_MS,
  HIDDEN_FULL_RESYNC_MS,
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

describe('coming back to a hidden tab', () => {
  // A socket can die while the tab is hidden without any channel reporting
  // it, and nothing caught up afterwards: items that arrived meanwhile — from
  // WhatsApp, in the case that found this — stayed missing until a reload.
  const T0 = 1_800_000_000_000;
  const MIN = 60_000;

  beforeEach(() => {
    vi.useFakeTimers();
    loadFromSupabase.mockClear();
    loadLabels.mockClear();
    connectSocket.mockClear();
    socketConnected = true;
    loadInFlight = false;
    __resetRealtimeHealth();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('a tab left hidden', () => {
    const setVisibility = (value: string) =>
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => value });

    beforeEach(() => {
      disconnectSocket.mockClear();
      connectSocket.mockClear();
      setVisibility('hidden');
    });
    afterEach(() => {
      delete (document as unknown as { visibilityState?: string }).visibilityState;
    });

    it('lets go of the socket once a return would catch up anyway', async () => {
      // Connected, it renews its token and so writes to the database, which
      // costs a 16 MB WAL segment every two minutes.
      noteVisibilityChange('hidden', T0);
      await vi.advanceTimersByTimeAsync(HIDDEN_RESYNC_MS - 1);
      expect(disconnectSocket).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(disconnectSocket).toHaveBeenCalledTimes(1);
    });

    it('reopens it and catches up on coming back', async () => {
      noteVisibilityChange('hidden', T0);
      await vi.advanceTimersByTimeAsync(HIDDEN_RESYNC_MS);
      socketConnected = false;
      setVisibility('visible');
      noteVisibilityChange('visible', T0 + HIDDEN_RESYNC_MS);
      await vi.advanceTimersByTimeAsync(1);
      expect(connectSocket).toHaveBeenCalledTimes(1);
      expect(loadFromSupabase).toHaveBeenCalledTimes(1);
    });

    it('keeps it through a quick look at another tab', async () => {
      noteVisibilityChange('hidden', T0);
      await vi.advanceTimersByTimeAsync(4 * MIN);
      setVisibility('visible');
      noteVisibilityChange('visible', T0 + 4 * MIN);
      await vi.advanceTimersByTimeAsync(HIDDEN_RESYNC_MS);
      expect(disconnectSocket).not.toHaveBeenCalled();
    });
  });

  it('catches up on work items after five minutes away', async () => {
    noteVisibilityChange('hidden', T0);
    noteVisibilityChange('visible', T0 + HIDDEN_RESYNC_MS);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFromSupabase).toHaveBeenCalledTimes(1);
    expect(loadLabels).not.toHaveBeenCalled();
  });

  it('downloads nothing for a quick look at another tab', async () => {
    // A catch-up re-downloads every work item; doing it on every tab switch is
    // the churn that once made the app slow.
    noteVisibilityChange('hidden', T0);
    noteVisibilityChange('visible', T0 + 4 * MIN);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFromSupabase).not.toHaveBeenCalled();
  });

  it('refreshes everything after an hour away', async () => {
    noteVisibilityChange('hidden', T0);
    noteVisibilityChange('visible', T0 + HIDDEN_FULL_RESYNC_MS);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFromSupabase).toHaveBeenCalledTimes(1);
    expect(loadLabels).toHaveBeenCalledTimes(1);
  });

  it('reopens a socket that died while hidden, however short the absence', () => {
    socketConnected = false;
    noteVisibilityChange('hidden', T0);
    noteVisibilityChange('visible', T0 + MIN);
    expect(connectSocket).toHaveBeenCalledTimes(1);
  });

  it('leaves a live socket alone', () => {
    noteVisibilityChange('hidden', T0);
    noteVisibilityChange('visible', T0 + MIN);
    expect(connectSocket).not.toHaveBeenCalled();
  });

  it('measures from when the tab was first hidden, not from a repeat', async () => {
    noteVisibilityChange('hidden', T0);
    noteVisibilityChange('hidden', T0 + 4 * MIN);
    noteVisibilityChange('visible', T0 + HIDDEN_RESYNC_MS);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFromSupabase).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a visible that follows no hidden', async () => {
    noteVisibilityChange('visible', T0);
    await vi.advanceTimersByTimeAsync(1);
    expect(loadFromSupabase).not.toHaveBeenCalled();
    expect(connectSocket).not.toHaveBeenCalled();
  });
});
describe('subscribeWithHealth', () => {
  // After the socket was closed on agilefant.org, every retry called
  // subscribe() again on the same channel, and realtime-js threw "tried to
  // join multiple times" for each one: it joins an instance only once.
  type Status = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED';
  type FakeChannel = {
    topic: string;
    subscribeCalls: number;
    emit: (status: Status) => void;
    subscribe: (callback: (status: Status) => void) => FakeChannel;
  };

  let built: FakeChannel[];
  let visibility: DocumentVisibilityState;

  function build(): FakeChannel {
    let callback: ((status: Status) => void) | null = null;
    const channel: FakeChannel = {
      topic: 'realtime:entity-realtime-org-1',
      subscribeCalls: 0,
      emit: (status) => callback?.(status),
      subscribe(cb) {
        channel.subscribeCalls += 1;
        if (channel.subscribeCalls > 1) {
          throw new Error("tried to join multiple times. 'join' can only be called a single time per channel instance");
        }
        callback = cb;
        return channel;
      },
    };
    built.push(channel);
    return channel;
  }

  const start = () =>
    subscribeWithHealth(build as unknown as Parameters<typeof subscribeWithHealth>[0]);
  const latest = () => built[built.length - 1];
  const setVisibility = (state: DocumentVisibilityState) => {
    visibility = state;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    loadFromSupabase.mockClear();
    loadLabels.mockClear();
    loadInFlight = false;
    __resetRealtimeHealth();
    built = [];
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    // Like realtime-js, removing a channel that cannot reach the server closes it at once.
    removeChannel.mockReset();
    removeChannel.mockImplementation(async (channel) => {
      (channel as FakeChannel).emit('CLOSED');
      return 'ok';
    });
  });

  afterEach(() => {
    delete (document as unknown as { visibilityState?: string }).visibilityState;
    vi.useRealTimers();
  });

  it('replaces a closed channel with a fresh one instead of subscribing it again', async () => {
    start();
    latest().emit('SUBSCRIBED');

    for (let round = 0; round < 3; round += 1) {
      latest().emit('CLOSED');
      await vi.advanceTimersByTimeAsync(SUBSCRIBE_RETRY_MAX_MS * 1.25);
    }

    expect(built).toHaveLength(4);
    for (const channel of built) expect(channel.subscribeCalls).toBe(1);
    expect(removeChannel.mock.calls.map(([channel]) => channel)).toEqual(built.slice(0, 3));
  });

  it('catches up once the replacement channel subscribes', async () => {
    start();
    latest().emit('SUBSCRIBED');
    latest().emit('CLOSED');
    expect(isRealtimeHealthy()).toBe(false);

    await vi.advanceTimersByTimeAsync(SUBSCRIBE_RETRY_MAX_MS * 1.25);
    latest().emit('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(1);

    expect(isRealtimeHealthy()).toBe(true);
    expect(loadFromSupabase).toHaveBeenCalledTimes(1);
  });

  it('leaves an errored or timed-out channel for realtime-js to rejoin', async () => {
    start();
    latest().emit('SUBSCRIBED');
    latest().emit('CHANNEL_ERROR');
    latest().emit('TIMED_OUT');
    await vi.advanceTimersByTimeAsync(SUBSCRIBE_RETRY_MAX_MS * 1.25);

    expect(built).toHaveLength(1);
    expect(built[0].subscribeCalls).toBe(1);
    expect(removeChannel).not.toHaveBeenCalled();
    expect(isRealtimeHealthy()).toBe(false);

    // realtime-js rejoins it on the same instance; that is the recovery.
    built[0].emit('SUBSCRIBED');
    await vi.advanceTimersByTimeAsync(1);
    expect(isRealtimeHealthy()).toBe(true);
    expect(loadFromSupabase).toHaveBeenCalledTimes(1);
  });

  it('waits for the tab to be visible before replacing a channel closed while hidden', async () => {
    start();
    latest().emit('SUBSCRIBED');
    setVisibility('hidden');
    latest().emit('CLOSED');
    await vi.advanceTimersByTimeAsync(SUBSCRIBE_RETRY_MAX_MS * 1.25);
    expect(built).toHaveLength(1);

    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(SUBSCRIBE_RETRY_MAX_MS * 1.25);
    expect(built).toHaveLength(2);
    expect(built[1].subscribeCalls).toBe(1);
  });

  it('stops replacing the channel once it is removed', async () => {
    const remove = start();
    latest().emit('SUBSCRIBED');
    latest().emit('CLOSED');
    remove();
    await vi.advanceTimersByTimeAsync(SUBSCRIBE_RETRY_MAX_MS * 1.25);

    expect(built).toHaveLength(1);
    expect(removeChannel).toHaveBeenCalledTimes(1);
    expect(loadFromSupabase).not.toHaveBeenCalled();
  });
});
