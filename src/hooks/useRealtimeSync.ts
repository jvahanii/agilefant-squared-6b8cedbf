import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { getCurrentUserId } from '@/lib/currentUser';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useTeamStore } from '@/store/teamStore';
import { useOrgSettingsStore } from '@/store/orgSettingsStore';
import { useLabelsStore } from '@/store/labelsStore';
import { useBacklogStatusesStore } from '@/store/backlogStatusesStore';
import { useSnoozeStore } from '@/store/snoozeStore';
import { useFinancialsStore } from '@/store/financialsStore';
import { useTargetsStore } from '@/store/targetsStore';
import {
  ensureSocketConnected,
  forgetChannel,
  getOutageDurationMs,
  markChannelIntentionalClose,
  markChannelStatus,
  requestResync,
  subscribeRetryDelayMs,
  FULL_RESYNC_OUTAGE_MS,
} from '@/lib/realtimeHealth';
import { usePublishedLinksStore } from '@/store/publishedLinksStore';
import { useScrambledItemsStore } from '@/store/scrambledItemsStore';

/**
 * Subscribes to Supabase Realtime Postgres changes for the active organization's
 * work_items, backlogs, backlog_trees, and work_item_hyperlinks tables. When a
 * row changes in another browser session or by another member of the same org,
 * the Zustand store is updated in-place without a full reload.
 *
 * Additionally subscribes to the same tables for every "partner" organization
 * that participates in tree sharing with the active org:
 *  - Incoming partners: orgs that own trees shared TO us (derived from backlogTrees
 *    state – any tree whose ID prefix differs from activeOrgId).
 *  - Outgoing partners: orgs that have access to OUR trees (fetched once from
 *    backlog_tree_shares when the effect runs).
 *
 * This ensures that when a partner org creates/updates/deletes items in a shared
 * tree those changes appear immediately in the active org's UI without a manual
 * page reload.
 */
