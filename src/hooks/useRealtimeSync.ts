import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
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

  // Stable serialized key so the effect re-runs only when the set of accessible
  // tree IDs actually changes (i.e. sharing membership changes).
  const treeIdsKey = Object.keys(backlogTrees).sort().join(',');

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
              // Only apply if the work item is in our store.
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
      addLabelHandlers(channel, orgId).subscribe();
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
    addLabelHandlers(ownChannel, activeOrgId).subscribe();
    channels.push(ownChannel);

    // Backlog statuses: a single channel; RLS restricts to accessible backlogs.
    const statusChannel = supabase
      .channel(`backlog-statuses-${activeOrgId}`)
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
      .subscribe();
    channels.push(statusChannel);

    // Per-tree yearly financial targets: single channel; filter to accessible trees client-side.
    const targetsChannel = supabase
      .channel(`tree-financial-targets-${activeOrgId}`)
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
      )
      .subscribe();
    channels.push(targetsChannel);


    // Per-user snoozes (RLS already restricts to current user; no org filter needed).
    // Async: fetch the current user's id once, then subscribe filtered by it.
    (async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
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
        )
        .subscribe();
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
      for (const ch of channels) supabase.removeChannel(ch);
    };
    // applyRealtime* actions are stable Zustand references; omitting them is intentional.
    // treeIdsKey captures changes to accessible tree IDs so the effect re-subscribes
    // whenever sharing membership changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, treeIdsKey]);
}
