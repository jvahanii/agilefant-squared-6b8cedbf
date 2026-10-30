/**
 * Realtime connection health + catch-up resync.
 *
 * Supabase Realtime delivers changes only while the WebSocket is alive.  A tab
 * that has been backgrounded, put to sleep with the laptop lid, or hit by a
 * network blip silently loses its socket, so changes made on another device
 * during that window are never broadcast to it.
 *
 * Health is tracked **per channel** (keyed by channel topic): the app opens one
 * channel per partner org plus several shared ones, and a single global flag
 * meant that any channel closing — including an intentional teardown when the
 * effect re-runs — made the next channel's `SUBSCRIBED` look like a recovery
 * and triggered a full dataset refetch.  That churn is what made the app feel
 * slow, so recoveries are now scoped to the channel that actually dropped, and
 * resyncs are heavily rate-limited and narrowed to the work-item data by
 * default.
 */

import { supabase } from '@/integrations/supabase/client';
import { useAppStore, isAppDataLoadInFlight } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useTeamStore } from '@/store/teamStore';
import { useLabelsStore } from '@/store/labelsStore';
import { useBacklogStatusesStore } from '@/store/backlogStatusesStore';
import { useSnoozeStore } from '@/store/snoozeStore';
import { useOrgSettingsStore, isTimeLoggingEnabled } from '@/store/orgSettingsStore';
import { usePublishedLinksStore } from '@/store/publishedLinksStore';
import { useScrambledItemsStore } from '@/store/scrambledItemsStore';
import { useJiraIssuesStore } from '@/store/jiraIssuesStore';
import { useScrambledListsStore } from '@/store/scrambledListsStore';

export type ChannelStatus = string;

/** Minimum spacing between two catch-up fetches. */
export const RESYNC_MIN_INTERVAL_MS = 30_000;
/** Outage length after which the slow-moving satellite stores are refreshed too. */
export const FULL_RESYNC_OUTAGE_MS = 120_000;

/** First retry delay for a channel that failed to subscribe, and its ceiling. */
export const SUBSCRIBE_RETRY_BASE_MS = 1_000;
export const SUBSCRIBE_RETRY_MAX_MS = 300_000;

/**
 * How long to wait before re-subscribing a channel that failed.
 *
 * Doubles per attempt up to five minutes, with a quarter of jitter either way.
 * The ceiling used to be 30 seconds: a database too busy to answer was then hit
 * by every channel of every open tab twice a minute, and since each subscribe
 * costs Realtime a publication re-check, a struggling instance was kept down by
 * its own clients. The jitter stops channels and tabs retrying in lockstep.
 */
export function subscribeRetryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.max(0, Math.min(attempt, 30));
  const capped = Math.min(SUBSCRIBE_RETRY_MAX_MS, SUBSCRIBE_RETRY_BASE_MS * 2 ** exponent);
  return Math.round(capped * (0.75 + random() * 0.5));
}

type ChannelHealth = {
  /** Has this channel ever successfully subscribed? */
  everSubscribed: boolean;
  /** Timestamp it went unhealthy, or null while healthy. */
  unhealthySince: number | null;
  /** True while we are tearing the channel down on purpose. */
  intentionallyClosed: boolean;
};

const channelHealth = new Map<string, ChannelHealth>();

let lastResyncAt = 0;
let resyncTimer: ReturnType<typeof setTimeout> | null = null;
let resyncInFlight: Promise<void> | null = null;
let pendingFull = false;

function healthFor(topic: string): ChannelHealth {
  let entry = channelHealth.get(topic);
  if (!entry) {
    entry = { everSubscribed: false, unhealthySince: null, intentionallyClosed: false };
    channelHealth.set(topic, entry);
  }
  return entry;
}

export function isRealtimeHealthy(): boolean {
  for (const entry of channelHealth.values()) {
    if (entry.unhealthySince !== null) return false;
  }
  return true;
}

export function getLastResyncAt(): number {
  return lastResyncAt;
}

/** Longest current outage across all channels, in ms (0 when all healthy). */
export function getOutageDurationMs(): number {
  let oldest: number | null = null;
  for (const entry of channelHealth.values()) {
    if (entry.unhealthySince === null) continue;
    if (oldest === null || entry.unhealthySince < oldest) oldest = entry.unhealthySince;
  }
  return oldest === null ? 0 : Date.now() - oldest;
}

/** True when the underlying realtime socket is currently open. */
export function isSocketConnected(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return Boolean((supabase.realtime as any)?.isConnected?.());
  } catch {
    return false;
  }
}

/** Reopen the realtime socket if it dropped, so channels can rejoin. */
export function ensureSocketConnected(): void {
  if (isSocketConnected()) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.realtime as any)?.connect?.();
  } catch (err) {
    console.warn('realtimeHealth: reconnect failed', err);
  }
}

/**
 * Mark a channel as being removed on purpose (effect cleanup / org switch), so
 * the `CLOSED` status it emits is not mistaken for an outage.
 */
export function markChannelIntentionalClose(topic: string): void {
  const entry = healthFor(topic);
  entry.intentionallyClosed = true;
  entry.unhealthySince = null;
}

