/**
 * Realtime connection health + catch-up resync.
 *
 * Supabase Realtime delivers changes only while the WebSocket is alive.  A tab
 * that has been backgrounded, put to sleep with the laptop lid, or hit by a
 * network blip silently loses its socket, so changes made on another device
 * during that window are never broadcast to it.  Nothing in the app noticed
 * this before, which is why a laptop session needed a manual refresh to see
 * edits made on a phone.
 *
 * This module tracks channel health and exposes a debounced `requestResync`
 * that re-fetches all live data so the UI catches up on anything missed.
 */

import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useTeamStore } from '@/store/teamStore';
import { useLabelsStore } from '@/store/labelsStore';
import { useBacklogStatusesStore } from '@/store/backlogStatusesStore';
import { useSnoozeStore } from '@/store/snoozeStore';
import { useOrgSettingsStore, isTimeLoggingEnabled } from '@/store/orgSettingsStore';

export type ChannelStatus = string;

const RESYNC_DEBOUNCE_MS = 5000;

let healthy = true;
let lastResyncAt = 0;
let resyncTimer: ReturnType<typeof setTimeout> | null = null;
let resyncInFlight: Promise<void> | null = null;

export function isRealtimeHealthy(): boolean {
  return healthy;
}

export function getLastResyncAt(): number {
  return lastResyncAt;
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
 * Record a channel subscribe status.  Returns true when the transition means
 * we may have missed events and should catch up (i.e. we just recovered).
 */
export function markChannelStatus(status: ChannelStatus): boolean {
  if (status === 'SUBSCRIBED') {
    const recovered = !healthy;
    healthy = true;
    return recovered;
  }
  if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
    healthy = false;
  }
  return false;
}

async function runResync(): Promise<void> {
  const orgId = useOrgStore.getState().activeOrgId;
  if (!orgId) return;
  lastResyncAt = Date.now();

  await useAppStore.getState().loadFromSupabase();

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
 * Request a catch-up refetch of all live data.  Multiple calls within
 * RESYNC_DEBOUNCE_MS coalesce into a single fetch.
 */
export function requestResync(reason: string): void {
  if (resyncTimer) return; // already scheduled — coalesce
  const elapsed = Date.now() - lastResyncAt;
  const delay = elapsed >= RESYNC_DEBOUNCE_MS ? 0 : RESYNC_DEBOUNCE_MS - elapsed;

  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    if (resyncInFlight) return;
    resyncInFlight = runResync()
      .catch((err) => console.warn(`realtimeHealth: resync (${reason}) failed`, err))
      .finally(() => {
        resyncInFlight = null;
      });
  }, delay);
}

/** Test/teardown helper. */
export function __resetRealtimeHealth(): void {
  healthy = true;
  lastResyncAt = 0;
  if (resyncTimer) clearTimeout(resyncTimer);
  resyncTimer = null;
  resyncInFlight = null;
}