export function useRealtimeSync() {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const applyRealtimeWorkItem = useAppStore((s) => s.applyRealtimeWorkItem);
  const applyRealtimeWorkItemRank = useAppStore((s) => s.applyRealtimeWorkItemRank);
  const applyRealtimeWorkItemBoardRank = useAppStore((s) => s.applyRealtimeWorkItemBoardRank);
  const applyRealtimeBacklog = useAppStore((s) => s.applyRealtimeBacklog);
  const applyRealtimeBacklogTree = useAppStore((s) => s.applyRealtimeBacklogTree);
  const applyRealtimeHyperlink = useAppStore((s) => s.applyRealtimeHyperlink);
  const applyRealtimeTimeEntry = useTimeEntryStore((s) => s.applyRealtimeTimeEntry);
  const applyRealtimeTeamAssignment = useTeamStore((s) => s.applyRealtimeTeamAssignment);
  const applyRealtimeTeam = useTeamStore((s) => s.applyRealtimeTeam);
  const applyRealtimeSettings = useOrgSettingsStore((s) => s.applyRealtimeSettings);
  const applyRealtimeLabel = useLabelsStore((s) => s.applyRealtimeLabel);
  const applyRealtimeAssignment = useLabelsStore((s) => s.applyRealtimeAssignment);
  const applyRealtimeStatus = useBacklogStatusesStore((s) => s.applyRealtimeStatus);
  const applyRealtimeSnooze = useSnoozeStore((s) => s.applyRealtimeSnooze);
  const applyRealtimeFinancials = useFinancialsStore((s) => s.applyRealtime);
  const applyRealtimeTarget = useTargetsStore((s) => s.applyRealtime);

  // Re-subscribing tears down every channel and builds it again, and each
  // subscribe costs Realtime a publication re-check. Only the *partner*
  // organizations matter to what is subscribed: a tree added, renamed or
  // removed inside the active org changes nothing about the channels, so
  // keying on the partner set alone keeps a working session from churning.
  const partnerOrgsKey = (() => {
    const partners = new Set<string>();
    for (const treeId of Object.keys(backlogTrees)) {
      const sep = treeId.indexOf('::');
      if (sep > 0) {
        const owner = treeId.slice(0, sep);
        if (owner !== activeOrgId) partners.add(owner);
      }
    }
    return [...partners].sort().join(',');
  })();

  // Trees load after the first render, so on a fresh page load this effect
  // first runs with none of our own. Outgoing shares are looked up from our
  // tree IDs, so without re-running once they arrive, the organizations we
  // share trees *out* to would never get a channel until the page reloaded.
  // A flag rather than the tree IDs: it flips once, instead of churning every
  // channel whenever a tree is added or removed.
  const hasOwnTrees = Object.keys(backlogTrees).some((id) => id.startsWith(`${activeOrgId}::`));

  useEffect(() => {
    if (!activeOrgId) return;

    const accessibleTreeIds = new Set(Object.keys(backlogTrees));

    // Derive incoming partner org IDs synchronously from tree IDs that belong
    // to a different org (format: "<ownerOrgId>::<rawId>").
    const incomingPartnerOrgIds = new Set<string>();
    for (const treeId of accessibleTreeIds) {
      const sep = treeId.indexOf('::');
      if (sep > 0) {
        const ownerOrg = treeId.slice(0, sep);
        if (ownerOrg !== activeOrgId) incomingPartnerOrgIds.add(ownerOrg);
      }
    }

    // All channels are tracked here so the cleanup function can remove them
    // regardless of whether they were created synchronously or asynchronously.
    const channels: ReturnType<typeof supabase.channel>[] = [];
    let destroyed = false;
    const retryTimers = new Set<ReturnType<typeof setTimeout>>();

    /**
     * Subscribe a channel while observing its status so a dropped socket is
     * detected, retried with capped backoff, and followed by a catch-up fetch
     * of anything broadcast while we were disconnected.
     */
    function subscribeWithHealth(channel: ReturnType<typeof supabase.channel>) {
      let attempt = 0;
      const topic = channel.topic;
      const attach = () => {
        if (destroyed) return;
        channel.subscribe((status) => {
          if (destroyed) return;
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
          if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED') return;
          // Never retry while hidden — avoids battery drain and request storms.
          if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
          const delay = subscribeRetryDelayMs(attempt);
          attempt += 1;
          const timer = setTimeout(() => {
            retryTimers.delete(timer);
            if (destroyed) return;
            ensureSocketConnected();
            attach();
          }, delay);
          retryTimers.add(timer);
        });
      };
      attach();
      return channel;
    }


    /**
     * Attaches `labels` and `label_assignments` Postgres CDC listeners to the
     * provided channel builder.  Extracted here to eliminate the duplicate
     * handler blocks that previously appeared in both `subscribePartnerOrg`
     * and the own-org channel.
     */
    function addLabelHandlers(
      channel: ReturnType<typeof supabase.channel>,
      orgId: string,
    ): ReturnType<typeof supabase.channel> {
      return channel
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'labels',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            applyRealtimeLabel(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'label_assignments',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            applyRealtimeAssignment(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        );
    }

    // Helper: subscribe a channel that monitors work_items, backlogs, and
    // work_item_hyperlinks for a partner org.  A JS-side filter ensures we only
    // apply changes that reference trees the active org can actually access.
    function subscribePartnerOrg(orgId: string) {
      const channel = supabase
        .channel(`entity-realtime-${activeOrgId}-partner-${orgId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_items',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            if (payload.eventType !== 'DELETE') {
              // Only apply if this item is assigned to at least one accessible tree.
              const assignments = (row.backlog_assignments as Record<string, string>) ?? {};
              const currentTrees = new Set(Object.keys(useAppStore.getState().backlogTrees));
              if (!Object.keys(assignments).some((tid) => currentTrees.has(tid))) return;
            }
            applyRealtimeWorkItem(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'backlogs',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            if (payload.eventType !== 'DELETE') {
              // Only apply if this backlog belongs to an accessible tree.
              const currentTrees = new Set(Object.keys(useAppStore.getState().backlogTrees));
              if (!currentTrees.has(row.tree_id as string)) return;
            }
            applyRealtimeBacklog(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_item_hyperlinks',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            if (payload.eventType !== 'DELETE') {
              // Only apply if the parent work item is in our store (i.e. it
              // belongs to a shared tree we have access to).
              const workItemId = row.work_item_id as string;
              const assignments = useAppStore.getState().workItems[workItemId]?.backlogAssignments ?? {};
              const currentTrees = new Set(Object.keys(useAppStore.getState().backlogTrees));
              if (!Object.keys(assignments).some((tid) => currentTrees.has(tid))) return;
            }
            applyRealtimeHyperlink(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_item_backlog_ranks',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            if (payload.eventType !== 'DELETE') {
              const workItemId = row.work_item_id as string;
              if (!useAppStore.getState().workItems[workItemId]) return;
            }
            applyRealtimeWorkItemRank(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_item_board_ranks',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            if (payload.eventType !== 'DELETE') {
              const workItemId = row.work_item_id as string;
              if (!useAppStore.getState().workItems[workItemId]) return;
            }
            applyRealtimeWorkItemBoardRank(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'time_entries',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            if (payload.eventType !== 'DELETE') {
              // Only apply if the referenced work item or backlog is already in our
              // store. The store is populated exclusively from accessible trees, so
              // presence here is a sufficient proof of access – no extra tree check
              // is needed.
              const workItemId = row.work_item_id as string | null;
              const backlogId = row.backlog_id as string | null;
              const state = useAppStore.getState();
              if (workItemId) {
                if (!state.workItems[workItemId]) return;
              } else if (backlogId) {
                if (!state.backlogs[backlogId]) return;
              } else {
                return;
              }
            }
            applyRealtimeTimeEntry(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_item_team_assignments',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            applyRealtimeTeamAssignment(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'teams',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            applyRealtimeTeam(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_item_financials',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            if (payload.eventType !== 'DELETE') {
              const workItemId = row.work_item_id as string;
              if (!useAppStore.getState().workItems[workItemId]) return;
            }
            applyRealtimeFinancials(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        );
      subscribeWithHealth(addLabelHandlers(channel, orgId));
      channels.push(channel);
    }

    // Own-org channel (includes backlog_trees; partner orgs only ever add
    // work_items / backlogs to shared trees, never new backlog_trees).
    const ownChannel = supabase
      .channel(`entity-realtime-${activeOrgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_items',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeWorkItem(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'backlogs',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeBacklog(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'backlog_trees',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeBacklogTree(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_item_hyperlinks',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeHyperlink(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_item_backlog_ranks',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeWorkItemRank(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_item_board_ranks',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeWorkItemBoardRank(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'time_entries',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeTimeEntry(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_item_team_assignments',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeTeamAssignment(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'teams',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeTeam(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_item_financials',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeFinancials(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'organization_settings',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          applyRealtimeSettings(payload as any);
        },
      );
    // Four more tables ride on this same channel rather than opening their own.
    // A channel takes any number of bindings, and each extra channel costs
    // Realtime a subscription row plus a publication re-check every time it
    // subscribes — 100k of those checks were the biggest single consumer of
    // database time. None of these four needs a filter: RLS already limits
    // what the subscriber may see.
    ownChannel
      // Backlog statuses: RLS restricts to accessible backlogs.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'backlog_statuses' },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          const backlogId = row?.backlog_id as string | undefined;
          if (!backlogId) return;
          const accessible = useAppStore.getState().backlogs;
          if (!accessible[backlogId]) return;
          applyRealtimeStatus(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      // Public links: any change reloads which trees and backlogs are
      // published. The event's contents are deliberately ignored -- on a table
      // with RLS a DELETE carries only the primary key, which here is the
      // token, so it could not say which marker to drop. The reload asks the
      // database instead, debounced so a cascade costs one query.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'published_links' },
        () => usePublishedLinksStore.getState().scheduleLoad(),
      )
      // Scrambled item names: same shape, same reason.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'work_item_scrambles' },
        () => useScrambledItemsStore.getState().scheduleLoad(),
      )
      // Per-tree yearly financial targets, filtered to accessible trees here.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tree_financial_targets' },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          const treeId = row?.tree_id as string | undefined;
          if (!treeId) return;
          const accessible = new Set(Object.keys(useAppStore.getState().backlogTrees));
          if (!accessible.has(treeId)) return;
          applyRealtimeTarget(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      );

    subscribeWithHealth(addLabelHandlers(ownChannel, activeOrgId));
    channels.push(ownChannel);

    // Per-user snoozes (RLS already restricts to current user; no org filter needed).
    // Async: fetch the current user's id once, then subscribe filtered by it.
    (async () => {
      const userId = await getCurrentUserId();
      if (!userId || destroyed) return;
      const snoozeChannel = supabase
        .channel(`work-item-snoozes-${userId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_item_snoozes',
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            applyRealtimeSnooze(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        );
      subscribeWithHealth(snoozeChannel);
      channels.push(snoozeChannel);
    })();

    // Subscribe to incoming partner orgs synchronously (no extra DB query needed).
    for (const orgId of incomingPartnerOrgIds) {
      subscribePartnerOrg(orgId);
    }

    // Async: fetch outgoing partner org IDs (orgs that have access to our trees)
    // and subscribe to them as well.
    async function subscribeOutgoingPartners() {
      const ourTreeIds = [...accessibleTreeIds].filter((id) => id.startsWith(`${activeOrgId}::`));
      if (ourTreeIds.length === 0) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('backlog_tree_shares')
        .select('organization_id')
        .in('tree_id', ourTreeIds);

      if (error) {
        console.error('useRealtimeSync: failed to fetch outgoing tree shares', error);
        return;
      }

      if (destroyed) return;

      for (const row of (data ?? []) as Array<{ organization_id: string }>) {
        const orgId = row.organization_id;
        // Skip if already subscribed (incoming partner) or is the active org.
        if (orgId === activeOrgId || incomingPartnerOrgIds.has(orgId)) continue;
        subscribePartnerOrg(orgId);
      }
    }

    subscribeOutgoingPartners();

    return () => {
      destroyed = true;
      for (const timer of retryTimers) clearTimeout(timer);
      retryTimers.clear();
      for (const ch of channels) {
        // Flag the teardown so the resulting CLOSED status isn't treated as an
        // outage (which used to trigger a spurious full dataset refetch).
        markChannelIntentionalClose(ch.topic);
        supabase.removeChannel(ch);
        forgetChannel(ch.topic);
      }
    };
    // applyRealtime* actions are stable Zustand references; omitting them is intentional.
    // partnerOrgsKey re-subscribes when an organization starts or stops sharing
    // trees with this one — the only change that alters which channels exist.
    // A tree shared *out* after this ran is picked up by the next resync rather
    // than by rebuilding every channel on each tree edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, partnerOrgsKey, hasOwnTrees]);
}