/** Forget a channel entirely (after it has been removed). */
export function forgetChannel(topic: string): void {
  channelHealth.delete(topic);
}

/**
 * Record a channel subscribe status.  Returns true only when *this* channel had
 * a real outage and has now recovered, i.e. we may have missed events for it.
 */
export function markChannelStatus(topic: string, status: ChannelStatus): boolean {
  const entry = healthFor(topic);

  if (status === 'SUBSCRIBED') {
    const recovered = entry.everSubscribed && entry.unhealthySince !== null;
    entry.everSubscribed = true;
    entry.unhealthySince = null;
    entry.intentionallyClosed = false;
    return recovered;
  }

  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    // A deliberate teardown, or a channel that never joined, is not an outage.
    if (entry.intentionallyClosed || !entry.everSubscribed) return false;
    if (entry.unhealthySince === null) entry.unhealthySince = Date.now();
  }
  return false;
}

async function runResync(full: boolean): Promise<void> {
  const orgId = useOrgStore.getState().activeOrgId;
  if (!orgId) return;
  lastResyncAt = Date.now();

  // Work items / backlogs / trees — the only data that changes often enough to
  // justify a catch-up fetch on every wake.
  await useAppStore.getState().loadFromSupabase();
  if (!full) return;

  // Collect the active org plus any partner orgs owning accessible trees.
  const orgIds = new Set<string>([orgId]);
  for (const treeId of Object.keys(useAppStore.getState().backlogTrees)) {
    const sep = treeId.indexOf('::');
    if (sep > 0) orgIds.add(treeId.slice(0, sep));
  }
  const orgIdList = [...orgIds];

  const tasks: Array<Promise<unknown>> = [
    useTeamStore.getState().loadTeams(orgId),
    useTeamStore.getState().loadWorkItemTeams(orgId),
    useLabelsStore.getState().loadLabels(orgIdList),
    usePublishedLinksStore.getState().load(),
    useScrambledItemsStore.getState().load(),
    useJiraIssuesStore.getState().load(),
    useScrambledListsStore.getState().load(),
    useBacklogStatusesStore.getState().loadStatusesForOrgs(orgIdList),
    useSnoozeStore.getState().loadSnoozes(),
    useOrgSettingsStore.getState().loadSettings(orgId).then(() => {
      if (isTimeLoggingEnabled(orgId)) {
        return useTimeEntryStore.getState().loadTimeEntries(orgId);
      }
    }),
    import('@/store/financialsStore').then(({ useFinancialsStore }) =>
      useFinancialsStore.getState().load(orgIdList),
    ),
    import('@/store/targetsStore').then(({ useTargetsStore }) =>
      useTargetsStore.getState().load(orgIdList),
    ),
  ];

  await Promise.allSettled(tasks);
}

/**
 * Request a catch-up refetch.  Calls coalesce into at most one fetch per
 * RESYNC_MIN_INTERVAL_MS, are skipped while a dataset load is already running
 * or while the tab is hidden, and only refresh the slow-moving satellite stores
 * when `full` is requested (long outages).
 */
export function requestResync(reason: string, options?: { full?: boolean }): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  if (options?.full) pendingFull = true;
  if (resyncTimer || resyncInFlight) return; // already scheduled / running — coalesce

  const elapsed = Date.now() - lastResyncAt;
  const delay = elapsed >= RESYNC_MIN_INTERVAL_MS ? 0 : RESYNC_MIN_INTERVAL_MS - elapsed;

  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    if (resyncInFlight) return;
    // A full app load is already in flight — it supersedes this catch-up.
    if (isAppDataLoadInFlight()) {
      pendingFull = false;
      lastResyncAt = Date.now();
      return;
    }
    const full = pendingFull;
    pendingFull = false;
    resyncInFlight = runResync(full)
      .catch((err) => console.warn(`realtimeHealth: resync (${reason}) failed`, err))
      .finally(() => {
        resyncInFlight = null;
      });
  }, delay);
}

/**
 * A tab hidden at least this long is caught up when it comes back.
 *
 * A socket can die while the tab is hidden without any channel saying so, and
 * then nothing asks for a catch-up: changes made meanwhile — a WhatsApp message
 * turned into items — stay missing until a reload. But a catch-up downloads
 * every work item and rank, a couple of megabytes, so it cannot run on every
 * return. Five minutes is when browsers start freezing background tabs, which
 * is what kills a socket's heartbeat; a tab back sooner has almost certainly
 * kept its connection and its updates.
 */
export const HIDDEN_RESYNC_MS = 5 * 60_000;
/** Away this long — a sleeping laptop, a tab left overnight — refresh everything. */
export const HIDDEN_FULL_RESYNC_MS = 60 * 60_000;

let hiddenSince: number | null = null;
let hiddenDisconnect: ReturnType<typeof setTimeout> | null = null;

/**
 * Let go of the socket once the tab has been hidden as long as a return would
 * catch up anyway. A connected tab renews its token every thirty seconds, each
 * renewal rewriting its subscriptions in the database, and any write at all
 * within two minutes costs a whole 16 MB WAL segment written and read
 * (20261030090000) — so one tab left open overnight was gigabytes of Disk IO.
 */
