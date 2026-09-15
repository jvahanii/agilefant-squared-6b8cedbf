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

/** Test/teardown helper. */
export function __resetRealtimeHealth(): void {
  channelHealth.clear();
  lastResyncAt = 0;
  pendingFull = false;
  if (resyncTimer) clearTimeout(resyncTimer);
  resyncTimer = null;
  resyncInFlight = null;
}