function letGoOfSocketLater(): void {
  if (hiddenDisconnect) clearTimeout(hiddenDisconnect);
  hiddenDisconnect = setTimeout(() => {
    hiddenDisconnect = null;
    if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      void (supabase.realtime as any)?.disconnect?.();
    } catch (err) {
      console.warn('realtimeHealth: disconnect failed', err);
    }
  }, HIDDEN_RESYNC_MS);
}

/**
 * Record a change in the tab's visibility. On return the socket is reopened if
 * it dropped — free when it did not, and the channels' own recovery then takes
 * over, including those that failed while hidden and deliberately did not retry.
 * After a long enough absence a catch-up is requested as well.
 */
export function noteVisibilityChange(state: DocumentVisibilityState | string, now: number = Date.now()): void {
  if (state === 'hidden') {
    if (hiddenSince === null) {
      hiddenSince = now;
      letGoOfSocketLater();
    }
    return;
  }
  if (state !== 'visible' || hiddenSince === null) return;
  const away = now - hiddenSince;
  hiddenSince = null;
  if (hiddenDisconnect) clearTimeout(hiddenDisconnect);
  hiddenDisconnect = null;
  ensureSocketConnected();
  if (away < HIDDEN_RESYNC_MS) return;
  requestResync('tab visible again', { full: away >= HIDDEN_FULL_RESYNC_MS });
}

type RealtimeChannel = ReturnType<typeof supabase.channel>;

/**
 * Subscribe a channel and keep it subscribed, watching its status so a dropped
 * socket is detected and followed by a catch-up fetch of anything broadcast
 * while we were disconnected. Returns a function that removes it for good.
 *
 * A channel that errors or times out is rejoined by realtime-js itself — on
 * its rejoin timer, and as soon as the socket reopens — so those statuses are
 * only recorded. Calling subscribe() again on the same instance is never the
 * fix: realtime-js allows one join per instance and throws "tried to join
 * multiple times", which filled the console on every retry after a network
 * drop. A CLOSED channel is different: realtime-js has dropped it and will
 * not rejoin it, so it is removed and a fresh one built from `build`, with
 * capped backoff. Health is keyed by topic, which the new instance shares, so
 * its SUBSCRIBED counts as the recovery and brings the catch-up resync.
 */
export function subscribeWithHealth(build: () => RealtimeChannel): () => void {
  let current: RealtimeChannel | null = build();
  const topic = current.topic;
  let attempt = 0;
  let stopped = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let waitingForVisible: (() => void) | null = null;

  const attach = (channel: RealtimeChannel) => {
    channel.subscribe((status) => {
      // A replaced instance still reports, not least the CLOSED its removal emits.
      if (stopped || channel !== current) return;
      const outage = getOutageDurationMs();
      const recovered = markChannelStatus(topic, status);
      if (status === 'SUBSCRIBED') {
        attempt = 0;
        // Only a channel that genuinely dropped needs a catch-up; a long
        // outage additionally refreshes the slow-moving satellite stores.
        if (recovered) {
          requestResync('resubscribed', { full: outage >= FULL_RESYNC_OUTAGE_MS });
        }
        return;
      }
      if (status === 'CLOSED') scheduleRebuild();
    });
  };

  const rebuild = () => {
    const dead = current;
    current = null;
    // Remove the dead instance before building its replacement: realtime-js
    // hands back an existing channel with the same topic instead of a new one,
    // and forgets channels by topic, so removing it afterwards would drop the
    // replacement too.
    if (dead) void supabase.removeChannel(dead);
    current = build();
    attach(current);
  };

  const scheduleRebuild = () => {
    if (stopped || retryTimer || waitingForVisible) return;
    // Never retry while hidden — avoids battery drain and request storms. The
    // rebuild waits for the tab to come back instead.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', onVisible);
        waitingForVisible = null;
        scheduleRebuild();
      };
      waitingForVisible = onVisible;
      document.addEventListener('visibilitychange', onVisible);
      return;
    }
    const delay = subscribeRetryDelayMs(attempt);
    attempt += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (!stopped) rebuild();
    }, delay);
  };

  attach(current);

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    if (waitingForVisible) document.removeEventListener('visibilitychange', waitingForVisible);
    waitingForVisible = null;
    // Flag the teardown so the resulting CLOSED status isn't treated as an
    // outage (which used to trigger a spurious full dataset refetch).
    markChannelIntentionalClose(topic);
    if (current) void supabase.removeChannel(current);
    current = null;
    forgetChannel(topic);
  };
}

/** Test/teardown helper. */
export function __resetRealtimeHealth(): void {
  channelHealth.clear();
  hiddenSince = null;
  if (hiddenDisconnect) clearTimeout(hiddenDisconnect);
  hiddenDisconnect = null;
  lastResyncAt = 0;
  pendingFull = false;
  if (resyncTimer) clearTimeout(resyncTimer);
  resyncTimer = null;
  resyncInFlight = null;
}
